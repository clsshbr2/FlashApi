const express = require('express');
const { authenticateGlobalApiKey } = require('../middleware/globalAuth');
const BaileysService = require('../services/BaileysService');
const GlobalWebhookService = require('../services/GlobalWebhookService');
const Store = require('../models/Store');
const config = require('../config/env');
const logger = require('../utils/logger');

const router = express.Router();

router.get('/status', authenticateGlobalApiKey, async (req, res) => {
  try {
    const sessionsStats = BaileysService.getSessionsStats();  
    const webhookInfo = GlobalWebhookService.getWebhookInfo();
    const poolStatus = await Store.getPoolStatus();
    
    res.json({
      success: true,
      data: {
        system: {
          status: 'online',
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          version: '1.0.0',
          environment: config.nodeEnv
        },
        sessions: sessionsStats,
        webhook: {
          global: webhookInfo,
          enabled: config.enableGlobalWebhook
        },
        websocket: {
          enabled: config.enableGlobalWebsocket,
          clients: 0 // Will be updated by WebSocket service
        },
        database: {
          mysql: poolStatus
        }
      }
    });
  } catch (error) {
    console.log(error)
    logger.error('Erro ao obter status do sistema:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

router.get('/config', authenticateGlobalApiKey, async (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        features: {
          globalWebhook: config.enableGlobalWebhook,
          globalWebsocket: config.enableGlobalWebsocket
        },
        limits: {
          rateLimitWindow: config.rateLimitWindowMs,
          rateLimitMax: config.rateLimitMaxRequests
        },
        environment: config.nodeEnv,
        version: '1.0.0'
      }
    });
  } catch (error) {
    logger.error('Erro ao obter configurações:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

router.post('/cleanup', authenticateGlobalApiKey, async (req, res) => {
  try {
    await BaileysService.cleanupSessions();
    
    res.json({
      success: true,
      message: 'Limpeza de sessões realizada com sucesso'
    });
    
    logger.info('Limpeza manual de sessões executada');
  } catch (error) {
    logger.error('Erro na limpeza de sessões:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno do servidor'
    });
  }
});

module.exports = router;