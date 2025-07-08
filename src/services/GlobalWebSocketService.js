const WebSocket = require('ws');
const config = require('../config/env');
const { authenticateWebSocketSecret } = require('../middleware/globalAuth');
const logger = require('../utils/logger');
const BaileysService = require('./BaileysService');
const MessageQueueService = require('./MessageQueueService');

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
      message: 'Conectado ao WebSocket global. Envie {"type":"auth","secret":"seu-secret"} para autenticar.',
      clientId
    }));
  }

  async handleMessage(ws, data, clientId) {
    switch (data.type) {
      case 'auth':
        await this.handleAuth(ws, data, clientId);
        break;
      case 'subscribe':
        await this.handleSubscribe(ws, data, clientId);
        break;
      case 'unsubscribe':
        await this.handleUnsubscribe(ws, data, clientId);
        break;
      case 'ping':
        ws.send(JSON.stringify({
          type: 'pong',
          timestamp: Date.now(),
          clientId
        }));
        break;
      case 'get_sessions':
        await this.handleGetSessions(ws, clientId);
        break;

      default:
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Tipo de mensagem não reconhecido',
          availableTypes: ['auth', 'subscribe', 'unsubscribe', 'ping', 'get_sessions', 'sendmsg']
        }));
    }
  }

  async handleAuth(ws, data, clientId) {
    try {

      const authResult = authenticateWebSocketSecret(data.secret);

      if (!authResult.success) {
        ws.send(JSON.stringify({
          type: 'auth_error',
          message: authResult.message
        }));
        return;
      }

      this.clients.set(clientId, {
        ws,
        authenticated: true,
        subscriptions: [],
        connectedAt: new Date()
      });

      ws.send(JSON.stringify({
        type: 'auth_success',
        message: 'Autenticado com sucesso no WebSocket global',
        clientId,
        features: ['subscribe', 'unsubscribe', 'get_sessions', 'ping']
      }));

      logger.info(`Cliente WebSocket global autenticado: ${clientId}`);
    } catch (error) {
      logger.error('Erro na autenticação WebSocket global:', error);
      ws.send(JSON.stringify({
        type: 'auth_error',
        message: 'Erro na autenticação'
      }));
    }
  }

  async handleSubscribe(ws, data, clientId) {
    try {
      const client = this.clients.get(clientId);

      if (!client || !client.authenticated) {
        ws.send(JSON.stringify({
          type: 'subscribe_error',
          message: 'Cliente não autenticado'
        }));
        return;
      }

      const { sessionId, events } = data;

      if (!sessionId) {
        ws.send(JSON.stringify({
          type: 'subscribe_error',
          message: 'sessionId é obrigatório'
        }));
        return;
      }

      // Se não especificar eventos, inscreve em todos
      const eventsToSubscribe = events || [
        'qr_updated',
        'session_connected',
        'session_disconnected',
        'message_received',
        'presence_update',
        'chats_update',
        'contacts_update',
        'groups_update'
      ];

      // Adiciona ou atualiza inscrição
      const existingSubscription = client.subscriptions.find(sub => sub.sessionId === sessionId);
      if (existingSubscription) {
        existingSubscription.events = [...new Set([...existingSubscription.events, ...eventsToSubscribe])];
      } else {
        client.subscriptions.push({
          sessionId,
          events: eventsToSubscribe,
          subscribedAt: new Date()
        });
      }

      ws.send(JSON.stringify({
        type: 'subscribe_success',
        sessionId,
        events: eventsToSubscribe,
        message: `Inscrito nos eventos da sessão ${sessionId}`
      }));

      logger.info(`Cliente ${clientId} inscrito na sessão ${sessionId} para eventos: ${eventsToSubscribe.join(', ')}`);
    } catch (error) {
      logger.error('Erro na inscrição WebSocket global:', error);
      ws.send(JSON.stringify({
        type: 'subscribe_error',
        message: 'Erro ao inscrever na sessão'
      }));
    }
  }

  async handleUnsubscribe(ws, data, clientId) {
    try {
      const client = this.clients.get(clientId);

      if (!client || !client.authenticated) {
        ws.send(JSON.stringify({
          type: 'unsubscribe_error',
          message: 'Cliente não autenticado'
        }));
        return;
      }

      const { sessionId } = data;

      if (!sessionId) {
        ws.send(JSON.stringify({
          type: 'unsubscribe_error',
          message: 'sessionId é obrigatório'
        }));
        return;
      }

      // Remove inscrição
      client.subscriptions = client.subscriptions.filter(sub => sub.sessionId !== sessionId);

      ws.send(JSON.stringify({
        type: 'unsubscribe_success',
        sessionId,
        message: `Desinscrito da sessão ${sessionId}`
      }));

      logger.info(`Cliente ${clientId} desinscrito da sessão ${sessionId}`);
    } catch (error) {
      logger.error('Erro ao desinscrever WebSocket global:', error);
      ws.send(JSON.stringify({
        type: 'unsubscribe_error',
        message: 'Erro ao desinscrever da sessão'
      }));
    }
  }

  async handleGetSessions(ws, clientId) {
    try {
      const client = this.clients.get(clientId);

      if (!client || !client.authenticated) {
        ws.send(JSON.stringify({
          type: 'get_sessions_error',
          message: 'Cliente não autenticado'
        }));
        return;
      }

      const BaileysService = require('./BaileysService');
      const stats = BaileysService.getSessionsStats();

      ws.send(JSON.stringify({
        type: 'sessions_info',
        data: {
          stats,
          subscriptions: client.subscriptions
        }
      }));
    } catch (error) {
      logger.error('Erro ao obter informações das sessões:', error);
      ws.send(JSON.stringify({
        type: 'get_sessions_error',
        message: 'Erro ao obter informações das sessões'
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
      timestamp: new Date().toISOString()
    });

    let sentCount = 0;

    for (const [clientId, client] of this.clients.entries()) {
      if (client.authenticated && client.ws.readyState == WebSocket.OPEN) {
        // Verifica se o cliente está inscrito nesta sessão e evento
        try {
          client.ws.send(message);
          sentCount++;
        } catch (error) {
          logger.error(`Erro ao enviar mensagem WebSocket global para ${clientId}:`, error);
          // Remove cliente com erro
          this.clients.delete(clientId);
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

  getConnectedClients() {
    return Array.from(this.clients.entries()).map(([clientId, client]) => ({
      clientId,
      authenticated: client.authenticated,
      subscriptions: client.subscriptions,
      connectedAt: client.connectedAt
    }));
  }

  getStats() {
    const clients = this.getConnectedClients();
    return {
      enabled: this.isEnabled,
      totalClients: clients.length,
      authenticatedClients: clients.filter(c => c.authenticated).length,
      totalSubscriptions: clients.reduce((sum, c) => sum + c.subscriptions.length, 0)
    };
  }
}

module.exports = GlobalWebSocketService;