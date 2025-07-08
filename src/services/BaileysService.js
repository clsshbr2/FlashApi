const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeInMemoryStore,
  jidNormalizedUser,
  proto,
  getAggregateVotesInPollMessage,
  downloadContentFromMessage,
  generateWAMessageFromContent,
  prepareWAMessageMedia,
  generateWAMessageContent,
  generateMessageID,
  makeCacheableSignalKeyStore,
  sendListMessage,
  Browsers,
  decryptPollVote
} = require('@whiskeysockets/baileys');

const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const pino = require('pino');
const Session = require('../models/Session');
const Store = require('../models/Store');
const GlobalWebhookService = require('./GlobalWebhookService');
const WebhookService = require('./WebhookService');
const logger = require('../utils/logger');
const configenv = require('../config/env');
const GlobalWebSocketService = require('./GlobalWebSocketService');
const digestSync = require('crypto-digest-sync');
const moment = require('moment-timezone');

class BaileysService {
  constructor() {
    this.sessions = new Map();
    this.globalWebSocketService = null;
    this.healthCheckInterval = null;
    this.syncQueues = new Map(); // Filas de sincronização para evitar sobrecarga
  }

  setGlobalWebSocketService(service) {
    this.globalWebSocketService = service;
  }

  async initialize() {
    logger.info('🔄 Inicializando BaileysService...');

    // Criar diretório de sessões se não existir
    const sessionsDir = path.join(process.cwd(), 'sessions');
    if (!fs.existsSync(sessionsDir)) {
      fs.mkdirSync(sessionsDir, { recursive: true });
    }

    // Restaurar sessões ativas do banco
    await this.restoreActiveSessions();

    // Iniciar health check
    this.startHealthCheck();

    logger.info('✅ BaileysService inicializado');
  }

  async restoreActiveSessions() {
    try {
      const sessions = await Session.findByApiKey();
      logger.info(`🔄 Restaurando ${sessions.length} sessões do banco de dados...`);

      for (const session of sessions) {
        if (session.status === 'connected' || session.status === 'connecting') {
          logger.info(`🔄 Restaurando sessão: ${session.apikey}`);
          await this.createSession(session.apikey, session.numero, false);
        }
      }
    } catch (error) {
      logger.error('❌ Erro ao restaurar sessões:', error);
    }
  }

