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

  handleConnection(ws, req) {

    if (!this.isEnabled) {
      ws.close(1000, 'WebSocket global desabilitado');
      return;
    }

    logger.info('Nova conexão WebSocket global recebida');

    const clientId = this.generateClientId();
    this.clients.set(clientId, {
      ws,
      authenticated: false,
      events: [],
      sessionId: null,
      connectedAt: moment().tz(config.timeZone).format('YYYY-MM-DD HH:mm:ss')
    });

    const authTimeout = setTimeout(() => {
      if (!this.clients.get(clientId)?.authenticated) {
        console.log(`Authentication timeout for session ID: ${clientId}`);
        ws.close(4001, 'Authentication timeout');
        this.clients.delete(clientId);
      }
    }, parseInt(config.auth_timeout) * 60_000);

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
      message: `Conectado ao WebSocket. Envie {"type":"auth","secret":"seu-secret", events: ['Eventos'] } para autenticar. Você tem ${parseInt(config.auth_timeout)} minuto pra se conectar`,
      clientId
    }));
  }

  async handleMessage(ws, data, clientId) {
    switch (data.type) {
      case 'auth':
        await this.autenticacao(ws, data, clientId);
        break;

      case 'ping':
        ws.send(JSON.stringify({
          type: 'pong',
          timestamp: moment().tz(config.timeZone).format('YYYY-MM-DD HH:mm:ss'),
          clientId
        }));
        break;

      case 'set_events':
        await this.setEvents(ws, data, clientId);
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

      const { secret = null, modo = null, events = [] } = data
      if (!secret) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'paramentro secret e obrigatorio'
        }));
        return;
      }

      if (!modo || (modo != 'global' && modo != 'client')) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'paramentro modo e obrigatorio e deve ser global ou client'
        }));
        return;
      }
      if (!Array.isArray(events)) {
        ws.send(JSON.stringify({
          type: 'error',
          message: 'paramentro events deve ser um array valido'
        }));
        return;
      }

      const authResult = await authenticateWebSocketSecret(secret, modo);

      if (!authResult.success) {
        ws.send(JSON.stringify({
          type: 'error',
          message: authResult.message
        }));
        return;
      }
      const client = this.clients.get(clientId);
      client.authenticated = true;
      client.events = events;
      client.connectedAt = moment().tz(config.timeZone).format('YYYY-MM-DD HH:mm:ss');
      client.sessionId = modo == 'global' ? 'global' : secret;

      ws.send(JSON.stringify({
        type: 'auth_success',
        message: 'Autenticado com sucesso no WebSocket',
        clientId,
        events: events
      }));

      logger.info(`Cliente WebSocket global autenticado: ${clientId}`);
    } catch (error) {
      logger.error('Erro na autenticação WebSocket global:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Erro na autenticação'
      }));
    }
  }

  async setEvents(ws, data, clientId) {
    try {

      const { events = [] } = data
      const getClient = this.clients.get(clientId)
      console.log(getClient)
    } catch (error) {
      logger.error('Erro na autenticação WebSocket global:', error);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Erro na autenticação'
      }));
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
        if (client == 'global') {
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