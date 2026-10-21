import config from '../config/env.js';
import Session from '../models/Session.js';
import WhatsAppService from '../services/WhatsAppService.js';
import logger from '../utils/logger.js';

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

export default {
  authenticateGlobalApiKey,

};