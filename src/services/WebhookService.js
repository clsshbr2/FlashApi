const axios = require('axios');
const logger = require('../utils/logger');

class WebhookService {
  async sendWebhook(url, data, retries = 3) {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await axios.post(url, data, {
          timeout: 10000,
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'Baileys-Multi-Session-Webhook/1.0'
          }
        });

        if (response.status >= 200 && response.status < 300) {
          logger.info(`Webhook enviado com sucesso para ${url}`);
          return true;
        }
      } catch (error) {
        logger.error(`Tentativa ${i + 1} - Erro ao enviar webhook para ${url}:`, error.message);
        
        if (i === retries - 1) {
          logger.error(`Falha ao enviar webhook após ${retries} tentativas`);
          return false;
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
      }
    }
    
    return false;
  }
}

module.exports = WebhookService;