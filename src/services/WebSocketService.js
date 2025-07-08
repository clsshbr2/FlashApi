const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const Session = require('../models/Session');

class WebSocketService {
  constructor(wss) {
    this.wss = wss;
    this.clients = new Map();

    this.wss.on('connection', (ws, req) => {
      this.handleConnection(ws, req);
    });
  }

  handleConnection(ws, req) {
    logger.info('Nova conexão WebSocket recebida');
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        this.handleMessage(ws, data);
      } catch (error) {
        logger.error('Erro ao processar mensagem WebSocket:', error);
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Formato de mensagem inválido'
        }));
      }
    });

    ws.on('close', () => {
      // Remove client from authenticated clients
      for (const [apiKey, client] of this.clients.entries()) {
        if (client.ws === ws) {
          this.clients.delete(apiKey);
          logger.info(`Cliente WebSocket desconectado: ${apiKey}`);
          break;
        }
      }
    });

    ws.on('error', (error) => {
      logger.error('Erro WebSocket:', error);
    });
  }

  async handleMessage(ws, data) {
    switch (data.type) {
      case 'auth':
        await this.handleAuth(ws, data);
        break;
      case 'subscribe':
        await this.handleSubscribe(ws, data);
        break;
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        break;
      default:
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Tipo de mensagem não reconhecido'
        }));
    }
  }

  async handleAuth(ws, data) {
    try {
      console.log(data)
      if (!data.apiKey) {
        ws.send(JSON.stringify({
          type: 'auth_error',
          message: 'API Key é obrigatória'
        }));
        return;
      }

      const getsessao = await Session.findById(data.apiKey)
      if (!getsessao) {
        ws.send(JSON.stringify({
          type: 'auth_error',
          message: 'API Key Invalida'
        }));
        return;
      }
      
      this.clients.set(data.apiKey, {
        ws,
        authenticated: true,
        subscriptions: []
      });

      ws.send(JSON.stringify({
        type: 'auth_success',
        message: 'Autenticado com sucesso'
      }));

      logger.info(`Cliente WebSocket autenticado: ${data.apiKey}`);
    } catch (error) {
      logger.error('Erro na autenticação WebSocket:', error);
      ws.send(JSON.stringify({
        type: 'auth_error',
        message: 'Erro na autenticação'
      }));
    }
  }

  async handleSubscribe(ws, data) {
    try {
      // Find the client
      let clientData = null;
      let apiKey = null;

      for (const [key, client] of this.clients.entries()) {
        if (client.ws === ws) {
          clientData = client;
          apiKey = key;
          break;
        }
      }

      if (!clientData || !clientData.authenticated) {
        ws.send(JSON.stringify({
          type: 'subscribe_error',
          message: 'Cliente não autenticado'
        }));
        return;
      }

      if (!data.sessionId) {
        ws.send(JSON.stringify({
          type: 'subscribe_error',
          message: 'Session ID é obrigatório'
        }));
        return;
      }

      // Add subscription
      if (!clientData.subscriptions.includes(data.sessionId)) {
        clientData.subscriptions.push(data.sessionId);
      }

      ws.send(JSON.stringify({
        type: 'subscribe_success',
        sessionId: data.sessionId,
        message: 'Inscrito nos eventos da sessão'
      }));

      logger.info(`Cliente ${apiKey} inscrito na sessão ${data.sessionId}`);
    } catch (error) {
      logger.error('Erro na inscrição WebSocket:', error);
      ws.send(JSON.stringify({
        type: 'subscribe_error',
        message: 'Erro ao inscrever na sessão'
      }));
    }
  }

  broadcast(sessionId, event, data) {
    const message = JSON.stringify({
      type: 'event',
      sessionId,
      event,
      data,
      timestamp: Date.now()
    });

    for (const [apiKey, client] of this.clients.entries()) {
      if (client.authenticated &&
        client.subscriptions.includes(sessionId) &&
        client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(message);
        } catch (error) {
          logger.error(`Erro ao enviar mensagem WebSocket para ${apiKey}:`, error);
        }
      }
    }
  }

  getConnectedClients() {
    return Array.from(this.clients.keys());
  }
}

module.exports = WebSocketService;