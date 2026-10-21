import express from "express";
import authenticateApiKey from "../middleware/auth.js";
import { estatisticasSessao } from "../whatsapp/store.js";
import Session from "../models/Session.js";
import logger from "../utils/logger.js";
import config from "../config/env.js";
import WhatsAppService from "../services/WhatsAppService.js";

const router = express.Router();
const SESSION_STATS_CACHE_TTL_SECONDS = 120;

// Rota para obter configurações da sessão
router.get("/session", authenticateApiKey, async (req, res) => {
  try {
    const sessao = req.sessao;


    const config = await Session.getConfig(sessao.apikey);
    const stats = await estatisticasSessao(sessao.apikey);
    const proxy = await Session.getProxy(sessao.apikey);

    res.json({
      success: true,
      dados: {
        sessao,
        stats,
        proxy,
        config,
      },
    });
  } catch (error) {
    logger.error("Erro ao obter configurações da sessão:", error);
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
    });
  }
});

// Rota para atualizar configurações da sessão
router.put("/config", authenticateApiKey, async (req, res) => {
  try {
    const sessao = req.sessao;
    const {
      ignoreGroups = false,
      autoRead = false,
      msg_rejectCall = null,
      rejectCall = false,
    } = req.body;
    sessao.ignorar_grupos = ignoreGroups;
    sessao.leitura_automatica = autoRead;
    sessao.msg_rejectcalls = msg_rejectCall;
    sessao.rejeitar_ligacoes = rejectCall;

    const success = await Session.saveConfig(sessao.apikey, sessao);
    WhatsAppService.salvarSessao(sessao.apikey, sessao);

    res.json({
      success: true,
      message: "Configurações atualizadas com sucesso",
      data: { sessionId: sessao.apikey, sessao },
    });

    logger.info(`Configurações da sessão ${sessao.apikey} atualizadas`);
  } catch (error) {
    logger.error("Erro ao atualizar configurações da sessão:", error);
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
    });
  }
});

// Rota para configurar webhook
router.put("/webhook", authenticateApiKey, async (req, res) => {
  try {
    const sessao = req.sessao;
    const { webhookUrl, status_webhook = false, events = [] } = req.body;

    // Validar URL se fornecida
    if (webhookUrl && webhookUrl !== null) {
      try {
        new URL(webhookUrl);
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: "URL do webhook inválida",
        });
      }
    }
    const status = status_webhook == true ? 1 : 0;

    sessao.webhook_url = webhookUrl;
    sessao.events = events;
    sessao.webhook_status = status;
    console.log(sessao)
    const success = await Session.saveConfig(sessao.apikey, sessao);
    WhatsAppService.salvarSessao(sessao.apikey, sessao);

    res.json({
      success: true,
      message: "Webhook Atualizado com sucesso",
      dados: sessao,
    });

    logger.info(
      `Webhook da sessão ${sessao.apikey} ${webhookUrl ? "configurado" : "removido"}`,
    );
  } catch (error) {
    logger.error("Erro ao configurar webhook:", error);
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
    });
  }
});

// Rota para atualizar configurações de proxy
router.put("/proxy", authenticateApiKey, async (req, res) => {
  try {
    const sessao = req.sessao;
    const {
      protocol = "http",
      username = "teste",
      password = "teste",
      host = "teste",
      port = 8080,
      active = false,
    } = req.body;
    const requiredFields = ["protocol", "host", "port"];

    const proxyConfig = {
      protocol: protocol.trim() == '' ? 'http' : protocol,
      username: username.trim() == '' ? 'teste' : username,
      password: password.trim() == '' ? 'teste' : password,
      host: host.trim() == '' ? '127.0.0.1' : host,
      port: port.trim() == '' ? 8080 : port,
      active: active ? true : false,
    };

    const setProxy = await Session.setProxy(sessao.apikey, proxyConfig);
    if (setProxy.affectedRows === 0) {
      return res.status(500).json({
        success: false,
        message: "Erro ao salvar configurações de proxy",
      });
    }
    if (active === true) {
      const sock = await WhatsAppService.sockets.get(sessao.apikey);
      try { await sock.end(); } catch (_) {/* ignore */ }
    }
    logger.info(`Configurações de proxy da sessão ${sessao.apikey} atualizadas`);
    return res.json({
      success: true,
      message: "Configurações de proxy atualizadas com sucesso",
      dados: { proxyConfig, sessao },
    });

  } catch (error) {
    logger.error("Erro ao atualizar configurações de proxy:", error);
    res.status(500).json({
      success: false,
      message: "Erro interno do servidor",
    });
  }
});

export default router;
