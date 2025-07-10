const express = require('express');
const { authenticateApiKey } = require('../middleware/auth');
const Store = require('../models/Store');
const Session = require('../models/Session');
const logger = require('../utils/logger');
const config = require('../config/env');
const BaileysService = require('../services/BaileysService');

const router = express.Router();


router.get('/session', authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.headers['apikey'];

    const session = await Session.findById(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Sessão não encontrada'
      });
    }

    const config = await Store.getSessionConfig(sessionId);

    res.json({
      success: true,
      data: {
        sessionId,
        config: config || {
          webhookUrl: null,
          ignoreGroups: false,
          autoRead: false,
          rejectCalls: true,
          configData: {}
        }
      }
    });

  } catch (error) {
    logger.error('Erro ao obter configurações da sessão:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

router.put('/config', authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.headers['apikey'];
    const { ignoreGroups = false, autoRead = false, msg_rejectCalls = null, rejectCalls = false } = req.body;

    const session = await Session.findById(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Sessão não encontrada'
      });
    }

    const currentConfig = await Store.getSessionConfig(sessionId) || {};
    currentConfig.rejeitar_ligacoes = rejectCalls
    currentConfig.ignorar_grupos = ignoreGroups
    currentConfig.leitura_automatica = autoRead
    currentConfig.msg_rejectCalls = msg_rejectCalls;

    const getsessao = BaileysService.sessions.get(sessionId);
    if (!getsessao) {
      BaileysService.createSession(sessionId)
      res.status(500).json({
        success: false,
        message: 'Erro ao buscar sessão reniciando sessao tente novamente em instantes'
      });
      return
    }
    getsessao.rejeitar_ligacoes = session.rejeitar_ligacoes
    getsessao.ignorar_grupos = session.ignorar_grupos
    getsessao.autoRead = session.leitura_automatica
    getsessao.msg_rejectCalls = session.msg_rejectCalls;

    const success = await Store.saveSessionConfig(sessionId, currentConfig);

    if (!success) {
      return res.status(500).json({
        success: false,
        message: 'Erro ao salvar configurações'
      });
    }

    res.json({
      success: true,
      message: 'Configurações atualizadas com sucesso',
      data: { sessionId, currentConfig }
    });

    logger.info(`Configurações da sessão ${sessionId} atualizadas`);

  } catch (error) {
    logger.error('Erro ao atualizar configurações da sessão:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

router.put('/webhook', authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.headers['apikey'];
    const { webhookUrl, status_webhook = false, events = [] } = req.body;

    const session = await Session.findById(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Sessão não encontrada'
      });
    }

    // Validar URL se fornecida
    if (webhookUrl && webhookUrl !== null) {
      try {
        new URL(webhookUrl);
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: 'URL do webhook inválida'
        });
      }
    }
    const status = status_webhook == true ? 1 : 0;

    const currentConfig = await Store.getSessionConfig(sessionId) || {};
    currentConfig.webhook_url = webhookUrl;
    currentConfig.events = events;
    currentConfig.webhook_status = status;
    const success = await Store.saveSessionConfig(sessionId, currentConfig);
    const getsessao = BaileysService.sessions.get(sessionId);
    if (!getsessao) {
      BaileysService.createSession(sessionId)
      res.status(500).json({
        success: false,
        message: 'Erro ao buscar sessão reniciando sessao tente novamente em instantes'
      });
      return
    }
    getsessao.webhook_url = currentConfig.webhook_url
    getsessao.events = currentConfig.events
    getsessao.webhook_status = currentConfig.webhook_status
    // console.log(getsessao)
    if (!success) {
      return res.status(500).json({
        success: false,
        message: 'Erro ao salvar webhook'
      });
    }

    res.json({
      success: true,
      message: 'Webhook Atualizado com sucesso',
      data: { sessionId, currentConfig }
    });

    logger.info(`Webhook da sessão ${sessionId} ${webhookUrl ? 'configurado' : 'removido'}`);

  } catch (error) {
    console.log(error)
    logger.error('Erro ao configurar webhook:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

router.get('/stats', authenticateApiKey, async (req, res) => {
  try {
    const sessionId = req.headers['apikey'];

    const session = await Session.findById(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        message: 'Sessão não encontrada'
      });
    }

    const stats = await Store.getSessionStats(sessionId);

    res.json({
      success: true,
      data: {
        sessionId,
        stats,
        sessionInfo: {
          status: session.status,
          phoneNumber: session.numero,
          createdAt: session.created_at,
          updatedAt: session.updated_at
        }
      }
    });

  } catch (error) {
    logger.error('Erro ao obter estatísticas da sessão:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

module.exports = router;