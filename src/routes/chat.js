import express from "express";
import authenticateApiKey from "../middleware/auth.js";
import WhatsAppService from "../services/WhatsAppService.js";

import logger from "../utils/logger.js";
import { listarChats, listarMensagens, obterMensagem, TIPOS_CHATS } from "../whatsapp/store.js";
import { extrairMidia } from "../whatsapp/utils.js";
import { rotaSessao } from "./rotaSessao.js";
import { sendMessage } from "../services/messageService.js";
import { sendButton, sendCarousel, sendinteractiveMessage, sendList } from "../services/buttonsService.js";

const router = express.Router();

router.post("/send-text", authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.sessao.apikey;
    const send = await sendMessage(sessionId, req.body)
    return res.status(send.success ? 200 : 500).status(200).json({
      success: send.success ? true : false,
      message: send.message,
      error: send.error
    });
    logger.info(`Mensagem de texto "enviada": ${sessionId} -> ${req.body.jid}`);
  } catch (error) {
    logger.error("Erro ao enviar mensagem de texto:", error);
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
      error: error.message || error
    });
  }
});

router.post("/send-image", authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.sessao.apikey;
    const send = await sendMessage(sessionId, req.body)
    return res.status(send.success ? 200 : 500).status(200).json({
      success: send.success ? true : false,
      message: send.message,
      error: send.error
    });
    logger.info(`Imagem enviada: ${sessionId} -> ${req.body.jid}`);
  } catch (error) {
    logger.error("Erro ao enviar imagem:", error.message || error);
    res.status(500).json({
      success: false,
      message: error.message || "Erro interno do servidor",
    });
  }
});

router.post("/send-video", authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.sessao.apikey;
    const send = await sendMessage(sessionId, req.body)
    return res.status(send.success ? 200 : 500).status(200).json({
      success: send.success ? true : false,
      message: send.message,
      error: send.error
    });
    logger.info(`Video enviado: ${sessionId} -> ${req.body.jid}`);
  } catch (error) {
    logger.error("Erro ao enviar vídeo:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Erro interno do servidor",
    });
  }
});

router.post("/send-audio", authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.sessao.apikey;
    const send = await sendMessage(sessionId, req.body)
    return res.status(send.success ? 200 : 500).status(200).json({
      success: send.success ? true : false,
      message: send.message,
      error: send.error
    });
    logger.info(`Audio enviado: ${sessionId} -> ${req.body.jid}`);
  } catch (error) {
    logger.error("Erro ao enviar áudio:", error.message || error);
    res.status(500).json({
      success: false,
      message: error.message || "Erro interno do servidor",
    });
  }
});

router.post("/send-document", authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.sessao.apikey;
    const send = await sendMessage(sessionId, req.body)
    return res.status(send.success ? 200 : 500).status(200).json({
      success: send.success ? true : false,
      message: send.message,
      error: send.error
    });
    logger.info(`Documento enviado: ${sessionId} -> ${req.body.jid}`);
  } catch (error) {
    logger.error("Erro ao enviar documento:", error.message || error);
    res.status(500).json({
      success: false,
      message: error.message || "Erro interno do servidor",
    });
  }
});

router.post("/send-location", authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.sessao.apikey;
    const send = await sendMessage(sessionId, req.body)
    return res.status(send.success ? 200 : 500).status(200).json({
      success: send.success ? true : false,
      message: send.message,
      error: send.error
    });
    logger.info(`Localização enviado: ${sessionId} -> ${req.body.jid}`);
  } catch (error) {
    logger.error("Erro ao enviar localização:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Erro interno do servidor",
    });
  }
});

router.post("/send-contact", authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.sessao.apikey;
    const send = await sendMessage(sessionId, req.body)
    return res.status(send.success ? 200 : 500).status(200).json({
      success: send.success ? true : false,
      message: send.message,
      error: send.error
    });
    logger.info(`Contato enviado: ${sessionId} -> ${req.body.jid}`);
  } catch (error) {
    logger.error("Erro ao enviar contato:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Erro interno do servidor",
    });
  }
});

router.post("/send-sticker", authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.sessao.apikey;
    const send = await sendMessage(sessionId, req.body)
    return res.status(send.success ? 200 : 500).status(200).json({
      success: send.success ? true : false,
      message: send.message,
      error: send.error
    });
    logger.info(`Figurinha Enviada: ${sessionId} -> ${req.body.jid}`);
  } catch (error) {
    logger.error("Erro ao enviar sticker:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Erro interno do servidor",
    });
  }
});

