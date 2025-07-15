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
  decryptPollVote,
  WABrowserDescription,
  downloadMediaMessage

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
const { release } = require('os');
const qrTerminal = require('qrcode-terminal');
const NodeCache = require('node-cache');

class BaileysService {
  constructor() {
    this.globalWebSocketService = null;
    this.healthCheckInterval = null;
    this.groupCache = new NodeCache({ stdTTL: 5 * 60, useClones: false }); //Cache de grupos
    this.sessions = new Map(); //cache de sessão
    this.messagesCache = new NodeCache({ stdTTL: 5 * 60, useClones: false }); //Cache de mensagem
    this.contactsCache = new NodeCache({ stdTTL: 5 * 60, useClones: false }); //Cache de contatos
    this.chatsCache = new NodeCache({ stdTTL: 5 * 60, useClones: false }); //Cache de Chats
    this.tentativas = new Map();
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

          // Sincronizar credenciais antes de criar a sessão
          await this.syncCreds(session.apikey);
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

      // Tentar sincronizar credenciais antes de criar a sessão
      await this.syncCreds(sessionId);

      const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
      const { version, isLatest } = await fetchLatestBaileysVersion();

      logger.info(`📱 Usando Baileys v${version.join('.')}, isLatest: ${isLatest}`);

      let browserOptions = {}
      let number = false
      if (phoneNumber && phoneNumber !== '') {
        number = phoneNumber;

        logger.info(`Phone number: ${number}`);
      } else {
        const browser = [configenv.sessao_phone, configenv.sessao_phone_name, release()];
        browserOptions = { browser };
      }


      const sock = makeWASocket({
        version,
        logger: pino({ level: 'error' }),
        printQRInTerminal: false,
        ...browserOptions,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'error' }))
        },
        generateHighQualityLinkPreview: true,
        syncFullHistory: true,
        markOnlineOnConnect: false,
        fireInitQueries: true,
        emitOwnEvents: true,
        cachedGroupMetadata: async (jid) => groupCache.get(`${sessionId}_${jid}`),
        getMessage: async (key) => {
          const msg = await this.getMessage(key);
          return msg || undefined
        }
      });

      const sessionData = {
        sock,
        status: 'connecting',
        phoneNumber: number,
        lastConnected: null,
        connectionAttempts: 0,
        qrRetries: 0,
        maxQrRetries: 5,
        ignorar_grupos: null,
        msg_rejectCalls: null,
        autoRead: null,
        rejeitar_ligacoes: null,
        webhook_status: null,
        webhook_url: null,
        events: []
      };
      this.sessions.set(sessionId, sessionData);

      if(!this.tentativas.get(sessionId))this.tentativas.set(sessionId, {tentativas: 0})



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
  async removeSession(sessionId, delarquivos = false) {
    try {
      const sessionData = this.sessions.get(sessionId);
      if (sessionData) {
        // Fechar WebSocket se existir
        if (sessionData.sock?.ws) {
          sessionData.sock.ws.close();
        }

        // Remover do Map
        this.sessions.delete(sessionId);

        if (delarquivos) {
          await this.deleteSession(sessionId)
          await Session.saveCreds(sessionId, null)
          await sessionData?.sock?.logout();
          await sessionData?.sock?.end();
        }

        await Session.update(sessionId, {
          qr_code: 'null',
          code: 'null',
          status: 'disconnected'
        })


        logger.info(`🗑️ Sessão ${sessionId} removida da memória`);
      }
    } catch (error) {
      console.log(error)
      logger.error(`Erro ao remover sessão ${sessionId}:`, error);
    }
  }

  async getMessage(key, full = false) {
    try {

    } catch (error) { }
  }

  //Eventos
  EventsGet(sock, sessionId, saveCreds, updateStatus) {

    // Connection updates
    sock.ev.on('connection.update', async (update) => {
      await this.update_conexao(sessionId, update, updateStatus);
    });

    // Credentials update
    sock.ev.on('creds.update', async (creds) => {
      try {
        // Salvar no arquivo (padrão Baileys)
        await saveCreds(creds);

        // Salvar no banco como backup
        await this.saveCredsToDatabase(sessionId);

        logger.debug(`💾 Credenciais atualizadas para sessão: ${sessionId}`);
      } catch (error) {
        logger.error(`❌ Erro ao salvar credenciais para ${sessionId}:`, error);
      }
    });


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
      await this.emitEvent(sessionId, 'chats_set', chats);
      await this.chats_set(async () => {
        try {
          logger.info(`📂 Evento chats.set: ${chats.length} chats recebidos para sessão ${sessionId}`);

          // Processar em lotes para evitar sobrecarga
          const batchSize = 50;
          for (let i = 0; i < chats.length; i += batchSize) {
            const batch = chats.slice(i, i + batchSize);
            for (const chat of batch) {
              if (!chat.id) continue;
              const key = `${sessionId}_${chat.id}`
              if (!this.chatsCache.has(key)) {
                this.chatsCache.set(key, chat)
                await Store.saveChat(sessionId, chat);
              }

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
      await this.emitEvent(sessionId, 'chats_update', updates);
      await this.chats_set(async () => {
        try {
          for (const update of updates) {
            if (!update.id) continue;
            const key = `${sessionId}_${update.id}`
            if (!this.chatsCache.has(key)) {
              logger.info(`📂 Atualizando ${updates.length} chats para sessão ${sessionId}`);
              this.chatsCache.set(key, update)
              await Store.saveChat(sessionId, update);
            }

          }
        } catch (error) {
          logger.error(`Erro ao atualizar chats:`, error);
        }
      });
    });

    // Contacts - com throttling
    sock.ev.on('contacts.set', async ({ contacts }) => {
      await this.emitEvent(sessionId, 'contacts_set', contacts);
      await this.chats_set(async () => {
        try {
          logger.info(`👥 Evento contacts.set: ${contacts.length} contatos recebidos para sessão ${sessionId}`);

          // Processar em lotes
          const batchSize = 100;
          for (let i = 0; i < contacts.length; i += batchSize) {
            const batch = contacts.slice(i, i + batchSize);
            for (const contact of batch) {
              if (!contact.id) continue;
              const key = `${sessionId}_${contact.id}`
              if (!this.contactsCache.has(key)) {
                this.contactsCache.set(key, contact)
                await Store.saveContact(sessionId, contact);
              }

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
      await this.emitEvent(sessionId, 'contacts_update', updates);
      await this.chats_set(async () => {
        try {
          for (const update of updates) {
            if (!update.id) continue;
            const key = `${sessionId}_${update.id}`
            if (!this.contactsCache.has(key)) {
              logger.info(`👥 Atualizando ${updates.length} contatos para sessão ${sessionId}`);
              this.contactsCache.set(key, update)
              await Store.saveContact(sessionId, update);
            }
          }
        } catch (error) {
          logger.error(`Erro ao atualizar contatos:`, error);
        }
      });
    });

    // Eventos de grupo update
    sock.ev.on('groups.update', async (updates) => {
      await this.emitEvent(sessionId, 'groups_update', updates);
      //Função para salvar grupos no banco de dados
      const salvegrups = async () => {
        try {
          for (const update of updates) {
            if (!update.id) continue;
            const metadata = await sock.groupMetadata(update.id)
            const key = `${sessionId}_${update.id}`
            if (!this.groupCache.has(key)) {
              logger.info(`👥 Atualizando ${updates.length} grupos para sessão ${sessionId}`);
              this.groupCache.set(key, metadata);
              await Store.saveGroup(sessionId, update);
            }
          }
        } catch (error) {
          logger.error(`Erro ao atualizar grupos:`, error);
        }
      }
      await this.chats_set(salvegrups);
    });

    const originalEmit = sock.ev.emit;
    // sock.ev.emit = function (event, ...args) {
    //     console.log(`📡 Evento recebido: ${event}`);
    //     console.dir(args, { depth: null });
    //     return originalEmit.call(this, event, ...args);
    // };

    sock.ev.on('group-participants.update', async (event) => {
      await this.emitEvent(sessionId, 'group_participants_update', event);
      const metadata = await sock.groupMetadata(event.id)
      const key = `${sessionId}_${event.id}`
      if (!this.groupCache.has(key)) {
        this.groupCache.set(key, metadata)
      }

    })

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

      await this.emitEvent(sessionId, 'messaging_history_set', { chats, contacts, messages });
      await this.chats_set(async () => {
        try {
          logger.info(`📚 Histórico carregado para sessão ${sessionId}: ${chats.length} chats, ${contacts.length} contatos, ${messages.length} mensagens`);

          // Processar em lotes pequenos
          const batchSize = 25;

          // Salvar chats
          for (let i = 0; i < chats.length; i += batchSize) {
            const batch = chats.slice(i, i + batchSize);
            for (const chat of batch) {
              try {
                if (!chat.id) continue;
                const key = `${sessionId}_${chat.id}`
                if (!this.chatsCache.has(key)) {
                  this.chatsCache.set(key)
                  await Store.saveChat(sessionId, chat);
                }

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
                if (!contact.id) continue;
                const key = `${sessionId}_${contact.id}`
                if (!this.contactsCache.has(key)) {
                  this.contactsCache.set(key, contact)
                  await Store.saveContact(sessionId, contact);
                }

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
              if (!message?.key?.id) continue;
              const key = `${sessionId}_${message.key.id}`
              if (!this.messagesCache.has(key)) {
                this.messagesCache.set(key, message)
                await Store.saveMessage(sessionId, message);
              }
            }
            await this.delay(100);
          }

          logger.info(`💾 Histórico salvo no MySQL para sessão ${sessionId}`);
        } catch (error) {
          logger.error(`Erro ao salvar histórico:`, error);
        }
      });
    });
  }

  // Função para restaurar credenciais do banco para arquivos
  async restoreCredsFromDB(sessionId) {
    try {
      logger.info(`🔄 Restaurando credenciais do banco para sessão: ${sessionId}`);

      const session = await Session.findById(sessionId);
      if (!session || !session.creds) {
        logger.warn(`❌ Nenhuma credencial encontrada no banco para sessão: ${sessionId}`);
        return false;
      }

      const sessionDir = path.join(process.cwd(), 'sessions', sessionId);
      if (!fs.existsSync(sessionDir)) {
        fs.mkdirSync(sessionDir, { recursive: true });
      }
      // Parsear credenciais do banco
      const creds = session.creds;

      // Salvar cada arquivo de credencial
      for (const [fileName, content] of Object.entries(creds)) {
        const filePath = path.join(sessionDir, fileName);
        fs.writeFileSync(filePath, JSON.stringify(content, null, 2));
      }

      logger.info(`✅ Credenciais restauradas do banco para arquivos: ${sessionId}`);
      return true;
    } catch (error) {

      logger.error(`❌ Erro ao restaurar credenciais do banco para ${sessionId}:`, error);
      return false;
    }
  }

  // Função para sincronizar credenciais entre arquivo e banco
  async syncCreds(sessionId) {
    try {
      logger.info(`🔄 Sincronizando credenciais para sessão: ${sessionId}`);

      const sessionDir = path.join(process.cwd(), 'sessions', sessionId);

      // Verificar se diretório de sessão existe
      if (!fs.existsSync(sessionDir)) {
        logger.info(`📁 Diretório não existe, tentando restaurar do banco: ${sessionId}`);
        return await this.restoreCredsFromDB(sessionId);
      }

      // Ler credenciais dos arquivos
      const credsFiles = {};
      const files = fs.readdirSync(sessionDir);

      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(sessionDir, file);
          try {
            const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            credsFiles[file] = content;
          } catch (error) {
            logger.warn(`⚠️ Erro ao ler arquivo ${file}:`, error.message);
          }
        }
      }

      // Se temos credenciais nos arquivos, salvar no banco
      if (Object.keys(credsFiles).length > 0) {
        await Session.saveCreds(sessionId, credsFiles);
        logger.info(`💾 Credenciais sincronizadas do arquivo para banco: ${sessionId}`);
        return true;
      } else {
        // Se não temos arquivos, tentar restaurar do banco
        logger.info(`📥 Nenhum arquivo encontrado, restaurando do banco: ${sessionId}`);
        return await this.restoreCredsFromDB(sessionId);
      }
    } catch (error) {
      logger.error(`❌ Erro ao sincronizar credenciais para ${sessionId}:`, error);
      return false;
    }
  }

  // Função para salvar credenciais dos arquivos para o banco
  async saveCredsToDatabase(sessionId) {
    try {
      const sessionDir = path.join(process.cwd(), 'sessions', sessionId);

      if (!fs.existsSync(sessionDir)) {
        logger.warn(`⚠️ Diretório de sessão não existe: ${sessionId}`);
        return false;
      }

      const credsFiles = {};
      const files = fs.readdirSync(sessionDir);

      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = path.join(sessionDir, file);
          try {
            const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            credsFiles[file] = content;
          } catch (error) {
            logger.warn(`⚠️ Erro ao ler arquivo de credencial ${file}:`, error.message);
          }
        }
      }

      if (Object.keys(credsFiles).length > 0) {
        await Session.saveCreds(sessionId, credsFiles);
        logger.debug(`💾 Credenciais salvas no banco para sessão: ${sessionId}`);
        return true;
      }

      return false;
    } catch (error) {
      logger.error(`❌ Erro ao salvar credenciais no banco para ${sessionId}:`, error);
      return false;
    }
  }

  // Função para throttling de sincronização
  async chats_set(syncFunction) {

    try {
      await syncFunction();
    } finally {

    }
  }

  async update_conexao(sessionId, update, updateStatus = true) {
    const { connection, lastDisconnect, qr } = update;
    const sessionData = this.sessions.get(sessionId);
     const tentativas = this.tentativas.get(sessionId);
    if (!sessionData) return;
    logger.info(`🔄 Conexão ${sessionId}: ${connection || 'indefinido'}`);

    await this.emitEvent(sessionId, 'connection_update', update);

    if (qr) {
      try {

        qrTerminal.generate(qr, { small: true }, (qrcode) => {
          console.log(`QR Code Sessão ${sessionId}:\n`, qrcode);
        });
        let code = null
        if (sessionData.phoneNumber && sessionData.phoneNumber !== '') {
          try {
            await this.delay(1000);
            code = await sessionData.sock.requestPairingCode(sessionData.phoneNumber);
            logger.info(`Codigo de pareamento: ${code}`)
          } catch (error) {
            logger.error('erro ao gerar codigo de conexão')
          }
        }

        const qrCodeDataURL = await QRCode.toDataURL(qr);
        sessionData.qrCode = qrCodeDataURL;

        if (updateStatus) {
          await Session.update(sessionId, {
            status: 'qr_ready',
            qr_code: qrCodeDataURL,
            code
          });
        }

        // Emit QR code event
        await this.emitEvent(sessionId, 'qr_updated', { qr: qrCodeDataURL, code });

        logger.info(`📱 QR Code gerado para sessão ${sessionId}`);
      } catch (error) {
        logger.error(`Erro ao gerar QR Code para ${sessionId}:`, error);
      }
    }

    if (connection === 'close') {
      try {
        const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;

        if (shouldReconnect) {
          tentativas.tentativas++;
          logger.info(`🔄 Tentativa de reconexão ${tentativas.tentativas} para ${sessionId}`);

          if (tentativas.tentativas <= 5) {

            // Remover sessão atual antes de tentar reconectar
            await this.removeSession(sessionId);

            setTimeout(async () => {
              try {
                await this.createSession(sessionId, sessionData.phoneNumber, updateStatus);
              } catch (error) {
                logger.error(`Erro na reconexão automática ${sessionId}:`, error);
              }
            }, 5000 * tentativas.tentativas);
          } else {
            logger.error(`❌ Máximo de tentativas de reconexão atingido para ${sessionId}`);
            await this.removeSession(sessionId, true);
          }
        } else {
          logger.info(`🚪 Sessão ${sessionId} foi desconectada (logout)`);
          await this.removeSession(sessionId, true);
        }

        if (updateStatus) {
          await Session.update(sessionId, { status: 'disconnected' });
        }

        await this.emitEvent(sessionId, 'session_disconnected', { reason: lastDisconnect?.error?.message });
      } catch (error) {
        console.error(`Erro na conexão ${sessionId}: `, error)
      }


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
      tentativas.tentativas = 0;
      sessionData.connectionAttempts = 0;
      const phoneNumber = sessionData.sock?.user?.id?.split(':')[0];
      const sessaoDB = await Session.findById(sessionId)
      sessionData.ignorar_grupos = sessaoDB.ignorar_grupos
      sessionData.rejeitar_ligacoes = sessaoDB.rejeitar_ligacoes
      sessionData.msg_rejectCalls = sessaoDB.msg_rejectCalls
      sessionData.webhook_status = sessaoDB.webhook_status
      sessionData.webhook_url = sessaoDB.webhook_url
      sessionData.events = sessaoDB.events

      if (updateStatus) {
        await Session.update(sessionId, {
          status: 'connected',
          phone_number: phoneNumber
        });
      }

      logger.info(`✅ Sessão ${sessionId} conectada com sucesso! Telefone: ${phoneNumber}`);

      // // Sincronização mais conservadora após conexão
      // setTimeout(async () => {
      //   await this.forceSyncContacts(sessionId);
      // }, 15000); // Aguardar 15 segundos
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

      let selectedOptions = null;
      const pollUpdate = message.message?.pollUpdateMessage;
      if (pollUpdate) {
        try {
          const pollMsgId = pollUpdate.pollCreationMessageKey?.id;
          const [msg] = await Store.getMessages(sessionId, message.key.remoteJid, pollMsgId)

          const voterJid = msg.remoteJid;
          const getnumber = this.sessions.get(sessionId)
          if (getnumber?.sock?.user?.id?.split(':')[0]) {
            const decrypted = await decryptPollVote(pollUpdate.vote, {
              pollCreatorJid: getnumber.sock.user.id.split(':')[0] + '@s.whatsapp.net',
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
                  selectedOptions = option.optionName;
                  break;
                }
              }
            }
          }

        } catch (error) {
          console.error(`Erro ao processar atualização de enquete (sessionId: ${sessionId}):`, error);
        }
      }


      try {
        // Salvar mensagem no store
        if (!message?.key?.id) continue;
        const key = `${sessionId}_${message.key.id}`
        if (!this.messagesCache.has(key)) {
          this.messagesCache.set(key, message)
          await Store.saveMessage(sessionId, message);
        }

        // Verificar configurações da sessão
        const config = this.sessions.get(sessionId);

        // Auto-read
        if (config?.autoRead && !message.key.fromMe) {
          await this.markAsRead(sessionId, message.key.remoteJid, message.key.id);
        }

        if (selectedOptions) {
          message.PollVote = selectedOptions;
        }

        let mensagemSend = message
        const decryptMidia = await this.baixarMediaComoBase64(message, config.sock)
        if (decryptMidia) {
          mensagemSend = decryptMidia
        }

        // Emit message event
        await this.emitEvent(sessionId, 'message_received', {
          message: mensagemSend,

        });

      } catch (error) {
        console.log(error)
        logger.error(`Erro ao processar mensagem:`, error);
      }
    }
  }

  async baixarMediaComoBase64(message, sock) {
    try {
      if (!message?.message) return null;

      // Detectar tipo principal
      let tipoOriginal = Object.keys(message.message)[0];
      let midiaOriginal = message.message[tipoOriginal];

      // Tratar mensagens encapsuladas (ex: documentWithCaptionMessage)
      if (tipoOriginal.endsWith('WithCaptionMessage') && midiaOriginal?.message) {
        const tipoInterno = Object.keys(midiaOriginal.message)[0];
        const midiaInterna = midiaOriginal.message[tipoInterno];
        tipoOriginal = tipoInterno;
        midiaOriginal = midiaInterna;
      }

      // Verifica se é mídia suportada
      const tiposSuportados = [
        'imageMessage',
        'videoMessage',
        'audioMessage',
        'documentMessage',
        'stickerMessage',
        'messageContextInfo'
      ];

      if (!tiposSuportados.includes(tipoOriginal)) {
        console.warn(`⚠️ Tipo de mídia não tratado: ${tipoOriginal}`);
        return null;
      }

      // Baixar mídia
      const buffer = await downloadMediaMessage(message, 'buffer', {}, {
        logger: console,
        reuploadRequest: sock.updateMediaMessage,
      });

      const base64 = buffer.toString('base64');
      const mimetype = midiaOriginal.mimetype || 'application/octet-stream';
      const dataUrl = `data:${mimetype};base64,${base64}`;

      // Clonar e modificar a mensagem
      const novaMensagem = JSON.parse(JSON.stringify(message)); // clone profundo

      novaMensagem.message[tipoOriginal] = {
        ...midiaOriginal,
        base64,
        dataUrl,
      };

      return novaMensagem;

    } catch (err) {
      console.error('❌ Erro ao baixar mídia:', err);
      return null;
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
      await this.emitEvent(sessionId, 'call', calls);
      const sessiondata = this.sessions.get(sessionId);
      if (!sessiondata) return

      for (const call of calls) {
        if (sessiondata?.rejectCalls && call.status === 'offer') {
          const sessionData = this.sessions.get(sessionId);
          if (sessionData?.sock) {
            await sessionData.sock.rejectCall(call.id, call.from);
            if (sessiondata?.msg_rejectCalls && sessiondata?.msg_rejectCalls !== '') {
              const message = {
                text: sessiondata.msg_rejectCalls,
              };
              await this.sendMessage(sessionId, call.from, message)
            }
            logger.info(`📞 Chamada rejeitada automaticamente de ${call.from}`);
          }
        }
      }
    } catch (error) {
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
      const config = await this.sessions.get(sessionId);

      if (config?.webhook_status && config.webhook_status == '1' && config?.events && Array.isArray(config.events)) {
        const Isevent = config.events.find(e => e == event)
        if (Isevent) {
          const webhookService = new WebhookService();
          await webhookService.sendWebhook(config.webhook_url, {
            event,
            sessionId,
            data,
            timestamp: moment().tz(configenv.timeZone).toISOString()
          });
        }
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
          // Sincronizar credenciais antes de limpar
          await this.syncCreds(sessionId);
          sessionsToCleanup.push(sessionId);
        }
      }

    }

    for (const sessionId of sessionsToCleanup) {
      logger.info(`🧹 Limpando sessão inativa: ${sessionId}`);
      await this.removeSession(sessionId, true);
    }

    if (sessionsToCleanup.length > 0) {
      logger.info(`🧹 ${sessionsToCleanup.length} sessões inativas removidas`);
    }
  }
}

module.exports = new BaileysService();