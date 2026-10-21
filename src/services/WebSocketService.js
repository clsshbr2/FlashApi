import WebSocket from 'ws';
import config from '../config/env.js';
import auth from '../middleware/globalAuth.js';
import logger from '../utils/logger.js';
import WhatsAppService from './WhatsAppService.js';
import moment from 'moment-timezone';
import WebhookService from './WebhookService.js';
import Session from '../models/Session.js';
import redis, { KEYS } from './redis.js';

const clients = new Map();

class WebSocketService {

  constructor(wss) {
    this.wss = wss;
    this.globalEnable = config.enableGlobalWebsocket;

    this.wss.on('connection', async (ws, req) => {
      try {
        const { apikey, events } = req.headers
        const clientId = this.generateClientId();
        let tipo = 'user';
        let eventos = events

        ws.on('close', () => {
          clients.delete(clientId);
        });

        ws.on('error', () => {
          clients.delete(clientId);
        });


        if (typeof events == 'string') {
          try {
            eventos = JSON.parse(events)
          } catch (error) { }

        }

        if (typeof eventos !== "object") {
          logger.error(`Dados de eventos invalidos tipo: ${typeof eventos}`)
          return ws.close(1000, 'Dados de events invalidos deve ser um array ["message_received", "qr_updated"]');
        }

        if (apikey === config.globalWebsocketSecret) {
          if (!this.globalEnable) {
            return ws.close(1000, 'WebSocket global desativado pelo admin');
          }
          tipo = 'admin'
        } else {
          const getsessao = await Session.findById(apikey);
          if (!getsessao) {
            return ws.close(1000, 'Apikey invalida');
          }
        }

        this.setClients(clientId, {
          ws,
          authenticated: true,
          events: eventos,
          apikey,
          connectedAt: moment().tz(config.timeZone).format('DD-MM-YYYY HH:mm:ss'),
          tipo
        });

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

        ws.send(JSON.stringify({
          type: 'welcome',
          message: 'Autenticado com sucesso no WebSocket',
          clientId,
          events: events
        }));

      } catch (error) {
        console.log(error)
        return ws.send(JSON.stringify({
          type: 'error',
          message: 'Erro ao autenticar com usuario',
          error: error.message || error
        }));
      }

    });

    this.wss.on('close', (teste) => {
      console.log(teste)
    })

  }

  generateClientId() {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  setClients(clienteid, dados) {
    clients.set(clienteid, dados);
  }

  static async emitEvents(sessionId, event, data) {
    const message = JSON.stringify({
      type: 'event',
      sessionId,
      event,
      data,
      timestamp: moment().tz(config.timeZone).format('DD-MM-YYYY HH:mm:ss')
    });

    if (config?.enableGlobalWebhook) {
      WebhookService.sendWebhook(config.globalWebhookUrl, message);
    }

    //enviar via websocket
    const getSessao = await redis.get(KEYS().sessao(sessionId))
    if (getSessao && getSessao.webhook_status === 1) {
      const foundEvent = getSessao.events.find(e => e === event);
      if (foundEvent) {
        WebhookService.sendWebhook(getSessao.webhook_url, message);
      }
    }

    //enviar via websocket
    for (const [clientId, client] of clients.entries()) {
      if (client.authenticated && client.ws.readyState == WebSocket.OPEN) {

        // Verifica se o cliente está inscrito nesta sessão e evento     
        if (client.tipo == 'admin') {
          try {

            const foundEvent = client.events.find(e => e === event);
            if (!foundEvent) continue;
            client.ws.send(message);
          } catch (error) {
            logger.error(`Erro ao enviar mensagem WebSocket global para ${clientId}:`, error);
          }
        } else {

          if (client.apikey && client.apikey === sessionId) {
            try {
              const foundEvent = client.events.find(e => e === event);
              if (!foundEvent) continue;
              client.ws.send(message);
            } catch (error) {
              logger.error(`Erro ao enviar mensagem WebSocket global para ${clientId}:`, error);

            }
          }
        }

      }
    }
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


}

export default WebSocketService