router.post("/send-reaction", authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.sessao.apikey;
    const send = await sendMessage(sessionId, req.body)
    return res.status(send.success ? 200 : 500).status(200).json({
      success: send.success ? true : false,
      message: send.message,
      error: send.error
    });
    logger.info(`Reação Enviada: ${sessionId} -> ${req.body.jid}`);
  } catch (error) {
    logger.error("Erro ao enviar reação:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Erro interno do servidor",
    });
  }
});

router.post("/send-poll", authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.sessao.apikey;
    const send = await sendMessage(sessionId, req.body)
    return res.status(send.success ? 200 : 500).status(200).json({
      success: send.success ? true : false,
      message: send.message,
      error: send.error
    });
    logger.info(`Enquete Enviada: ${sessionId} -> ${req.body.jid}`);
  } catch (error) {
    logger.error("Erro ao enviar enquete:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Erro interno do servidor",
    });
  }
});

router.post("/send-list", authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.sessao.apikey;
    const send = await sendList(sessionId, req.body)
    return res.status(send.success ? 200 : 500).status(200).json({
      success: send.success ? true : false,
      message: send.message,
      error: send.error
    });
    logger.info(`Lista Enviada: ${sessionId} -> ${req.body.jid}`);
  } catch (error) {
    logger.error("Erro ao enviar lista:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Erro interno do servidor",
    });
  }
});

router.post("/send-buttons", authenticateApiKey, async (req, res) => {
  try {

    const sessionId = req.sessao.apikey;
    const send = await sendButton(sessionId, req.body)
    return res.status(send.success ? 200 : 500).status(200).json({
      success: send.success ? true : false,
      message: send.message,
      error: send.error
    });
    logger.info(`Button Enviado: ${sessionId} -> ${req.body.jid}`);

  } catch (error) {
    logger.error("Erro ao enviar botões:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Erro interno do servidor",
    });
  }
});

router.post("/send-interactiveMessage", authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.sessao.apikey;
    const send = await sendinteractiveMessage(sessionId, req.body)
    return res.status(send.success ? 200 : 500).status(200).json({
      success: send.success ? true : false,
      message: send.message,
      error: send.error
    });
    logger.info(`Button Enviado: ${sessionId} -> ${req.body.jid}`);

  } catch (error) {
    logger.error("Erro ao enviar botões:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Erro interno do servidor",
    });
  }
});

router.post("/send-carouselMessage", authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.sessao.apikey;
    const send = await sendCarousel(sessionId, req.body)
    return res.status(send.success ? 200 : 500).status(200).json({
      success: send.success ? true : false,
      message: send.message,
      error: send.error
    });
    logger.info(`Button Enviado: ${sessionId} -> ${req.body.jid}`);
  } catch (error) {
    logger.error("Erro ao enviar botões:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Erro interno do servidor",
    });
  }
});

router.post("/typing", authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.sessao.apikey;
    const { jid, typing = null, audio = false, delay = 0 } = req.body;

    if (!jid) {
      return res.status(400).json({
        success: false,
        message: "to e typing são obrigatórios",
      });
    }

    if (typeof typing !== "boolean") {
      return res.status(400).json({
        success: false,
        message: "typing deve ser Boolean",
      });
    }

    const sock = WhatsAppService.sockets.get(sessionId);
    if (!sock) {
      return res.status(400).json({
        success: false,
        message: "Sessão desconectada",
      });
    }

    if (typeof delay == "number" && delay > 0) {
      await WhatsAppService.delay(parseInt(delay))
    }
    if (!typing) {
      sock.sendPresenceUpdate("paused", jid);
    } else {
      sock.sendPresenceUpdate(audio ? "recording" : "composing", jid);
    }

    res.json({
      success: true,
      message: `Status de digitação ${typing ? "iniciado" : "parado"} com sucesso`,
      data: {},
    });
  } catch (error) {
    logger.error("Erro ao enviar status de digitação:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Erro interno do servidor",
    });
  }
});

