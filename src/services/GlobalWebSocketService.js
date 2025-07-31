const WebSocket = require('ws');
const config = require('../config/env');
const { authenticateWebSocketSecret } = require('../middleware/globalAuth');
const logger = require('../utils/logger');
const BaileysService = require('./BaileysService');
const moment = require('moment-timezone');

class GlobalWebSocketService {
  constructor(wss) {
    this.wss = wss;
    this.clients = new Map();
    this.isEnabled = config.enableGlobalWebsocket;

    if (this.isEnabled) {
      this.wss.on('connection', (ws, req) => {
        this.handleConnection(ws, req);
      });
      logger.info('🔌 WebSocket global habilitado');
    } else {
      logger.info('🔌 WebSocket global desabilitado');
    }
  }

  async handleConnection(ws, req) {

    if (!this.isEnabled) {
      ws.close(1000, 'WebSocket global desabilitado');
      return;
    }

    const { apikey = null, modo = null, events = [] } = req.headers

    if (!apikey || !modo) {
      ws.close(1000, 'Dados faltando no headers ex: {apikey: <sua apikey>, modo: <global ou client>, events: []}');
      return;
    }

    if (modo !== 'global' && modo !== 'client') {
      ws.close(1000, 'modo deve ser global ou client');
      return;
    }

    let eventos = []
    try {
      eventos = JSON.parse(events)
    } catch (error) {
      ws.close(1000, 'paramentro events deve ser um array valido');
      return;
    }

    if (!Array.isArray(eventos)) {
      ws.close(1000, 'paramentro events deve ser um array valido');
      return;
    }

    const clientId = this.generateClientId();
    this.clients.set(clientId, {
      ws,
      authenticated: false,
      events: [],
      sessionId: null,
      connectedAt: moment().tz(config.timeZone).format('YYYY-MM-DD HH:mm:ss'),
      modo: null
    });

    const auth = await this.autenticacao(ws, { apikey, modo, eventos }, clientId)
    if (!auth) {
      this.clients.delete(clientId)
      ws.close();
      return;
    }

    ws.send(JSON.stringify({
      type: 'welcome',
      message: 'Autenticado com sucesso no WebSocket',
      clientId,
      events: events
    }));
    logger.info('Nova conexão WebSocket global recebida');

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        this.handleMessage(ws, data, clientId);
      } catch (error) {
        logger.error('Erro ao processar mensagem WebSocket:', error);
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Formato de mensagem inválido'
        }));
      }
    });

    ws.on('close', () => {
      this.clients.delete(clientId);
      logger.info(`Cliente WebSocket global desconectado: ${clientId}`);
    });

    ws.on('error', (error) => {
      logger.error('Erro WebSocket global:', error);
      this.clients.delete(clientId);
    });


    // Send welcome message
    ws.send(JSON.stringify({
      type: 'welcome',
      message: `Conectado ao WebSocket da Flash API.`,
      clientId
    }));
  }

  async handleMessage(ws, data, clientId) {
    switch (data.type) {

      case 'ping':
        ws.send(JSON.stringify({
          type: 'pong',
          timestamp: moment().tz(config.timeZone).format('YYYY-MM-DD HH:mm:ss'),
          clientId
        }));
        break;

      default:
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Tipo de mensagem não reconhecido',
          availableTypes: ['auth', 'ping']
        }));
    }
  }

  async autenticacao(ws, data, clientId) {
    try {

      const { apikey = null, modo = null, eventos = [] } = data

      const authResult = await authenticateWebSocketSecret(apikey, modo);

      if (!authResult.success) {
        ws.close(1000, authResult.message);
        return false;
      }
      
      const client = this.clients.get(clientId);
      client.authenticated = true;
      client.events = eventos;
      client.connectedAt = moment().tz(config.timeZone).format('YYYY-MM-DD HH:mm:ss');
      client.sessionId = apikey;
      client.modo = modo;
      logger.info(`Cliente WebSocket global autenticado: ${clientId}`);
      return true;

    } catch (error) {
      console.log(error)
      logger.error('Erro na autenticação WebSocket global:', error);
      ws.close(1000, 'Erro na autenticação');
      return false;
    }
  }

  broadcast(sessionId, event, data) {
    if (!this.isEnabled) return;
    const message = JSON.stringify({
      type: 'event',
      sessionId,
      event,
      data,
      timestamp: moment().tz(config.timeZone).format('YYYY-MM-DD HH:mm:ss')
    });
    let sentCount = 0;

    for (const [clientId, client] of this.clients.entries()) {
          
      if (client.authenticated && client.ws.readyState == WebSocket.OPEN) {
        // Verifica se o cliente está inscrito nesta sessão e evento     
        if (client.modo == 'global') {
          
          try {
            const foundEvent = client.events.find(e => e === event);
            if (!foundEvent) continue;
            client.ws.send(message);
            sentCount++;
          } catch (error) {
            logger.error(`Erro ao enviar mensagem WebSocket global para ${clientId}:`, error);
            // Remove cliente com erro
            this.clients.delete(clientId);
          }
        } else {
          if (client.sessionId && client.sessionId === sessionId) {
            try {
              const foundEvent = client.events.find(e => e === event);
              if (!foundEvent) continue;
              client.ws.send(message);
              sentCount++;
            } catch (error) {
              logger.error(`Erro ao enviar mensagem WebSocket global para ${clientId}:`, error);
              // Remove cliente com erro
              this.clients.delete(clientId);
            }
          }
        }

      }
    }

    if (sentCount > 0) {
      logger.debug(`Evento ${event} da sessão ${sessionId} enviado para ${sentCount} clientes WebSocket`);
    }
  }

  generateClientId() {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

}

module.exports = GlobalWebSocketService;