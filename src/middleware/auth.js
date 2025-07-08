const ApiKey = require('../models/ApiKey');
const logger = require('../utils/logger');

const authenticateApiKey = async (req, res, next) => {
  try {
    const apiKey = req.headers['apikey'];

    if (!apiKey) {
      return res.status(401).json({
        success: false,
        message: 'API Key é obrigatória'
      });
    }
    
    const keyData = await ApiKey.findByKey(apiKey);
    
    if (!keyData || !keyData.active) {
      return res.status(401).json({
        success: false,
        message: 'API Key inválida ou inativa'
      });
    }
    
    req.apiKey = keyData;
    next();
  } catch (error) {
    logger.error('Erro na autenticação:', error);
    res.status(500).json({
      success: false,
      message: 'Erro interno de autenticação'
    });
  }
};

module.exports = { authenticateApiKey };