router.post("/mark-read", authenticateApiKey, async (req, res) => {
  try {
    const sessao = req.sessao;
    const { jid, messageId } = req.body;

    if (!jid) {
      return res.status(400).json({
        success: false,
        message: "jid é obrigatório",
      });
    }

    const sock = WhatsAppService.sockets.get(sessao.apikey);
    if (!sock) {
      return res.status(400).json({
        success: false,
        message: "Sessão desconectada",
      });
    }

    const result = await sock.readMessages([{ remoteJid: jid, id: messageId }]);

    res.json({
      success: true,
      message: "Mensagem marcada como lida com sucesso",
      data: result,
    });
  } catch (error) {
    logger.error("Erro ao marcar mensagem como lida:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Erro interno do servidor",
    });
  }
});

router.get("/messages", authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.headers["apikey"];
    const { jid, limit = 50, offset = 0 } = req.query; // "before" (ms) pagina para trás

    const messages = await listarMensagens(sessionId, jid, parseInt(limit), req.query.before ? Number(req.query.before) : undefined);

    res.json({
      success: true,
      data: {
        messages,
        total: messages.length,
        limit: parseInt(limit),
        offset: parseInt(offset),
      },
    });
  } catch (error) {
    logger.error("Erro ao obter mensagens:", error);
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
    });
  }
});

router.get("/chats", authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.headers["apikey"];

    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const search = req.query.search || "";

    if (limit > 100) {
      return res.status(500).json({
        success: false,
        message: "limit maximo e 100"
      });
    }

    // type: todos (padrão) | privados | grupos ; archived: true | false (sem o parâmetro, traz todas)
    const tipo = String(req.query.type || "todos").toLowerCase();
    if (!TIPOS_CHATS.includes(tipo)) {
      return res.status(400).json({ success: false, message: `type deve ser: ${TIPOS_CHATS.join(", ")}` });
    }
    const arquivadas = req.query.archived === undefined ? undefined : req.query.archived === "true";

    const result = await listarChats(sessionId, { page, limit, search, tipo, arquivadas });

    res.json(result);

  } catch (error) {
    logger.error("Erro ao obter chats:", error);

    res.status(500).json({
      success: false,
      message: "Erro interno",
      error: error.message
    });
  }
});

// Edita o texto de uma mensagem enviada por esta conta (o WhatsApp aceita até ~15 min após o envio)
router.post("/edit", authenticateApiKey, rotaSessao(async ({ req, sock, erroValidacao }) => {
  const { jid, messageId, text } = req.body || {};
  if (!jid) return erroValidacao("jid é obrigatório");
  if (!messageId) return erroValidacao("messageId é obrigatório");
  if (typeof text !== "string" || !text.trim()) return erroValidacao("text é obrigatório");

  // Só dá para editar mensagem própria: confere no histórico quando ela estiver guardado
  const original = await obterMensagem(req.sessao.apikey, messageId);
  if (original && !original.key?.fromMe) return erroValidacao("Só é possível editar mensagens enviadas por esta conta");

  const resultado = await sock.editarMensagem(jid, messageId, text);
  return { message: "Mensagem editada", ...resultado };
}, "Erro ao editar a mensagem"));

router.delete("/delete/:id_message", authenticateApiKey, async (req, res) => {
  try {
    const sessao = req.sessao;
    const { id_message } = req.params;
    if (!id_message) {
      return res.json({
        success: false,
        message: 'Paramentro "id_message" Ausente',
        data: [],
      });
    }

    const get_message = await obterMensagem(sessao.apikey, id_message);

    if (!get_message) {
      return res.json({
        success: false,
        message: "Mensagem não encontrada",
        data: [],
      });
    }

    const key = {
      id: get_message.key.id,
      remoteJid: get_message.key.remoteJid,
      fromMe: get_message.key.fromMe,
      participant: get_message.key.participant,
    };
    const sock = WhatsAppService.sockets.get(sessao.apikey)
    if (!sock) {
      return res.json({
        success: false,
        message: "Sessão não conectada",
        data: [],
      });
    }

    const delete_msg = await sock.sendMessage(key.remoteJid, { delete: key });
    if (!delete_msg) {
      return res.json({
        success: false,
        message: "Error ao deletar mensagem",
        data: delete_msg,
      });
    }
    res.json({
      success: true,
      message: "Mensagem deletada",
      data: delete_msg,
    });
  } catch (error) {
    logger.error("Erro ao deletar mensagem:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Erro interno do servidor",
    });
  }
});

