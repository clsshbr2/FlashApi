import express from "express";
import authenticateApiKey from "../middleware/auth.js";
import WhatsAppService from "../services/WhatsAppService.js";
import { listarContatos } from "../whatsapp/store.js";
import logger from "../utils/logger.js";
import fs from "fs";
import util from "util";
import Session from "../models/Session.js";
import path from "path";
import axios from "axios";

const router = express.Router();

router.get("/list", authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.headers["apikey"];

    const SoJids = await listarContatos(sessionId);
    res.json({
      success: true,
      total: SoJids.length,
      contacts: SoJids,
    });
  } catch (error) {
    console.log(error);
    logger.error("Erro ao listar contatos:", error);
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
    });
  }
});

router.get("/avatar/:apikey/:jid", async (req, res) => {
  try {
    const apiKey = req.params.apikey;
    const jid = req.params.jid;
    if (!apiKey) {
      return res.status(400).json({
        success: false,
        message: "ApiKey é obrigatória",
      });
    }
    if (!jid) {
      return res.status(400).json({
        success: false,
        message: "JID é obrigatório",
      });
    }
    const sock = WhatsAppService.getSocket(apiKey);

    if (!sock?.client) {
      return res.sendFile(path.resolve("public/images/image.png"));
    }
    const jidformat = jid.includes('@s.whatsapp.net') ? jid : jid + "@s.whatsapp.net"

    // Tenta a foto em alta resolução e, se não houver, a miniatura.
    let url;
    try {
      url = await sock.client.profile.getProfilePicture(jid + "@s.whatsapp.net", "image")
    } catch {

    }
    if (!url.url) return res.sendFile(path.resolve("public/images/image.png"));

    const response = await axios.get(url.url, {
      responseType: "stream",
      timeout: 5000,
    });

    res.setHeader("Content-Type", "image/jpeg");
    response.data.pipe(res);
  } catch (error) {
    console.log(error)
    // Sem foto (ou privacidade) é comum; mostra a imagem padrão e registra o motivo.
    logger.debug(`Avatar indisponível (${req.params.jid}): ${error?.message || error}`);
    return res.sendFile(path.resolve("public/images/image.png"));
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

export default router;