  async createSession(sessionId, phoneNumber = null, updateStatus = true) {
    try {
      // Se a sessão já existe, remover primeiro
      if (this.sessions.has(sessionId)) {
        logger.warn(`⚠️ Sessão ${sessionId} já existe, removendo para recriar...`);
        await this.removeSession(sessionId);
      }

      logger.info(`🚀 Criando sessão: ${sessionId}`);

      const sessionDir = path.join(process.cwd(), 'sessions', sessionId);
      if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
      }

      const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
      const { version, isLatest } = await fetchLatestBaileysVersion();

      logger.info(`📱 Usando Baileys v${version.join('.')}, isLatest: ${isLatest}`);

      const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        browser: Browsers.macOS('Desktop'),
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'error' }))
        },
        generateHighQualityLinkPreview: true,
        syncFullHistory: true, // Reduzir carga inicial
        markOnlineOnConnect: true,
        fireInitQueries: true,
        emitOwnEvents: true,
        getMessage: async (key) => {
          const msg = await this.getMessage(key);
          return msg || undefined
        }
      });


      const sessionData = {
        sock,
        status: 'connecting',
        phoneNumber,
        reconnectAttempts: 0,
        lastConnected: null,
        connectionAttempts: 0,
        qrRetries: 0,
        maxQrRetries: 5
      };

      this.sessions.set(sessionId, sessionData);

      // Event handlers
      this.EventsGet(sock, sessionId, saveCreds, updateStatus);

      return sessionData;
    } catch (error) {
      console.log(error)
      logger.error(`❌ Erro ao criar sessão ${sessionId}:`, error);
      throw error;
    }
  }

  // Nova função para remover sessão sem deletar arquivos
  async removeSession(sessionId) {
    try {
      const sessionData = this.sessions.get(sessionId);
      if (sessionData) {
        // Fechar WebSocket se existir
        if (sessionData.sock?.ws) {
          sessionData.sock.ws.close();
        }

        // Remover do Map
        this.sessions.delete(sessionId);
        this.syncQueues.delete(sessionId);

        logger.info(`🗑️ Sessão ${sessionId} removida da memória`);
      }
    } catch (error) {
      logger.error(`Erro ao remover sessão ${sessionId}:`, error);
    }
  }

  async getMessage(key, full = false) {
    try {
      console.log('getmensagem: ', key)
      return
      const webMessageInfo = await Store.getMessages(key);
      if (full) {
        return webMessageInfo[0];
      }
      if (webMessageInfo[0].message?.pollCreationMessage) {
        const messageSecretBase64 = webMessageInfo[0].message?.messageContextInfo?.messageSecret;

        if (typeof messageSecretBase64 === 'string') {
          const messageSecret = Buffer.from(messageSecretBase64, 'base64');

          const msg = {
            messageContextInfo: { messageSecret },
            pollCreationMessage: webMessageInfo[0].message?.pollCreationMessage,
          };

          return msg;
        }
      }

      return webMessageInfo[0].message;
    } catch (error) {
      console.log(error)
      return { conversation: '' };
    }
  }

  //Eventos
  EventsGet(sock, sessionId, saveCreds, updateStatus) {
    // Connection updates
    sock.ev.on('connection.update', async (update) => {
      await this.update_conexao(sessionId, update, updateStatus);
    });

    // Credentials update
    sock.ev.on('creds.update', saveCreds);

    // Messages - com throttling
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      await this.msgrecebidas(sessionId, messages, type);
    });

    // Message updates (read receipts, etc)
    sock.ev.on('messages.update', async (updates) => {
      await this.update_mensagem(sessionId, updates);
    });

    // Chats - com throttling
    sock.ev.on('chats.set', async ({ chats }) => {
      await this.chats_set(sessionId, 'chats', async () => {
        try {
          logger.info(`📂 Evento chats.set: ${chats.length} chats recebidos para sessão ${sessionId}`);

          // Processar em lotes para evitar sobrecarga
          const batchSize = 50;
          for (let i = 0; i < chats.length; i += batchSize) {
            const batch = chats.slice(i, i + batchSize);
            for (const chat of batch) {
              await Store.saveChat(sessionId, chat);
            }
            // Pequena pausa entre lotes
            await this.delay(100);
          }

          logger.info(`💾 ${chats.length} chats salvos no MySQL para sessão ${sessionId}`);
        } catch (error) {
          logger.error(`Erro ao salvar chats no MySQL:`, error);
        }
      });
    });

    sock.ev.on('chats.update', async (updates) => {
      await this.chats_set(sessionId, 'chats_update', async () => {
        try {
          logger.info(`📂 Atualizando ${updates.length} chats para sessão ${sessionId}`);
          for (const update of updates) {
            await Store.saveChat(sessionId, update);
          }
        } catch (error) {
          logger.error(`Erro ao atualizar chats:`, error);
        }
      });
    });

    // Contacts - com throttling
    sock.ev.on('contacts.set', async ({ contacts }) => {
      await this.chats_set(sessionId, 'contacts', async () => {
        try {
          logger.info(`👥 Evento contacts.set: ${contacts.length} contatos recebidos para sessão ${sessionId}`);

          // Processar em lotes
          const batchSize = 100;
          for (let i = 0; i < contacts.length; i += batchSize) {
            const batch = contacts.slice(i, i + batchSize);
            for (const contact of batch) {
              await Store.saveContact(sessionId, contact);
            }
            await this.delay(50);
          }

          logger.info(`💾 ${contacts.length} contatos salvos no MySQL para sessão ${sessionId}`);
        } catch (error) {
          logger.error(`Erro ao salvar contatos no MySQL:`, error);
        }
      });
    });

    sock.ev.on('contacts.update', async (updates) => {
      await this.chats_set(sessionId, 'contacts_update', async () => {
        try {
          logger.info(`👥 Atualizando ${updates.length} contatos para sessão ${sessionId}`);
          for (const update of updates) {
            await Store.saveContact(sessionId, update);
          }
        } catch (error) {
          logger.error(`Erro ao atualizar contatos:`, error);
        }
      });
    });

    // Groups - com throttling
    sock.ev.on('groups.update', async (updates) => {
      await this.chats_set(sessionId, 'groups', async () => {
        try {
          logger.info(`👥 Atualizando ${updates.length} grupos para sessão ${sessionId}`);
          for (const update of updates) {
            await Store.saveGroup(sessionId, update);
          }
        } catch (error) {
          logger.error(`Erro ao atualizar grupos:`, error);
        }
      });
    });

    // Presence updates
    sock.ev.on('presence.update', async ({ id, presences }) => {
      await this.handlePresenceUpdate(sessionId, id, presences);
    });

    // Call events
    sock.ev.on('call', async (calls) => {
      await this.event_call(sessionId, calls);
    });

    // Histórico - com throttling
    sock.ev.on('messaging-history.set', async ({ chats, contacts, messages, isLatest }) => {
      //  console.log(contacts)
      await this.chats_set(sessionId, 'history', async () => {
        try {
          console.log(`📚 Histórico carregado para sessão ${sessionId}: ${chats.length} chats, ${contacts.length} contatos, ${messages.length} mensagens`)
          logger.info(`📚 Histórico carregado para sessão ${sessionId}: ${chats.length} chats, ${contacts.length} contatos, ${messages.length} mensagens`);

          // Processar em lotes pequenos
          const batchSize = 25;

          // Salvar chats
          for (let i = 0; i < chats.length; i += batchSize) {
            const batch = chats.slice(i, i + batchSize);
            for (const chat of batch) {
              try {
                await Store.saveChat(sessionId, chat);
              } catch (error) {
                console.error('Error ao salvar contato: ', error)
              }

            }
            await this.delay(100);
          }

          // Salvar contatos
          for (let i = 0; i < contacts.length; i += batchSize) {
            const batch = contacts.slice(i, i + batchSize);
            for (const contact of batch) {
              try {
                await Store.saveContact(sessionId, contact);
              } catch (error) {
                console.error('Error ao salvar contato: ', error)
              }

            }
            await this.delay(100);
          }

          // Salvar mensagens (limitado)
          const limitedMessages = messages.slice(0, 100); // Limitar a 100 mensagens
          for (let i = 0; i < limitedMessages.length; i += batchSize) {
            const batch = limitedMessages.slice(i, i + batchSize);
            for (const message of batch) {
              await Store.saveMessage(sessionId, message);
            }
            await this.delay(100);
          }

          logger.info(`💾 Histórico salvo no MySQL para sessão ${sessionId}`);
        } catch (error) {
          console.log(`Erro ao salvar histórico:`, error)
          logger.error(`Erro ao salvar histórico:`, error);
        }
      });
    });
  }

  // Função para throttling de sincronização
  async chats_set(sessionId, type, syncFunction) {
    const queueKey = `${sessionId}_${type}`;

    if (this.syncQueues.has(queueKey)) {
      logger.debug(`Sincronização ${type} já em andamento para ${sessionId}, ignorando...`);
      return;
    }

    this.syncQueues.set(queueKey, true);

    try {
      await syncFunction();
    } finally {
      // Remover da fila após um delay
      setTimeout(() => {
        this.syncQueues.delete(queueKey);
      }, 5000);
    }
  }

  async update_conexao(sessionId, update, updateStatus = true) {
    const { connection, lastDisconnect, qr } = update;
    const sessionData = this.sessions.get(sessionId);

    if (!sessionData) return;
    logger.info(`🔄 Conexão ${sessionId}: ${connection || 'indefinido'}`);

    if (qr) {
      try {
        const qrCodeDataURL = await QRCode.toDataURL(qr);
        sessionData.qrCode = qrCodeDataURL;

        if (updateStatus) {
          await Session.update(sessionId, {
            status: 'qr_ready',
            qr_code: qrCodeDataURL
          });
        }

        // Emit QR code event
        await this.emitEvent(sessionId, 'qr_updated', { qr: qrCodeDataURL });

        logger.info(`📱 QR Code gerado para sessão ${sessionId}`);
      } catch (error) {
        console.log(error)
        logger.error(`Erro ao gerar QR Code para ${sessionId}:`, error);
      }
    }

    if (connection === 'close') {

      const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;

      if (shouldReconnect) {
        sessionData.reconnectAttempts++;
        logger.info(`🔄 Tentativa de reconexão ${sessionData.reconnectAttempts} para ${sessionId}`);

        if (sessionData.reconnectAttempts <= 5) {
          // Remover sessão atual antes de tentar reconectar
          await this.removeSession(sessionId);

          setTimeout(async () => {
            try {
              await this.createSession(sessionId, sessionData.phoneNumber, updateStatus);
            } catch (error) {
              logger.error(`Erro na reconexão automática ${sessionId}:`, error);
            }
          }, 5000 * sessionData.reconnectAttempts);
        } else {
          logger.error(`❌ Máximo de tentativas de reconexão atingido para ${sessionId}`);
          await this.removeSession(sessionId);
        }
      } else {
        logger.info(`🚪 Sessão ${sessionId} foi desconectada (logout)`);
        await this.removeSession(sessionId);
      }

      if (updateStatus) {
        await Session.update(sessionId, { status: 'disconnected' });
      }

      await this.emitEvent(sessionId, 'session_disconnected', { reason: lastDisconnect?.error?.message });
    }

    if (connection === 'connecting') {
      sessionData.status = 'connecting';
      sessionData.connectionAttempts++;

      if (updateStatus) {
        await Session.update(sessionId, { status: 'connecting' });
      }
    }

    if (connection === 'open') {
      sessionData.status = 'connected';
      sessionData.lastConnected = moment().tz(configenv.timeZone).format('YYYY-MM-DD HH:mm:ss');
      sessionData.reconnectAttempts = 0;
      sessionData.connectionAttempts = 0;

      const phoneNumber = sessionData.sock?.user?.id?.split(':')[0];

      if (updateStatus) {
        await Session.update(sessionId, {
          status: 'connected',
          phone_number: phoneNumber
        });
      }

      await this.emitEvent(sessionId, 'session_connected', {
        phoneNumber,
        user: sessionData.sock?.user
      });

      logger.info(`✅ Sessão ${sessionId} conectada com sucesso! Telefone: ${phoneNumber}`);

      // Sincronização mais conservadora após conexão
      setTimeout(async () => {
        await this.forceSyncContacts(sessionId);
      }, 15000); // Aguardar 15 segundos
    }
  }

  // NOVA FUNÇÃO: Forçar sincronização de contatos
  async forceSyncContacts(sessionId) {
    try {
      const sessionData = this.sessions.get(sessionId);
      if (!sessionData || !sessionData.sock) return;

      logger.info(`🔄 Forçando sincronização de contatos para sessão ${sessionId}...`);

      const sock = sessionData.sock;
      const store = sessionData.store;
      // Estratégia 1: Tentar obter contatos do store
      if (store && store.contacts) {
        const contacts = Object.values(store.contacts);
        logger.info(`📱 Encontrados ${contacts.length} contatos no store interno`);

        // Processar em lotes pequenos
        const batchSize = 50;
        for (let i = 0; i < contacts.length; i += batchSize) {
          const batch = contacts.slice(i, i + batchSize);
          for (const contact of batch) {
            await Store.saveContact(sessionId, contact);
          }
          await this.delay(200); // Pausa maior entre lotes
        }
      }

      // Estratégia 2: Extrair contatos dos chats (limitado)
      if (store && store.chats) {
        const chats = Object.values(store.chats);
        let contactsFromChats = 0;

        for (const chat of chats) {
          if (!chat.id.includes('@g.us')) { // Não é grupo
            const contactData = {
              id: chat.id,
              name: chat.name || chat.notify || null,
              notify: chat.notify || null
            };

            await Store.saveContact(sessionId, contactData);
            contactsFromChats++;

            // Pausa a cada 10 contatos
            if (contactsFromChats % 10 === 0) {
              await this.delay(100);
            }
          }
        }

        logger.info(`📱 Extraídos ${contactsFromChats} contatos dos chats`);
      }

    } catch (error) {
      logger.error(`Erro ao forçar sincronização de contatos para ${sessionId}:`, error);
    }
  }

  // NOVA FUNÇÃO: Forçar sincronização completa 
  async forceSyncAll(sessionId) {
    try {
      logger.info(`🔄 Iniciando sincronização completa para sessão ${sessionId}...`);

      await this.forceSyncContacts(sessionId);
      await this.delay(2000);
      await this.forceSyncChats(sessionId);
      await this.delay(2000);
      await this.forceSyncGroups(sessionId);

      logger.info(`✅ Sincronização completa finalizada para sessão ${sessionId}`);
    } catch (error) {
      logger.error(`Erro na sincronização completa para ${sessionId}:`, error);
    }
  }

  async forceSyncChats(sessionId) {
    try {
      const sessionData = this.sessions.get(sessionId);
      if (!sessionData || !sessionData.store) return;

      const store = sessionData.store;
      if (store.chats) {
        const chats = Object.values(store.chats);
        logger.info(`💬 Sincronizando ${chats.length} chats do store interno`);

        // Processar em lotes
        const batchSize = 25;
        for (let i = 0; i < chats.length; i += batchSize) {
          const batch = chats.slice(i, i + batchSize);
          for (const chat of batch) {
            await Store.saveChat(sessionId, chat);
          }
          await this.delay(200);
        }
      }
    } catch (error) {
      logger.error(`Erro ao sincronizar chats:`, error);
    }
  }

  async forceSyncGroups(sessionId) {
    try {
      const sessionData = this.sessions.get(sessionId);
      if (!sessionData || !sessionData.sock) return;

      const sock = sessionData.sock;

      // Obter grupos que o usuário participa
      const groups = await sock.groupFetchAllParticipating();
      const groupList = Object.values(groups);

      logger.info(`👥 Sincronizando ${groupList.length} grupos`);

      // Processar em lotes pequenos
      const batchSize = 10;
      for (let i = 0; i < groupList.length; i += batchSize) {
        const batch = groupList.slice(i, i + batchSize);
        for (const group of batch) {
          await Store.saveGroup(sessionId, group);
        }
        await this.delay(300);
      }
    } catch (error) {
      logger.error(`Erro ao sincronizar grupos:`, error);
    }
  }

  // Função pública para sincronização manual
  async syncContactsManually(sessionId) {
    await this.forceSyncContacts(sessionId);
  }

  async msgrecebidas(sessionId, messages, type) {
    for (const message of messages) {
      const selectedOptions = [];
      const pollUpdate = message.message?.pollUpdateMessage;
      if (pollUpdate) {
        try {
          const pollMsgId = pollUpdate.pollCreationMessageKey?.id;
          const [msg] = await Store.getMessages(sessionId, message.key.remoteJid, pollMsgId)
          const voterJid = msg.remoteJid;
          const orderId = msg.mensagem_id;

          const decrypted = await decryptPollVote(pollUpdate.vote, {
            pollCreatorJid: this.sessions.get(sessionId).phoneNumber + '@s.whatsapp.net',
            pollMsgId: pollMsgId,
            pollEncKey: Buffer.from(msg.conteudo_mensagem.messageContextInfo?.messageSecret, 'base64'),
            voterJid,
          });

          for (const decryptedHash of decrypted.selectedOptions) {
            const hashHex = Buffer.from(decryptedHash).toString('hex').toUpperCase();
            for (const option of msg.conteudo_mensagem.pollCreationMessageV3?.options || []) {
              const hash = Buffer.from(digestSync("SHA-256", new TextEncoder().encode(Buffer.from(option.optionName).toString())))
                .toString("hex")
                .toUpperCase();
              if (hashHex === hash) {
                selectedOptions.push(option.optionName);
                break;
              }
            }
          }
        } catch (error) {
          console.error(`Erro ao processar atualização de enquete (sessionId: ${sessionId}):`, error);
        }
      }


      try {
        // Salvar mensagem no store
        await Store.saveMessage(sessionId, message);

        // Verificar configurações da sessão
        const config = await Store.getSessionConfig(sessionId);

        // Auto-read
        if (config?.autoRead && !message.key.fromMe) {
          await this.markAsRead(sessionId, message.key.remoteJid, message.key.id);
        }

        // Emit message event
        await this.emitEvent(sessionId, 'message_received', {
          id: message.key.id,
          fromMe: message.key.fromMe,
          type: Object.keys(message.message || {})[0],
          isGroup: message.key.remoteJid.includes('@g.us'),
          content: this.extractMessageContent(message.message),
          message: {
            ...message.message,
            pollVotes: selectedOptions.length > 0 ? selectedOptions : null
          }
        });

      } catch (error) {
        console.log(error)
        logger.error(`Erro ao processar mensagem:`, error);
      }
    }
  }

  async update_mensagem(sessionId, updates) {
    for (const update of updates) {
      try {
        await this.emitEvent(sessionId, 'message_update', {
          jid: update.key.remoteJid,
          update
        });
        // Atualizar status da mensagem no banco
        // Implementar lógica de atualização se necessário

        logger.debug(`📝 Mensagem atualizada: ${update.key.id} - Status: ${update.update?.status}`);
      } catch (error) {
        logger.error(`Erro ao atualizar mensagem:`, error);
      }
    }
  }

  async handlePresenceUpdate(sessionId, id, presences) {
    try {
      await this.emitEvent(sessionId, 'presence_update', {
        jid: id,
        presences
      });
    } catch (error) {
      logger.error(`Erro ao processar atualização de presença:`, error);
    }
  }

  async event_call(sessionId, calls) {
    try {
      const config = await Store.getSessionConfig(sessionId);

      for (const call of calls) {
        if (config?.rejectCalls && call.status === 'offer') {
          const sessionData = this.sessions.get(sessionId);
          if (sessionData?.sock) {
            await sessionData.sock.rejectCall(call.id, call.from);
            if (config.msg_rejectCalls && config.msg_rejectCalls !== '') {
              const message = {
                text: config.msg_rejectCalls,
              };
              await this.sendMessage(sessionId, call.from, message)
            }
            logger.info(`📞 Chamada rejeitada automaticamente de ${call.from}`);
          }
        }
      }
    } catch (error) {
      console.log(error)
      logger.error(`Erro ao processar chamadas:`, error);
    }
  }

  extractMessageContent(message) {
    if (!message) return '';

    if (message.conversation) return message.conversation;
    if (message.extendedTextMessage?.text) return message.extendedTextMessage.text;
    if (message.imageMessage?.caption) return message.imageMessage.caption;
    if (message.videoMessage?.caption) return message.videoMessage.caption;
    if (message.documentMessage?.caption) return message.documentMessage.caption;
    if (message.pollUpdateMessage) return message.pollUpdateMessage
    return JSON.stringify(message);
  }

  async emitEvent(sessionId, event, data) {
    try {

      // Global WebSocket
      if (this.globalWebSocketService) {
        this.globalWebSocketService.broadcast(sessionId, event, data);
      }
      // Global Webhook
      await GlobalWebhookService.sendGlobalWebhook({
        event,
        sessionId,
        data
      });

      // Session-specific webhook
      const config = await Store.getSessionConfig(sessionId);
      if (config?.webhookUrl) {
        const webhookService = new WebhookService();
        await webhookService.sendWebhook(config.webhookUrl, {
          event,
          sessionId,
          data,
          timestamp: moment().tz(configenv.timeZone).toISOString()
        });
      }
      
    } catch (error) {
      console.log(error)
      logger.error(`Erro ao emitir evento ${event}:`, error);
    }
  }

  // Função para preparar mídia antes de enviar
  async prepareMedia(sessionId, mediaData) {
    try {
      const sessionData = this.sessions.get(sessionId);
      if (!sessionData || !sessionData.sock) {
        throw new Error('Sessão não encontrada ou não conectada');
      }

      // Se for URL, retornar como está
      if (typeof mediaData === 'string' && (mediaData.startsWith('http') || mediaData.startsWith('https'))) {
        return { url: mediaData };
      }

      // Se for base64, converter para buffer
      if (typeof mediaData === 'string' && mediaData.startsWith('data:')) {
        const base64Data = mediaData.split(',')[1];
        const buffer = Buffer.from(base64Data, 'base64');
        return buffer;
      }

      // Se for buffer, retornar como está
      if (Buffer.isBuffer(mediaData)) {
        return mediaData;
      }

      // Se for objeto com url
      if (typeof mediaData === 'object' && mediaData.url) {
        return mediaData;
      }

      // Fallback: tentar como URL
      return { url: mediaData };
    } catch (error) {
      logger.error('Erro ao preparar mídia:', error);
      throw new Error('Formato de mídia inválido');
    }
  }

  // Message sending methods
  async sendMessage(sessionId, to, message) {
    try {
      const sessionData = this.sessions.get(sessionId);
      if (!sessionData || !sessionData.sock) {
        throw new Error('Sessão não encontrada ou não conectada');
      }

      const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;

      // Preparar mídia se necessário
      if (message.image) {
        message.image = await this.prepareMedia(sessionId, message.image);
      }
      if (message.video) {
        message.video = await this.prepareMedia(sessionId, message.video);
      }
      if (message.audio) {
        message.audio = await this.prepareMedia(sessionId, message.audio);
      }
      if (message.document) {
        message.document = await this.prepareMedia(sessionId, message.document);
      }
      if (message.sticker) {
        message.sticker = await this.prepareMedia(sessionId, message.sticker);
      }

      const result = await sessionData.sock.sendMessage(jid, message);
      await sessionData.sock.sendPresenceUpdate('paused', jid);
      logger.info(`📤 Mensagem enviada: ${sessionId} -> ${jid}`);
      return result;
    } catch (error) {
      console.log(error)
      logger.error(`Erro ao enviar mensagem:`, error);
      throw error;
    }
  }

  // Message sending methods
  async deleteMessage(sessionId, to, message) {
    try {
      const sessionData = this.sessions.get(sessionId);
      if (!sessionData || !sessionData.sock) {
        throw new Error('Sessão não encontrada ou não conectada');
      }

      const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;

      const result = await sessionData.sock.sendMessage(jid, { delete: message });

      logger.info(`📤 Mensagem Deletada: ${sessionId} -> ${jid}`);
      return result;
    } catch (error) {
      logger.error(`Erro ao Deletar mensagem:`, error);
      throw error;
    }
  }

  async sendReaction(sessionId, to, messageId, emoji) {
    try {
      const sessionData = this.sessions.get(sessionId);
      if (!sessionData || !sessionData.sock) {
        throw new Error('Sessão não encontrada ou não conectada');
      }

      const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;

      const reactionMessage = {
        react: {
          text: emoji,
          key: { remoteJid: jid, id: messageId }
        }
      };

      const result = await sessionData.sock.sendMessage(jid, reactionMessage);
      return result;
    } catch (error) {
      logger.error(`Erro ao enviar reação:`, error);
      throw error;
    }
  }

  async sendList(sessionId, to, listData) {
    try {
      const sessionData = this.sessions.get(sessionId);
      if (!sessionData || !sessionData.sock) {
        throw new Error('Sessão não encontrada ou não conectada');
      }

      const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
      let result
      // const listMessage = {
      //   text: listData.text,
      //   footer: listData.footer,
      //   title: listData.title,
      //   buttonText: listData.buttonText,
      //   sections: listData.sections,
      // };

      const listMessage = {
        text: 'Escolha uma opção do menu:', // Texto principal
        title: 'Menu de Opções', // Título da lista
        buttonText: 'Abrir Menu', // Texto do botão que abre a lista
        sections: [
          {
            title: 'Seção 1',
            rows: [
              { title: 'Opção 1', rowId: 'opt1', description: 'Descrição da Opção 1' },
              { title: 'Opção 2', rowId: 'opt2', description: 'Descrição da Opção 2' }
            ]
          },
          {
            title: 'Seção 2',
            rows: [
              { title: 'Opção 3', rowId: 'opt3', description: 'Descrição da Opção 3' }
            ]
          }
        ],
        footer: 'Selecione uma opção para continuar.' // Rodapé opcional
      };

      // Enviar a mensagem
      await sessionData.sock.sendMessage('5521974963583@s.whatsapp.net', listMessage);

      // try {
      //   result = await sessionData.sock.sendMessage(jid, listMessage);
      // } catch (error) {
      //   console.log(error)
      //   console.error('Erro ao enviar a lista:', error);
      // }
      // return result;
    } catch (error) {
      logger.error(`Erro ao enviar lista:`, error);
      throw error;
    }
  }

  async sendButtons(sessionId, to, buttonData) {
    try {
      const sessionData = this.sessions.get(sessionId);
      if (!sessionData || !sessionData.sock) {
        throw new Error('Sessão não encontrada ou não conectada');
      }

      const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;

      const buttonMessage = {
        text: buttonData.text,
        footer: buttonData.footer,
        buttons: buttonData.buttons.map((btn, index) => ({
          buttonId: `btn_${index}`,
          buttonText: { displayText: btn.displayText },
          type: 1
        })),
        headerType: 1
      };

      const result = await sessionData.sock.sendMessage(jid, buttonMessage);
      return result;
    } catch (error) {
      logger.error(`Erro ao enviar botões:`, error);
      throw error;
    }
  }

  async sendTyping(sessionId, to, typing, audio = false) {
    try {
      const sessionData = this.sessions.get(sessionId);
      if (!sessionData || !sessionData.sock) {
        throw new Error('Sessão não encontrada ou não conectada');
      }

      const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
      if (audio) {
        await sessionData.sock.sendPresenceUpdate(typing ? 'recording' : 'paused', jid);
      } else {
        await sessionData.sock.sendPresenceUpdate(typing ? 'composing' : 'paused', jid);
      }


      return { success: true };
    } catch (error) {
      logger.error(`Erro ao enviar status de digitação:`, error);
      throw error;
    }
  }

  async markAsRead(sessionId, jid, messageId = null) {
    try {
      const sessionData = this.sessions.get(sessionId);
      if (!sessionData || !sessionData.sock) {
        throw new Error('Sessão não encontrada ou não conectada');
      }

      if (messageId) {
        await sessionData.sock.readMessages([{ remoteJid: jid, id: messageId }]);
      } else {
        await sessionData.sock.chatModify({ markRead: true }, jid);
      }

      return { success: true };
    } catch (error) {
      logger.error(`Erro ao marcar como lida:`, error);
      throw error;
    }
  }

  // Contact methods
  async getContactProfile(sessionId, jid) {
    try {
      const sessionData = this.sessions.get(sessionId);
      if (!sessionData || !sessionData.sock) {
        throw new Error('Sessão não encontrada ou não conectada');
      }

      const profile = await sessionData.sock.getBusinessProfile(jid);
      return profile;
    } catch (error) {
      // Try regular profile if business profile fails
      try {
        const sessionData = this.sessions.get(sessionId);
        const status = await sessionData.sock.fetchStatus(jid);
        return { status: status?.status };
      } catch (err) {
        logger.error(`Erro ao obter perfil do contato:`, error);
        throw error;
      }
    }
  }

  async checkNumbers(sessionId, numbers) {
    try {
      const sessionData = this.sessions.get(sessionId);
      if (!sessionData || !sessionData.sock) {
        throw new Error('Sessão não encontrada ou não conectada');
      }

      const results = [];
      for (const number of numbers) {
        try {
          const jid = number.includes('@') ? number : `${number}@s.whatsapp.net`;
          const [result] = await sessionData.sock.onWhatsApp(jid);
          results.push({
            number,
            exists: !!result?.exists,
            jid: result?.jid || null
          });
        } catch (error) {
          results.push({
            number,
            exists: false,
            error: error.message
          });
        }
      }

      return results;
    } catch (error) {
      logger.error(`Erro ao verificar números:`, error);
      throw error;
    }
  }

  async blockContact(sessionId, jid) {
    try {
      const sessionData = this.sessions.get(sessionId);
      if (!sessionData || !sessionData.sock) {
        throw new Error('Sessão não encontrada ou não conectada');
      }

      await sessionData.sock.updateBlockStatus(jid, 'block');
      return { success: true };
    } catch (error) {
      logger.error(`Erro ao bloquear contato:`, error);
      throw error;
    }
  }

  async unblockContact(sessionId, jid) {
    try {
      const sessionData = this.sessions.get(sessionId);
      if (!sessionData || !sessionData.sock) {
        throw new Error('Sessão não encontrada ou não conectada');
      }

      await sessionData.sock.updateBlockStatus(jid, 'unblock');
      return { success: true };
    } catch (error) {
      logger.error(`Erro ao desbloquear contato:`, error);
      throw error;
    }
  }

  // Group methods
  async getGroupInfo(sessionId, groupJid) {
    try {
      const sessionData = this.sessions.get(sessionId);
      if (!sessionData || !sessionData.sock) {
        throw new Error('Sessão não encontrada ou não conectada');
      }

      const groupInfo = await sessionData.sock.groupMetadata(groupJid);
      return groupInfo;
    } catch (error) {
      logger.error(`Erro ao obter informações do grupo:`, error);
      throw error;
    }
  }

  async createGroup(sessionId, subject, participants) {
    try {
      const sessionData = this.sessions.get(sessionId);
      if (!sessionData || !sessionData.sock) {
        throw new Error('Sessão não encontrada ou não conectada');
      }

      const group = await sessionData.sock.groupCreate(subject, participants);
      return group;
    } catch (error) {
      logger.error(`Erro ao criar grupo:`, error);
      throw error;
    }
  }

  async addParticipants(sessionId, groupJid, participants) {
    try {
      const sessionData = this.sessions.get(sessionId);
      if (!sessionData || !sessionData.sock) {
        throw new Error('Sessão não encontrada ou não conectada');
      }

      const result = await sessionData.sock.groupParticipantsUpdate(groupJid, participants, 'add');
      return result;
    } catch (error) {
      logger.error(`Erro ao adicionar participantes:`, error);
      throw error;
    }
  }

  async removeParticipants(sessionId, groupJid, participants) {
    try {
      const sessionData = this.sessions.get(sessionId);
      if (!sessionData || !sessionData.sock) {
        throw new Error('Sessão não encontrada ou não conectada');
      }

      const result = await sessionData.sock.groupParticipantsUpdate(groupJid, participants, 'remove');
      return result;
    } catch (error) {
      logger.error(`Erro ao remover participantes:`, error);
      throw error;
    }
  }

  async promoteParticipants(sessionId, groupJid, participants) {
    try {
      const sessionData = this.sessions.get(sessionId);
      if (!sessionData || !sessionData.sock) {
        throw new Error('Sessão não encontrada ou não conectada');
      }

      const result = await sessionData.sock.groupParticipantsUpdate(groupJid, participants, 'promote');
      return result;
    } catch (error) {
      logger.error(`Erro ao promover participantes:`, error);
      throw error;
    }
  }

  async demoteParticipants(sessionId, groupJid, participants) {
    try {
      const sessionData = this.sessions.get(sessionId);
      if (!sessionData || !sessionData.sock) {
        throw new Error('Sessão não encontrada ou não conectada');
      }

      const result = await sessionData.sock.groupParticipantsUpdate(groupJid, participants, 'demote');
      return result;
    } catch (error) {
      logger.error(`Erro ao rebaixar participantes:`, error);
      throw error;
    }
  }

  async leaveGroup(sessionId, groupJid) {
    try {
      const sessionData = this.sessions.get(sessionId);
      if (!sessionData || !sessionData.sock) {
        throw new Error('Sessão não encontrada ou não conectada');
      }

      await sessionData.sock.groupLeave(groupJid);
      return { success: true };
    } catch (error) {
      logger.error(`Erro ao sair do grupo:`, error);
      throw error;
    }
  }

  async updateGroupSubject(sessionId, groupJid, subject) {
    try {
      const sessionData = this.sessions.get(sessionId);
      if (!sessionData || !sessionData.sock) {
        throw new Error('Sessão não encontrada ou não conectada');
      }

      await sessionData.sock.groupUpdateSubject(groupJid, subject);
      return { success: true };
    } catch (error) {
      logger.error(`Erro ao atualizar nome do grupo:`, error);
      throw error;
    }
  }

  async updateGroupDescription(sessionId, groupJid, description) {
    try {
      const sessionData = this.sessions.get(sessionId);
      if (!sessionData || !sessionData.sock) {
        throw new Error('Sessão não encontrada ou não conectada');
      }

      await sessionData.sock.groupUpdateDescription(groupJid, description);
      return { success: true };
    } catch (error) {
      logger.error(`Erro ao atualizar descrição do grupo:`, error);
      throw error;
    }
  }

  // Session management
  async reconnectSession(sessionId) {
    try {
      // Remover sessão atual
      await this.removeSession(sessionId);

      // Buscar dados da sessão no banco
      const session = await Session.findById(sessionId);
      if (session) {
        // Recriar sessão
        await this.createSession(sessionId, session.numero);
        logger.info(`🔄 Sessão ${sessionId} reconectada manualmente`);
      }
    } catch (error) {
      logger.error(`Erro ao reconectar sessão ${sessionId}:`, error);
      throw error;
    }
  }

  async deleteSession(sessionId) {
    try {
      // Remover da memória
      await this.removeSession(sessionId);

      // Remove session directory
      const sessionDir = path.join(process.cwd(), 'sessions', sessionId);
      if (fs.existsSync(sessionDir)) {
        fs.rmSync(sessionDir, { recursive: true, force: true });
      }

      logger.info(`🗑️ Sessão ${sessionId} deletada completamente`);
    } catch (error) {
      logger.error(`Erro ao deletar sessão ${sessionId}:`, error);
      throw error;
    }
  }

  static delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Utility methods
  async isSessionConnected(sessionId) {
    const sessionData = await Session.findById(sessionId);
    return sessionData?.status === 'connected' && sessionData?.sock?.ws?.readyState === 1;
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }

  getActiveSessions() {
    return Array.from(this.sessions.keys());
  }

  getSessionsStats() {
    const sessions = Array.from(this.sessions.values());
    return {
      total: sessions.length,
      connected: sessions.filter(s => s.status === 'connected').length,
      connecting: sessions.filter(s => s.status === 'connecting').length,
      disconnected: sessions.filter(s => s.status === 'disconnected').length
    };
  }

  async healthCheck() {
    const stats = this.getSessionsStats();
    const activeSessions = this.getActiveSessions();

    return {
      status: 'healthy',
      timestamp: moment().tz(configenv.timeZone).toISOString(),
      sessions: stats,
      activeSessions,
      memory: process.memoryUsage(),
      uptime: process.uptime()
    };
  }

  startHealthCheck() {
    this.healthCheckInterval = setInterval(async () => {
      try {
        await this.cleanupSessions();
      } catch (error) {
        logger.error('Erro no health check:', error);
      }
    }, 5 * 60 * 1000); // Every 5 minutes
  }

  stopHealthCheck() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  async cleanupSessions() {
    const sessionsToCleanup = [];

    for (const [sessionId, session] of this.sessions.entries()) {

      if (configenv.delete_sessao && configenv.status === 'disconnected') {

        const pastTime = moment.tz(session.lastConnected, 'America/Sao_Paulo');
        const currentTime = moment.tz('America/Sao_Paulo');

        const diffInHours = currentTime.diff(pastTime, 'hours', true);
        const hasPassedFiveHours = diffInHours >= parseInt(configenv.temp_delete_sessao);

        if (hasPassedFiveHours) {
          sessionsToCleanup.push(sessionId);
        }
      }

    }

    for (const sessionId of sessionsToCleanup) {
      logger.info(`🧹 Limpando sessão inativa: ${sessionId}`);
      await this.removeSession(sessionId);
    }

    if (sessionsToCleanup.length > 0) {
      logger.info(`🧹 ${sessionsToCleanup.length} sessões inativas removidas`);
    }
  }
}

module.exports = new BaileysService();