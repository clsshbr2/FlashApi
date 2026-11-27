import express from "express";
import authenticateApiKey from "../middleware/auth.js";
import WhatsAppService from "../services/WhatsAppService.js";
import { FILTROS_CONTATOS, listarContatos } from "../whatsapp/store.js";
import logger from "../utils/logger.js";
import fs from "fs";
import util from "util";
import Session from "../models/Session.js";
import path from "path";
import axios from "axios";
import { rotaSessao } from "./rotaSessao.js";

const router = express.Router();

router.get("/list", authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.headers["apikey"];

    // filter: conversas (padrão) | agenda | todos — ver FILTROS_CONTATOS
    const filtro = String(req.query.filter || "conversas").toLowerCase();
    if (!(filtro in FILTROS_CONTATOS)) {
      return res.status(400).json({ success: false, message: `filter deve ser: ${Object.keys(FILTROS_CONTATOS).join(", ")}` });
    }
    const busca = String(req.query.search || "").trim();
    // Paginação só quando "page" é informado (sem ela, devolve tudo como antes)
    const page = req.query.page ? Math.max(1, parseInt(req.query.page, 10) || 1) : undefined;
    const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit, 10) || 100));

    const { contatos, total } = await listarContatos(sessionId, { filtro, busca, page, limit });
    res.json({
      success: true,
      filter: filtro,
      total,
      ...(page ? { page, limit, pages: Math.ceil(total / limit) } : {}),
      contacts: contatos,
    });
  } catch (error) {
    logger.error("Erro ao listar contatos:", error);
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
    });
  }
});

// Foto de perfil de um contato (ou grupo). Aceita número puro, @s.whatsapp.net, @lid e @g.us.
// Sempre responde uma imagem: sem foto, foto oculta pela privacidade ou sessão offline -> imagem padrão.
router.get("/avatar/:apikey/:jid", async (req, res) => {
  const imagemPadrao = () => res.sendFile(path.resolve("public/images/image.png"));
  const { apikey, jid } = req.params;

  const sock = WhatsAppService.getSocket(apikey);
  if (!sock?.client || !jid) return imagemPadrao();

  // Alta resolução primeiro; a miniatura só quando a consulta respondeu sem foto.
  // Se o WhatsApp recusou (sem foto / privacidade), não insiste: seria uma consulta a mais à toa.
  let url;
  try {
    url = await sock.profilePictureUrl(jid, "image");
    if (!url) url = await sock.profilePictureUrl(jid, "preview");
  } catch (error) {
    logger.debug(`Avatar indisponível (${jid}): ${error?.message || error}`);
    return imagemPadrao();
  }
  if (!url) return imagemPadrao();

  try {
    const resposta = await axios.get(url, { responseType: "stream", timeout: 5000 });
    res.setHeader("Content-Type", resposta.headers["content-type"] || "image/jpeg");
    // O navegador guarda a foto por 1 hora: telas recarregadas não consultam o WhatsApp de novo.
    res.setHeader("Cache-Control", "private, max-age=3600");
    resposta.data.pipe(res);
  } catch (error) {
    logger.debug(`Falha ao baixar o avatar (${jid}): ${error?.message || error}`);
    return imagemPadrao();
  }
});

router.post("/check", authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.sessao.apikey
    const { number } = req.body;

    if (!number) {
      return res.status(400).json({
        success: false,
        message: "Número é obrigatória",
      });
    }

    if (typeof number !== 'string') {
      return res.status(500).json({
        success: false,
        message: "numbers deve ser string"
      });
    }
    const sock = await WhatsAppService.sockets.get(sessionId)
    if (!sock) {
      return res.status(500).json({
        success: false,
        message: "Sessão não conectada"
      });
    }
    const results = await sock.onWhatsApp(number)

    res.json({
      success: true,
      data: results,
    });
  } catch (error) {
    logger.error("Erro ao verificar números:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Erro interno do servidor",
    });
  }
});

router.post("/block", authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.headers["apikey"];
    const { jid, action } = req.body;

    if (!jid || !action) {
      return res.status(400).json({
        success: false,
        message: "jid e action é obrigatório",
      });
    }

    if (action !== "block" && action !== "unblock") {
      return res.status(400).json({
        success: false,
        message: "Action Deve ser block ou unblock",
      });
    }

    const sock = await WhatsAppService.sockets.get(sessionId)
    if (!sock) {
      return res.status(400).json({
        success: false,
        message: "Sessão não conectada",
      });
    }
    const result = await sock.updateBlockStatus(jid, action)
    res.json({
      success: true,
      message: `Contato ${action == 'block' ? "bloqueado" : "desbloqueado"} com sucesso`,
      data: result,
    });
  } catch (error) {
    logger.error("Erro ao bloquear contato:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Erro interno do servidor",
    });
  }
});

//Lid to Jid Mapping
router.post("/lid-to-jid", authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.headers["apikey"];
    const { lid } = req.body;

    if (!lid) {
      return res.status(400).json({
        success: false,
        message: "LID é obrigatório",
      });
    }

    const lidlimpo = lid.split("@")[0];
    const mapping = await WhatsAppService.redis.get(WhatsAppService.keys.lid_map(sessionId, lidlimpo));
    if (!mapping) {
      return res.status(404).json({
        success: false,
        message: "Nenhum mapeamento encontrado para o LID fornecido",
      });
    }
    return res.json({
      success: true,
      data: {
        lid,
        jid: mapping,
      },
    });
  } catch (error) {
    logger.error("Erro ao mapear LID para JID:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Erro interno do servidor",
    });
  }
});

// Suporte: refaz a sessão de criptografia com um contato (corrige "Aguardando mensagem" / falha ao decifrar).
// mode: "force" (padrão, recria mantendo a identidade) | "identity" (contato trocou de aparelho/reinstalou).
router.post("/resync-session", authenticateApiKey, rotaSessao(async ({ req, sock, erroValidacao }) => {
  const { jid, mode = "force" } = req.body || {};
  if (!jid) return erroValidacao("jid é obrigatório");
  if (String(jid).endsWith("@g.us")) return erroValidacao("Informe o contato, não o grupo (a sessão é por pessoa)");
  if (!["force", "identity"].includes(mode)) return erroValidacao('mode deve ser "force" ou "identity"');
  await sock.resyncSignalSession(jid, mode);
  return { message: "Sessão de criptografia refeita. As próximas mensagens com este contato usam a sessão nova." };
}, "Erro ao refazer a sessão de criptografia"));

export default router;
