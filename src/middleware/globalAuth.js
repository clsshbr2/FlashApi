const config = require('../config/env');
const Session = require('../models/Session');
const logger = require('../utils/logger');

const authenticateGlobalApiKey = (req, res, next) => {
  try {
    const apiKey = req.headers['apikey'] ||
      req.headers['authorization']?.replace('Bearer ', '') ||
      req.headers['x-api-key'];

    if (!apiKey) {
      return res.status(401).json({
        success: false,
        message: 'apikey é obrigatória. Use o header apikey'
      });
    }

    if (apiKey !== config.globalApiKey) {
      logger.warn(`Tentativa de acesso com API Key inválida: ${apiKey.substring(0, 10)}...`);
      return res.status(401).json({
        success: false,
        message: 'API Key inválida'
      });
    }

    req.authenticated = true;
    next();
  } catch (error) {
    logger.error('Erro na autenticação global:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno de autenticação'
    });
  }
};

const authenticateWebhookSecret = (req, res, next) => {
  if (!config.enableGlobalWebhook) {
    return res.status(404).json({
      success: false,
      message: 'Webhook global não está habilitado'
    });
  }

  try {
    const secret = req.headers['x-webhook-secret'] || req.headers['authorization']?.replace('Bearer ', '');

    if (!secret) {
      return res.status(401).json({
        success: false,
        message: 'Webhook secret é obrigatório'
      });
    }

    if (secret !== config.globalWebhookSecret) {
      return res.status(401).json({
        success: false,
        message: 'Webhook secret inválido'
      });
    }

    req.webhookAuthenticated = true;
    next();
  } catch (error) {
    logger.error('Erro na autenticação do webhook:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno de autenticação'
    });
  }
};

const authenticateWebSocketSecret = async (secret, modo) => {
  if (!config.enableGlobalWebsocket) {
    return { success: false, message: 'WebSocket não está habilitado' };
  }

  if (!secret) {
    return { success: false, message: 'WebSocket secret é obrigatório' };
  }

  if (modo == 'global' && secret !== config.globalWebsocketSecret) {
    return { success: false, message: 'WebSocket secret inválido' };
  }

   if (modo == 'client') {
    const getsessao = await Session.findById(secret)
    if(!getsessao){
      return { success: false, message: 'WebSocket secret inválido' };
    }
  }

  return { success: true };
};

module.exports = {
  authenticateGlobalApiKey,
  authenticateWebhookSecret,
  authenticateWebSocketSecret
};