// ---------------------------------------------------------------- Mídia recebida

/**
 * Envia a mídia de uma mensagem como ARQUIVO (stream), com o tipo e o nome certos.
 * `?download=1` força o download (attachment); sem ele, o navegador exibe (inline).
 */
async function responderMidia(req, res, { message, key }) {
  const info = extrairMidia(message);
  if (!info) return res.status(400).json({ success: false, message: "A mensagem não tem mídia (imagem, vídeo, áudio, documento ou figurinha)" });

  const sock = WhatsAppService.sockets.get(req.sessao.apikey);
  if (!sock) return res.status(400).json({ success: false, message: "Sessão desconectada" });

  let stream;
  try {
    stream = await sock.abrirMidia(message, { chave: key });
  } catch (error) {
    if (error?.midiaIndisponivel) return res.status(410).json({ success: false, message: error.message });
    logger.warn(`Falha ao baixar mídia (${key?.id || "sem id"}): ${error?.message || error}`);
    return res.status(502).json({ success: false, message: `Não foi possível baixar a mídia: ${error?.message || error}` });
  }

  const disposicao = req.query.download === "1" || req.query.download === "true" ? "attachment" : "inline";
  res.setHeader("Content-Type", info.mimetype);
  res.setHeader("Content-Disposition", `${disposicao}; filename*=UTF-8''${encodeURIComponent(info.fileName)}`);
  // A mídia de uma mensagem nunca muda: o navegador pode guardar por 1 dia
  res.setHeader("Cache-Control", "private, max-age=86400");

  // Cliente desistiu no meio: libera a conexão com o servidor de mídia do WhatsApp
  res.on("close", () => stream.destroy());
  stream.on("error", (erro) => {
    logger.warn(`Erro no meio do download da mídia (${key?.id || "sem id"}): ${erro?.message || erro}`);
    res.destroy(erro);
  });
  stream.pipe(res);
}

// Mídia de uma mensagem guardada (pelo ID). Use direto em <img>/<audio>/<video> do seu backend.
router.get("/media/:messageId", authenticateApiKey, async (req, res) => {
  try {
    const mensagem = await obterMensagem(req.sessao.apikey, req.params.messageId);
    if (!mensagem) return res.status(404).json({ success: false, message: "Mensagem não encontrada" });
    if (!mensagem.message) return res.status(422).json({ success: false, message: "Conteúdo da mensagem indisponível" });
    return await responderMidia(req, res, mensagem);
  } catch (error) {
    logger.error("Erro ao baixar mídia:", error);
    if (!res.headersSent) res.status(500).json({ success: false, message: error.message || "Erro interno do servidor" });
  }
});

// Mídia a partir do objeto da mensagem (como chegou no webhook): { message, key? }
router.post("/media", authenticateApiKey, async (req, res) => {
  try {
    const { message, key } = req.body || {};
    if (!message) return res.status(400).json({ success: false, message: "message é obrigatório" });
    return await responderMidia(req, res, { message, key });
  } catch (error) {
    logger.error("Erro ao baixar mídia:", error);
    if (!res.headersSent) res.status(500).json({ success: false, message: error.message || "Erro interno do servidor" });
  }
});

//Converter midia em base64 (prefira GET /media/:messageId para arquivos grandes)
router.post("/midiaToBase64", authenticateApiKey, async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({
        success: false,
        message: "message é obrigatório",
      });
    }
    // Aceita qualquer mídia (imagem, vídeo, áudio, documento, figurinha), inclusive dentro de
    // mensagem temporária / visualização única
    const info = extrairMidia(message);
    if (!info) {
      return res.status(400).json({
        success: false,
        message: "Tipo de mídia inválido",
      });
    }
    const sock = WhatsAppService.sockets.get(req.sessao.apikey);
    if (!sock) {
      return res.status(400).json({ success: false, message: "Sessão desconectada" });
    }
    const buffer = await sock.baixarMidia(message);

    const base64 = buffer.toString("base64");
    const dataUrl = `data:${info.mimetype};base64,${base64}`;

    res.json({
      success: true,
      message: "Mídia convertida para base64 com sucesso",
      data: dataUrl,
    });
  } catch (error) {
    logger.error("Erro ao converter mídia para base64:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Erro interno do servidor",
    });
  }
});


export default router;
