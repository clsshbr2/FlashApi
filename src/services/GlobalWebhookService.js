const axios = require('axios');
const config = require('../config/env');
const logger = require('../utils/logger');

class GlobalWebhookService {
  constructor() {
    this.isEnabled = config.enableGlobalWebhook;
    this.webhookUrl = config.globalWebhookUrl;
    this.secret = config.globalWebhookSecret;
  }
  
  async sendGlobalWebhook(eventData, retries = 3) {
    if (!this.isEnabled || !this.webhookUrl) {
      logger.debug('Webhook global desabilitado ou URL não configurada');
      return false;
    }

    const payload = {
      ...eventData,
      timestamp: new Date().toISOString()
    };
    for (let i = 0; i < retries; i++) {
      try {
        const response = await axios.post(this.webhookUrl, payload, {
          timeout: 10000,
          headers: {
            'Content-Type': 'application/json',
          }
        });

        if (response.status >= 200 && response.status < 300) {
          logger.info(`Webhook global enviado com sucesso: ${eventData.event}`);
          return true;
        }
      } catch (error) {
        console.log(error)
        logger.error(`Tentativa ${i + 1} - Erro ao enviar webhook global:`, {
          error: error.message,
          event: eventData.event,
          sessionId: eventData.sessionId
        });
        
        if (i === retries - 1) {
          logger.error(`Falha ao enviar webhook global após ${retries} tentativas`);
          return false;
        }
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
      }
    }
    
    return false;
  }

  generateSignature(payload) {
    const crypto = require('crypto');
    const payloadString = JSON.stringify(payload);
    return crypto
      .createHmac('sha256', this.secret)
      .update(payloadString)
      .digest('hex');
  }

  // Método para validar webhook recebido
  validateWebhookSignature(payload, signature) {
    const expectedSignature = this.generateSignature(payload);
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  }

  isGlobalWebhookEnabled() {
    return this.isEnabled && !!this.webhookUrl;
  }

  getWebhookInfo() {
    return {
      enabled: this.isEnabled,
      url: this.webhookUrl ? `${this.webhookUrl.substring(0, 20)}...` : null,
      hasSecret: !!this.secret
    };
  }
}

module.exports = new GlobalWebhookService();