import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  proto,
  decryptPollVote,
  downloadMediaMessage,
  initAuthCreds,
  BufferJSON,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";

import fs from "fs";
import path from "path";
import QRCode from "qrcode";
import pino from "pino";
import Session from "../models/Session.js";
import Store from "../models/Store.js";
import GlobalWebhookService from "./GlobalWebhookService.js";
import WebhookService from "./WebhookService.js";
import logger from "../utils/logger.js";
import configenv from "../config/env.js";
import digestSync from "crypto-digest-sync";
import moment from "moment-timezone";
import { release } from "os";
import qrTerminal from "qrcode-terminal";
import NodeCache from "node-cache";
import { ProxyAgent } from "undici";
import redis from "./redis.js";
import { fileURLToPath } from "url";
import { clearAuth } from "./redisSessao.js";
import { makeDbAuthState, clearDbAuth } from "./dbAuthState.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import Redis from "ioredis";

class BaileysService {
  constructor() {
    this.globalWebSocketService = null;
    this.healthCheckInterval = null;
    this.keepAliveInterval = null;
    this.sessionMonitors = new Map();
  }

  static redis = redis;
  static sockets = new Map();
  static msgRetryCounterCache = new NodeCache({
    stdTTL: 5 * 60,
    useClones: false,
  });
  static keepAliveIntervals = new Map();
  static sessionHeartbeats = new Map();
  static reconnectAttempts = new Map();
  static qrcodelimites = new Map();

  static setGlobalWebSocketService(service) {
    this.globalWebSocketService = service;
  }

  static async initialize() {
    logger.info("🔄 Inicializando BaileysService...");

    // Restaurar sessões ativas do banco
    await this.restoreActiveSessions();

    // Iniciar health check
    this.startHealthCheck();
    await Session.limparBinlogs();

    logger.info("✅ BaileysService inicializado");
  }

  static async restoreActiveSessions() {
    try {
      const sessions = await Session.findByApiKey();
      logger.info(
        `🔄 Restaurando ${sessions.length} sessões do banco de dados...`,
      );

      for (const session of sessions) {
        await Session.update(session.apikey, { status: "disconnected" });
        logger.info(`⌛ Aguardando antes de restaurar ${session.apikey}...`);
        await this.delay(2000);
        logger.info(`🔄 Restaurando sessão: ${session.apikey}`);
        await this.createSession(session.apikey, session.numero, false);
      }
    } catch (error) {
      logger.error("❌ Erro ao restaurar sessões:", error);
    }
  }

  static async createSession(sessionId, phoneNumber = null, type = "qrcode") {
    try {
      const getsessao = await Session.findById(sessionId);
      if (!getsessao)
        return {
          success: false,
          message: "Sessão não encontrada no banco de dados",
        };
      if (getsessao) {
        if (getsessao.status == "connected") {
          logger.warn(
            `⚠️ Sessão ${sessionId} já está conectada. Não criar outra instância.`,
          );
          return { success: false, message: "Sessão já conectada" };
        }
      }

      // Usar armazenamento de auth state no banco de dados (Redis apenas como cache)
      const { state, saveCreds } = await makeDbAuthState(sessionId);
      // const version = await getversion();
      const { version, isLatest } = await fetchLatestBaileysVersion();
      logger.info(`using WA v${version.join(".")}, isLatest: ${isLatest}`);

      let browserOptions = {};
      let number = false;

      //Verificar se a conexão e via codigo ou qrcode
      if (type == "code") {
        if (!phoneNumber || phoneNumber == "") {
          return {
            success: false,
            message: "Número de telefone é obrigatório para login por código",
          };
        }
        number = phoneNumber;
      } else {
        const browser = [
          configenv.sessao_phone,
          configenv.sessao_phone_name,
          release(),
        ];
        browserOptions = { browser };
      }

      const getMessage = async (key) => {
        const keymsg = `message:${sessionId}_${key.id}`;
        const existingMessage = await this.redis.get(keymsg);
        return existingMessage || undefined;
      };

      const configs = {
        version,
        logger: pino({ level: configenv.baileysLogLevel || "info" }),
        printQRInTerminal: false,
        ...browserOptions,
        auth: state,
        generateHighQualityLinkPreview: false,
        syncFullHistory: configenv.sync_full_history === "true",
        markOnlineOnConnect: true,
        fireInitQueries: true,
        emitOwnEvents: true,
        msgRetryCounterCache: this.msgRetryCounterCache,
        defaultQueryTimeoutMs: 60000,
        retryRequestDelayMs: 500,
        maxMsgRetryCount: 3,
        fireInitQueries: true,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 15000,
        qrTimeout: 45000,
        // cachedGroupMetadata: async (jid) => {
        //   return this.groupCache.get(`${sessionId}_${jid}`)
        // },
        getMessage,
        shouldIgnoreJid: (jid) => {
          if (!jid) return true;
          if (jid.includes("@broadcast") || jid.includes("@newsletter"))
            return true;
          return false;
        },
        patchMessageBeforeSending(message) {
          // Corrige lista de produtos para lista normal (exemplo original)
          if (
            message.deviceSentMessage?.message?.listMessage?.listType ===
            proto.Message.ListMessage.ListType.PRODUCT_LIST
          ) {
            message = JSON.parse(JSON.stringify(message));

            message.deviceSentMessage.message.listMessage.listType =
              proto.Message.ListMessage.ListType.SINGLE_SELECT;
          }

          if (
            message.listMessage?.listType ==
            proto.Message.ListMessage.ListType.PRODUCT_LIST
          ) {
            message = JSON.parse(JSON.stringify(message));

            message.listMessage.listType =
              proto.Message.ListMessage.ListType.SINGLE_SELECT;
          }

          return message;
        },
      };

      if (configenv.proxy_state === "true") {
        const proxyUrl = `${configenv.proxy_protocol}://${configenv.proxy_usename}:${configenv.proxy_password}@${configenv.proxy_host}:${configenv.proxy_port}`;
        logger.info(`Instacia ${sessionId} 🛰️ Usando proxy: ${proxyUrl}`);

        try {
          configs.fetchAgent = new ProxyAgent(proxyUrl);
        } catch (err) {
          logger.error("❌ Erro ao criar ProxyAgent:", err);
          configs.fetchAgent = undefined; // fallback sem proxy
        }
      }
      const sock = makeWASocket(configs);
      this.sockets.set(sessionId, sock);

      const sessionData = {
        status: "connecting",
        phoneNumber: number,
        lastConnected: null,
        ignorar_grupos: getsessao.ignorar_grupos,
        msg_rejectcalls: getsessao.msg_rejectcalls,
        autoRead: getsessao.leitura_automatica,
        rejeitar_ligacoes: getsessao.rejeitar_ligacoes,
        webhook_status: getsessao.webhook_status === 1,
        webhook_url: getsessao.webhook_url,
        events: getsessao.events,
        url_imagem: null,
        reconect: true,
      };

      await this.redis.set(`sessao:${sessionId}`, sessionData);

      // Event handlers
      this.EventsGet(sock, sessionId, saveCreds);

      return { success: true, message: sessionData };
    } catch (error) {
      console.log(error);
      logger.error(`❌ Erro ao criar sessão ${sessionId}:`, error);
      throw error;
    }
  }

  //Buscar sockets
  static getSocket(sessionId) {
    return this.sockets.get(sessionId);
  }

  //Carregar sessões do banco de dados
  static async loadStateFromDb(sessionId) {
    const authRecord = await Session.getCreds(sessionId);
    if (!authRecord || !authRecord.auth) {
      return { creds: initAuthCreds() };
    }

    const dados = authRecord.auth;

    return {
      creds: JSON.parse(dados.creds, BufferJSON.reviver),
    };
  }

  static async saveStateToDb(sessionId, authState) {
    const credsJson = JSON.stringify(authState.creds, BufferJSON.replacer);

    const authJson = JSON.stringify({ creds: credsJson });
    await Session.saveCreds(sessionId, authJson);
  }

  //Eventos
  static EventsGet(sock, sessionId, saveCreds) {
    try {
      // Connection updates
      sock.ev.on("connection.update", async (update) => {
        await this.update_conexao(sessionId, update);
      });

      // Credentials update
      sock.ev.on("creds.update", saveCreds);

      // Messages - com throttling
      sock.ev.on("messages.upsert", ({ messages, type }) => {
        this.msgrecebidas(sessionId, messages, type).catch((error) => {
          logger.error(
            `Erro no pipeline messages.upsert da sessão ${sessionId}:`,
            error,
          );
        });
      });

      // Message updates (read receipts, etc)
      sock.ev.on("messages.update", async (updates) => {
        await this.update_mensagem(sessionId, updates);
      });

      // Chats - com throttling
      sock.ev.on("chats.set", async ({ chats }) => {
        await this.emitEvent(sessionId, "chats_set", chats);
        await this.chats_set(async () => {
          try {
            logger.info(
              `📂 Evento chats.set: ${chats.length} chats recebidos para sessão ${sessionId}`,
            );

            // Processar em lotes para evitar sobrecarga
            const batchSize = 50;
            for (let i = 0; i < chats.length; i += batchSize) {
              const batch = chats.slice(i, i + batchSize);
              for (const chat of batch) {
                if (!chat.id) continue;
                await Store.saveChat(sessionId, chat);
              }
              // Pequena pausa entre lotes
              await this.delay(100);
            }

            logger.info(
              `💾 ${chats.length} chats salvos no MySQL para sessão ${sessionId}`,
            );
          } catch (error) {
            logger.error(`Erro ao salvar chats no MySQL:`, error);
          }
        });
      });

      sock.ev.on("chats.update", async (updates) => {
        await this.emitEvent(sessionId, "chats_update", updates);
        await this.chats_set(async () => {
          try {
            for (const update of updates) {
              if (!update.id) continue;
              const key = `chats:${sessionId}_${update.id}`;
              const getchat = await this.redis.exists(key);
              if (!getchat) {
                logger.info(
                  `📂 Atualizando ${updates.length} chats para sessão ${sessionId}`,
                );
                await this.redis.set(key, update);
                await Store.saveChat(sessionId, update);
                if (update.id.endsWith("@s.whatsapp.net")) {
                  const message = update.messages[0].message;
                  update.id = message.key.id;
                  update.name = message.pushName || "";
                  update.notify = message.pushName || "";
                  update.verifiedName = message.pushName || "";
                  try {
                    const perfil = await sock.profilePictureUrl(update.id);
                    update.url_imagem = perfil;
                  } catch (error) {}
                  await Store.saveContact(sessionId, update);
                }
              }
            }
          } catch (error) {
            logger.error(`Erro ao atualizar chats:`, error);
          }
        });
      });

      // Contacts - com throttling
      sock.ev.on("contacts.set", async ({ contacts = [] } = {}) => {
        await this.emitEvent(sessionId, "contacts_set", contacts);
        await this.chats_set(async () => {
          try {
            logger.info(
              `👥 Evento contacts.set: ${contacts.length} contatos recebidos para sessão ${sessionId}`,
            );

            // Processar em lotes
            const batchSize = 100;
            for (let i = 0; i < contacts.length; i += batchSize) {
              const batch = contacts.slice(i, i + batchSize);
              for (const contact of batch) {
                if (!contact.id) continue;
                const key = `contatos:${sessionId}_${contact.id}`;
                const contatoExiste = this.redis.exists(key);
                if (!contatoExiste) {
                  this.redis.set(key, contact);
                  const result = await sock.profilePictureUrl(contact.id);
                  contact.url_imagem = result;
                  if (!contact.id.endsWith("@s.whatsapp.net")) continue;
                  await Store.saveContact(sessionId, contact);
                }
              }
              await this.delay(50);
            }

            logger.info(
              `💾 ${contacts.length} contatos salvos no MySQL para sessão ${sessionId}`,
            );
          } catch (error) {
            logger.error(`Erro ao salvar contatos no MySQL:`, error);
          }
        });
      });

      sock.ev.on("contacts.update", async (updates) => {
        await this.emitEvent(sessionId, "contacts_update", updates);
        await this.chats_set(async () => {
          try {
            for (const update of updates) {
              if (!update?.id || update.id.includes("@lid")) continue;
              const key = `contatos:${sessionId}_${update.id}`;
              const getctt = await this.redis.exists(key);
              if (!getctt) {
                logger.info(
                  `👥 Atualizando ${updates.length} contatos para sessão ${sessionId}`,
                );
                await this.redis.set(key, update);
                try {
                  const url = await sock.profilePictureUrl(update.id);
                  update.url_imagem = url;
                } catch (error) {}
                if (update.id.endsWith("@s.whatsapp.net")) {
                  await Store.saveContact(sessionId, update);
                }
              }
            }
          } catch (error) {
            logger.error(`Erro ao atualizar contatos:`, error);
          }
        });
      });

      sock.ev.on("contacts.upsert", async (contacts) => {
        for (const contact of contacts) {
          const key = `contatos:${sessionId}_${contact.id}`;
          const getctt = await this.redis.exists(key);
          if (!getctt) {
            logger.info(
              `👥 Atualizando ${contacts.length} contatos para sessão ${sessionId}`,
            );
            await this.redis.set(key, contact);
            try {
              const url = await sock.profilePictureUrl(contact.id);
              contact.url_imagem = url;
            } catch (error) {}
            if (contact.id.endsWith("@s.whatsapp.net")) {
              await Store.saveContact(sessionId, contact);
            }
          }
        }
      });

      // Eventos de grupo update
      sock.ev.on("groups.update", async (updates) => {
        const getsessao = await this.redis.get(`sessao:${sessionId}`);
        if (!getsessao || getsessao.ignorar_grupos) return;
        await this.emitEvent(sessionId, "groups_update", updates);
      });

      // // const originalEmit = sock.ev.emit;
      // sock.ev.emit = function (event, ...args) {
      //     console.log(`📡 Evento recebido: ${event}`);
      //     console.dir(args, { depth: null });
      //     // return originalEmit.call(this, event, ...args);
      // };

      sock.ev.on("group-participants.update", async (event) => {
        const getsessao = await this.redis.get(`sessao:${sessionId}`);
        if (!getsessao || getsessao.ignorar_grupos) return;
        await this.emitEvent(sessionId, "group_participants_update", event);
      });

      // Presence updates
      sock.ev.on("presence.update", async ({ id, presences }) => {
        await this.handlePresenceUpdate(sessionId, id, presences);
      });

      // Call events
      sock.ev.on("call", async (calls) => {
        await this.emitEvent(sessionId, "call_update", calls);
        await this.event_call(sessionId, calls);
      });

      // Histórico - SALVAMENTO DIRETO POSTGRESQL (otimizado para grandes volumes)
      sock.ev.on("messaging-history.set", async (dados) => {
        try {
          this.processHistoryBatchDirectly(sessionId, dados);
        } catch (error) {
          logger.error(`❌ Erro ao processar lote para ${sessionId}:`, error);
          // Limpar estatísticas em caso de erro
          await this.redis.del(`history_stats:${sessionId}`);
        }
      });
    } catch (error) {
      logger.error("Erro ao processar eventos:", error);
    }
  }

  // Função para restaurar credenciais do banco para arquivos
  static async restoreCredsFromDB(sessionId) {
    try {
      logger.info(
        `🔄 Restaurando credenciais do banco para sessão: ${sessionId}`,
      );

      const session = await Session.findById(sessionId);
      if (!session || !session.creds) {
        logger.warn(
          `❌ Nenhuma credencial encontrada no banco para sessão: ${sessionId}`,
        );
        return false;
      }

      const sessionDir = path.join(process.cwd(), "sessions", sessionId);
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

      logger.info(
        `✅ Credenciais restauradas do banco para arquivos: ${sessionId}`,
      );
      return true;
    } catch (error) {
      logger.error(
        `❌ Erro ao restaurar credenciais do banco para ${sessionId}:`,
        error,
      );
      return false;
    }
  }

  // Função para throttling de sincronização
  static async chats_set(syncFunction) {
    try {
      await syncFunction();
    } finally {
    }
  }

  static async update_conexao(sessionId, update) {
    const { connection, lastDisconnect, qr } = update;
    const sock = this.getSocket(sessionId);
    const sessionData = await this.redis.get(`sessao:${sessionId}`);
    if (!sessionData || !sock) return;

    logger.info(`🔄 Conexão ${sessionId}: ${connection || "indefinido"}`);

    await this.emitEvent(sessionId, "connection_update", update);

    if (qr) {
      let limiteqrcode = await this.qrcodelimites.get(
        `limiteqrcode:${sessionId}`,
      );
      if (!limiteqrcode) {
        limiteqrcode = { limite: 0 };
        await this.qrcodelimites.set(`limiteqrcode:${sessionId}`, limiteqrcode);
      }

      if (limiteqrcode.limite >= parseInt(configenv.qrcode_limite)) {
        logger.info(`❌ Máximo de qrcode atingido para ${sessionId}`);
        return await this.deleteSession(sessionId);
      }
      limiteqrcode.limite += 1;
      await this.qrcodelimites.set(`limiteqrcode:${sessionId}`, limiteqrcode);

      try {
        qrTerminal.generate(qr, { small: true }, (qrcode) => {
          logger.info(
            `QR Code ${limiteqrcode.limite++}/${configenv.qrcode_limite} Sessão ${sessionId}:\n`,
            qrcode,
          );
        });
        let code = null;

        if (sessionData.phoneNumber && sessionData.phoneNumber !== "") {
          try {
            await this.delay(1000);
            code = await sock.requestPairingCode(sessionData.phoneNumber);
            logger.info(`Codigo de pareamento: ${code}`);
          } catch (error) {
            logger.error("erro ao gerar codigo de conexão");
          }
        }

        const qrCodeDataURL = await QRCode.toDataURL(qr);
        sessionData.qrCode = qrCodeDataURL;

        await Session.update(sessionId, {
          status: "qr_ready",
          qr_code: qrCodeDataURL,
          code,
        });

        // Emit QR code event
        this.emitEvent(sessionId, "qr_updated", { qr: qrCodeDataURL, code });

        logger.info(`📱 QR Code gerado para sessão ${sessionId}`);
      } catch (error) {
        logger.error(`Erro ao gerar QR Code para ${sessionId}:`, error);
      }
    }

    if (connection === "close") {
      try {
        sessionData.status = "disconnected";
        await Session.update(sessionId, { status: "disconnected" });
        const shouldReconnect =
          (lastDisconnect?.error && lastDisconnect.error.output?.statusCode) !==
          DisconnectReason.loggedOut;

        if (shouldReconnect) {
          // Sistema de reconexão inteligente com backoff exponencial
          return await this.handleReconnection(sessionId, lastDisconnect);
        }

        await this.emitEvent(sessionId, "session_disconnected", {
          reason: lastDisconnect?.error?.message,
        });
        logger.info(`🚪 Sessão ${sessionId} foi desconectada (logout)`);
        try {
          await clearAuth(sessionId, this.redis.client);
        } catch (err) {
          console.error("Erro ao remover sessão do Redis:", err);
        }
        try {
          await clearDbAuth(sessionId);
        } catch (err) {
          console.error("Erro ao remover sessão do banco:", err);
        }
        await this.deleteSession(sessionId);
        return;
      } catch (error) {
        console.error(`Erro na conexão ${sessionId}: `, error);
      }
    }

    if (connection === "connecting") {
      sessionData.status = "connecting";

      await Session.update(sessionId, { status: "connecting" });
    }

    if (connection === "open") {
      sessionData.status = "connected";
      sessionData.lastConnected = moment()
        .tz(configenv.timeZone)
        .format("YYYY-MM-DD HH:mm:ss");
      await this.qrcodelimites.delete(`limiteqrcode:${sessionId}`);
      await this.redis.del(`tentativas:${sessionId}`);
      // Limpar tentativas de reconexão
      this.reconnectAttempts.delete(sessionId);

      const phoneNumber = sock?.user?.id?.split(":")[0];
      const sessaoDB = await Session.findById(sessionId);

      sessionData.phoneNumber = phoneNumber;
      sessionData.ignorar_grupos = sessaoDB.ignorar_grupos;
      sessionData.rejeitar_ligacoes = sessaoDB.rejeitar_ligacoes;
      sessionData.msg_rejectcalls = sessaoDB.msg_rejectcalls;
      sessionData.webhook_status = sessaoDB.webhook_status;
      sessionData.webhook_url = sessaoDB.webhook_url;
      sessionData.events = sessaoDB.events;
      await Session.update(sessionId, {
        status: "connected",
        phone_number: phoneNumber,
      });

      logger.info(
        `✅ Sessão ${sessionId} conectada com sucesso! Telefone: ${phoneNumber}`,
      );
      // Sincronização mais conservadora após conexão
      this.forceSyncAll(sessionId);
    }

    await this.redis.set(`sessao:${sessionId}`, sessionData);
  }

  // Função para sincronização de contatos do Baileys v7
  static async forceSyncContatos(sessionId) {
    try {
      const sessionData = await this.redis.get(`sessao:${sessionId}`);
      const sock = this.getSocket(sessionId);

      if (!sessionData || !sock) return;

      logger.info(
        `🔄 Forçando sincronização de contatos para sessão ${sessionId}...`,
      );

      // Método válido no Baileys v7: Sincronizar contatos via eventos
      try {
        // Força um evento de sincronização de contatos (se disponível)
        if (typeof sock.ev?.emit === "function") {
          logger.info(`📱 Tentando forçar evento de sincronização de contatos`);
        }

        // Alternativa: Extrair contatos dos chats existentes
        const chats = await Store.getChats(sessionId);
        let contactsFromChats = 0;

        if (chats && chats.length > 0) {
          logger.info(
            `📂 Extraindo contatos de ${chats.length} chats existentes`,
          );

          for (const chat of chats) {
          }

          logger.info(
            `📱 ${contactsFromChats} contatos extraídos e salvos dos chats`,
          );
        } else {
          logger.warn(`📂 Nenhum chat encontrado para extrair contatos`);
        }
      } catch (syncError) {
        logger.error(`Erro na sincronização de contatos:`, syncError.message);
      }
    } catch (error) {
      logger.error(
        `Erro ao forçar sincronização de contatos para ${sessionId}:`,
        error,
      );
    }
  }

  // NOVA FUNÇÃO: Forçar sincronização completa
  static async forceSyncAll(sessionId) {
    try {
      logger.info(
        `🔄 Iniciando sincronização completa para sessão ${sessionId}...`,
      );

      // Executa sequencialmente para reduzir uso simultâneo de memória/IO
      await this.forceSyncContatos(sessionId);
      await this.delay(2000);
      await this.forceSyncChats(sessionId);
      await this.delay(2000);
      const getsessao = await this.redis.get(`sessao:${sessionId}`);
      if (getsessao && !getsessao.ignorar_grupos) {
        await this.forceSyncGroups(sessionId);
      }

      logger.info(
        `✅ Sincronização completa finalizada para sessão ${sessionId}`,
      );
    } catch (error) {
      logger.error(`Erro na sincronização completa para ${sessionId}:`, error);
    }
  }

  static async forceSyncChats(sessionId) {
    try {
      const sessionData = await this.redis.get(`sessao:${sessionId}`);
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

  static async forceSyncGroups(sessionId) {
    try {
      const sessionData = await this.redis.get(`sessao:${sessionId}`);
      const sock = this.getSocket(sessionId);
      if (!sock) return;
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
  static async syncContactsManually(sessionId) {
    await this.forceSyncContatos(sessionId);
  }

  // ✅ SALVAMENTO DIRETO POSTGRESQL - PROCESSAMENTO EM TEMPO REAL

  // Processar lote imediatamente no PostgreSQL (sem acumular na memória)
  static async processHistoryBatchDirectly(
    sessionId,
    { chats, contacts, messages },
  ) {
    try {
      // Processar de forma assíncrona para não bloquear outros lotes
      setImmediate(async () => {
        try {
          let savedChats = 0,
            savedContacts = 0,
            savedMessages = 0;

          // Salvar contatos do lote atual
          for (const contact of contacts) {
            try {
              if (
                !contact.id ||
                !contact.id.includes("@s.whatsapp.net") ||
                contact.id == "0"
              )
                continue;

              const key = `contatos:${sessionId}_${contact.id}`;
              const existingContact = await this.redis.exists(key);
              if (!existingContact) {
                await this.redis.set(key, contact, 3600); // Cache por 1 hora

                // Tentar obter foto de perfil (com timeout rápido)
                try {
                  const sock = this.getSocket(sessionId);
                  if (sock) {
                    const profilePromise = sock.profilePictureUrl(contact.id);
                    const timeoutPromise = new Promise((_, reject) =>
                      setTimeout(() => reject(new Error("Timeout")), 2000),
                    );
                    const profileUrl = await Promise.race([
                      profilePromise,
                      timeoutPromise,
                    ]);
                    contact.url_imagem = profileUrl;
                  }
                } catch (profileError) {
                  // Ignorar erros de foto de perfil
                }
                if (!contact.id.endsWith("@s.whatsapp.net")) continue;
                await Store.saveContact(sessionId, contact);
                savedContacts++;
              } else {
                if (!contact.id.endsWith("@s.whatsapp.net")) continue;
                await Store.updateContact(sessionId, contact.id, contact);
              }
            } catch (error) {
              // Continuar mesmo com erro em item individual
            }
          }

          // Salvar mensagens do lote atual (limitado para performance)
          const limitedMessages = messages.slice(-50); // Apenas últimas 50 mensagens por lote

          for (const message of limitedMessages) {
            try {
              if (!message?.key?.id) continue;
              const key = `message:${sessionId}_${message.key.id}`;
              const existingMessage = await this.redis.exists(key);
              if (!existingMessage) {
                let temp_delete = null;
                if (configenv.delete_message) {
                  temp_delete = configenv.temp_delet_message;
                }
                this.redis.set(key, message, temp_delete);
                await Store.saveMessage(sessionId, message);
                savedMessages++;
              }
            } catch (error) {
              // Continuar mesmo com erro em item individual
            }
          }

          if (savedChats > 0 || savedContacts > 0 || savedMessages > 0) {
            logger.info(
              `💾 Lote salvo para ${sessionId}: ${savedChats} chats, ${savedContacts} contatos, ${savedMessages} mensagens`,
            );
          }
        } catch (error) {
          logger.error(
            `❌ Erro ao processar lote direto para ${sessionId}:`,
            error,
          );
        }
      });
    } catch (error) {
      logger.error(
        `❌ Erro ao agendar processamento para ${sessionId}:`,
        error,
      );
    }
  }

  // Obter estatísticas das sincronizações no Redis
  static async getHistoryAccumulatorStats() {
    try {
      const patterns = ["history_stats:*", "history_accumulator:*"]; // Compatibilidade
      const stats = {
        total: 0,
        sessions: [],
        directProcessing: true, // Indica que usa processamento direto
      };

      for (const pattern of patterns) {
        let cursor = "0";

        do {
          const [nextCursor, keys] = await this.redis.client.scan(
            cursor,
            "MATCH",
            pattern,
            "COUNT",
            200,
          );
          cursor = nextCursor;

          for (const key of keys) {
            stats.total += 1;
            const sessionId = key.split(":")[1];
            const data = await this.redis.get(key);

            if (data) {
              const sessionStats = {
                sessionId,
                batches: data.batches || 0,
                totalChats: data.totalChats || data.chats?.length || 0,
                totalContacts: data.totalContacts || data.contacts?.length || 0,
                totalMessages: data.totalMessages || data.messages?.length || 0,
                duration: data.startTime
                  ? (Date.now() - data.startTime) / 1000
                  : 0,
                processing: pattern.includes("stats")
                  ? "direct"
                  : "accumulated",
              };
              stats.sessions.push(sessionStats);
            }
          }
        } while (cursor !== "0");
      }

      return stats;
    } catch (error) {
      logger.error("❌ Erro ao obter estatísticas Redis:", error);
      return { total: 0, sessions: [], directProcessing: true };
    }
  }

  static async msgrecebidas(sessionId, messages, type) {
    const getsessao = (await this.redis.get(`sessao:${sessionId}`)) || {};
    const sock = this.getSocket(sessionId);
    for (const message of messages) {
      if (!message || !message.key) {
        continue;
      }

      if (message.key.addressingMode === "lid" && message.key.remoteJidAlt) {
        const jid = message.key.remoteJidAlt;
        const lid = message.key.remoteJid;
        message.key.remoteJidAlt = lid;
        message.key.remoteJid = jid;
      }
      // Validação básica da estrutura da mensagem
      if (!message || !message.key || !message.key.remoteJid) {
        logger.warn(`⚠️ Mensagem inválida recebida na sessão ${sessionId}:`, {
          hasMessage: !!message,
          hasKey: !!message?.key,
          hasRemoteJid: !!message?.key?.remoteJid,
        });
        continue;
      }
     
      try {
        const remoteJid = message.key.remoteJid;
        if (
          remoteJid &&
          remoteJid.endsWith("@g.us") &&
          getsessao?.ignorar_grupos
        )
          continue;
      } catch (error) {
        logger.warn(
          `⚠️ Falha ao avaliar filtro de grupo na sessão ${sessionId}, continuando processamento.`,
        );
      }
      let selectedOptions = null;
      const pollMsgId1 = message?.message?.pollCreationMessageKey?.id || null;
      const pollMsgId2 =
        message?.message?.pollUpdateMessage?.pollCreationMessageKey?.id || null;
      const pollMsgId = pollMsgId1 || pollMsgId2;
      const pollId = message.key.id;

      if (pollMsgId && message.key?.remoteJid) {
        try {
          // const [msg] = await Store.getMessagesvote(sessionId, message.key, pollMsgId)
          const key = `message:${sessionId}_${pollMsgId}`;
          const getmessage = await this.redis.exists(key);

          if (!getmessage) {
            logger.warn(
              `⚠️ Mensagem de enquete não encontrada para ID ${pollMsgId} na sessão ${sessionId}`,
            );
            continue;
          }
          const msg = await this.redis.get(key);
          const creatpollJid = msg.participant
            ? msg.participant.split(":")[0] + "@s.whatsapp.net"
            : sock.user.id.split(":")[0] + "@s.whatsapp.net";

          let voterJid = message.key.remoteJid;
          if (message.key.fromMe) {
            voterJid = sock.user.id.split(":")[0] + "@s.whatsapp.net";
          } else {
            if (message.key.addressingMode === "lid") {
              voterJid = message.key.participantAlt || message.key.participant;
            }
          }

          if (
            sock?.user?.id?.split(":")[0] &&
            msg.message?.messageContextInfo?.messageSecret
          ) {
            const decrypted = await decryptPollVote(
              message?.message.pollUpdateMessage.vote,
              {
                pollCreatorJid: creatpollJid,
                pollMsgId: pollMsgId,
                pollEncKey: Buffer.from(
                  msg.message.messageContextInfo.messageSecret,
                  "base64",
                ),
                voterJid: voterJid,
              },
            );

            for (const decryptedHash of decrypted.selectedOptions) {
              const hashHex = Buffer.from(decryptedHash)
                .toString("hex")
                .toUpperCase();
              for (const option of msg.message.pollCreationMessageV3?.options ||
                []) {
                const hash = Buffer.from(
                  digestSync(
                    "SHA-256",
                    new TextEncoder().encode(
                      Buffer.from(option.optionName).toString(),
                    ),
                  ),
                )
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
          logger.error(
            `❌ Erro ao processar atualização de enquete (sessionId: ${sessionId}):`,
            {
              error: error.message,
              stack: error.stack,
              messageKey: message?.key,
              pollUpdate: message?.message ? "presente" : "ausente",
              hasRemoteJid: !!message?.key?.remoteJid,
            },
          );
        }
      }

      try {
        // Salvar mensagem no store
        if (!message?.key?.id) continue;
        const key = `message:${sessionId}_${message.key.id}`;
        const getmessage = await this.redis.exists(key);
     
        if (!getmessage) {
          let temp_delete = null;
          if (configenv.delete_message) {
            temp_delete = configenv.temp_delet_message;
          }
          this.redis.set(key, message, temp_delete);
          await Store.saveMessage(sessionId, message);
        }

        // Verificar configurações da sessão
        const config = await this.redis.get(`sessao:${sessionId}`);

        // Auto-read
        if (
          config?.autoRead &&
          !message.key.fromMe &&
          message.key.remoteJid &&
          message.key.id
        ) {
          await this.markAsRead(
            sessionId,
            message.key.remoteJid,
            message.key.id,
          );
        }

        if (selectedOptions) {
          message.PollVote = selectedOptions;
        }

        let mensagemSend = message;
        const decryptMidia = await this.baixarMediaComoBase64(message, sock);
        if (decryptMidia) {
          mensagemSend = decryptMidia;
        }

        // Emit message event
        await this.emitEvent(sessionId, "message_received", {
          message: mensagemSend,
        });

        try {
       
          message.id = message.key.remoteJid;
          message.name = message.pushName || "";
          message.notify = message.pushName || "";
          message.verifiedName = message.pushName || "";
          try {
            const perfil = await sock.profilePictureUrl(message.id);
            message.url_imagem = perfil;
          } catch (error) {}
          if (message.id.endsWith("@s.whatsapp.net")) {
            await Store.saveContact(sessionId, message);
          }
        } catch (error) {
          console.log(error)
        }
      } catch (error) {
        logger.error(`Erro ao processar mensagem:`, error);
      }
    }
  }

  static async baixarMediaComoBase64(message, sock) {
    try {
      if (!message?.message) return null;

      let msg = message.message;

      // --- DESENCAPSULA mensagens ---
      const unwrap = (obj) => {
        const tipos = [
          "ephemeralMessage",
          "viewOnceMessage",
          "viewOnceMessageV2",
          "viewOnceMessageV2Extension",
          "documentWithCaptionMessage",
          "deviceSentMessage",
        ];
        while (tipos.some((t) => obj?.[t])) {
          const tipo = Object.keys(obj)[0];
          obj = obj[tipo].message || obj[tipo];
        }
        return obj;
      };

      msg = unwrap(msg);

      const tipo = Object.keys(msg)[0];
      const conteudo = msg[tipo];

      const tiposSuportados = [
        "imageMessage",
        "videoMessage",
        "audioMessage",
        "documentMessage",
        "stickerMessage",
      ];

      if (!tiposSuportados.includes(tipo)) return null;

      // --- BAIXA MÍDIA ---
      const buffer = await downloadMediaMessage(
        message,
        "buffer",
        {},
        {
          logger: console,
          reuploadRequest: sock.updateMediaMessage?.bind(sock),
        },
      );

      // --- LIMITE ---
      const MAX_BYTES = parseInt(
        configenv.max_media_bytes || `${5 * 1024 * 1024}`,
      );

      // Grande → salva arquivo
      if (buffer.length > MAX_BYTES) {
        const tmpDir = path.join(process.cwd(), "tmp");
        if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

        const ext = (conteudo.mimetype || "bin").split("/")[1] || "dat";

        const tmpFile = path.join(tmpDir, `${message.key.id}_${tipo}.${ext}`);

        await fs.promises.writeFile(tmpFile, buffer);

        return {
          ...message,
          media: {
            filePath: tmpFile,
            size: buffer.length,
            mimetype: conteudo.mimetype,
            largeFile: true,
          },
        };
      }

      // Pequeno → base64
      const base64 = buffer.toString("base64");

      return {
        ...message,
        media: {
          base64,
          dataUrl: `data:${conteudo.mimetype};base64,${base64}`,
          mimetype: conteudo.mimetype,
          size: buffer.length,
        },
      };
    } catch (e) {
      console.error("Erro baixar mídia:", e);
      return null;
    }
  }

  static async update_mensagem(sessionId, updates) {
    for (const update of updates) {
      try {
        if (!update?.key?.remoteJid) {
          logger.warn(
            `⚠️ Update de mensagem inválido na sessão ${sessionId}:`,
            {
              hasUpdate: !!update,
              hasKey: !!update?.key,
              hasRemoteJid: !!update?.key?.remoteJid,
            },
          );
          continue;
        }

        await this.emitEvent(sessionId, "message_update", {
          jid: update.key.remoteJid,
          update,
        });
        // Atualizar status da mensagem no banco
        // Implementar lógica de atualização se necessário

        logger.debug(
          `📝 Mensagem atualizada: ${update.key.id} - Status: ${update.update?.status}`,
        );
      } catch (error) {
        logger.error(`Erro ao atualizar mensagem:`, error);
      }
    }
  }

  static async handlePresenceUpdate(sessionId, id, presences) {
    try {
      await this.emitEvent(sessionId, "presence_update", {
        jid: id,
        presences,
      });
    } catch (error) {
      logger.error(`Erro ao processar atualização de presença:`, error);
    }
  }

  static async event_call(sessionId, calls) {
    try {
      await this.emitEvent(sessionId, "call", calls);
      const sessiondata = await this.redis.get(`sessao:${sessionId}`);
      const sock = this.getSocket(sessionId);
      if (!sessiondata || !sock) return;

      for (const call of calls) {

        if (sessiondata?.rejeitar_ligacoes && call.status === "offer") {
          await sock.rejectCall(call.id, call.from);
          if (
            sessiondata?.msg_rejectcalls &&
            sessiondata?.msg_rejectcalls !== ""
          ) {
            const message = {
              text: sessiondata.msg_rejectcalls,
            };
            await this.sendMessage(sessionId, call.from, message);
          }
          logger.info(`📞 Chamada rejeitada automaticamente de ${call.from}`);
        }
      }
    } catch (error) {
      logger.error(`Erro ao processar chamadas:`, error);
    }
  }

  extractMessageContent(message) {
    if (!message) return "";
    if (message.conversation) return message.conversation;
    if (message.extendedTextMessage?.text)
      return message.extendedTextMessage.text;
    if (message.imageMessage?.caption) return message.imageMessage.caption;
    if (message.videoMessage?.caption) return message.videoMessage.caption;
    if (message.documentMessage?.caption)
      return message.documentMessage.caption;
    return JSON.stringify(message);
  }

  static async emitEvent(sessionId, event, data) {
    try {
      // Global WebSocket
      if (this.globalWebSocketService) {
        this.globalWebSocketService.broadcast(sessionId, event, data);
      }

      // Session-specific webhook
      const config = await this.redis.get(`sessao:${sessionId}`);

      const webhookTasks = [];

      // Global Webhook
      webhookTasks.push(
        GlobalWebhookService.sendGlobalWebhook({
          event,
          sessionId,
          data,
        }),
      );

      if (
        config?.webhook_status &&
        config.webhook_status == "1" &&
        config?.events &&
        Array.isArray(config.events)
      ) {
        const Isevent = config.events.find((e) => e == event);
        if (Isevent) {
          const webhookService = new WebhookService();
          webhookTasks.push(
            webhookService.sendWebhook(config.webhook_url, {
              event,
              sessionId,
              data,
              timestamp: moment().tz(configenv.timeZone).toISOString(),
            }),
          );
        }
      }

      const highFrequencyEvents = new Set([
        "message_received",
        "message_update",
        "presence_update",
        "connection_update",
      ]);

      if (highFrequencyEvents.has(event)) {
        Promise.allSettled(webhookTasks).catch(() => {});
        return;
      }

      await Promise.allSettled(webhookTasks);
    } catch (error) {
      logger.error(`Erro ao emitir evento ${event}:`, error);
    }
  }

  // Função para preparar mídia antes de enviar
  static async prepareMedia(sessionId, mediaData) {
    try {
      const sessionData = await this.redis.get(`sessao:${sessionId}`);

      if (!sessionData) {
        throw new Error("Sessão não encontrada ou não conectada");
      }

      // Se for URL, retornar como está
      if (
        typeof mediaData === "string" &&
        (mediaData.startsWith("http") || mediaData.startsWith("https"))
      ) {
        return { url: mediaData };
      }

      // Se for base64, converter para buffer
      if (typeof mediaData === "string" && mediaData.startsWith("data:")) {
        const base64Data = mediaData.split(",")[1];
        const buffer = Buffer.from(base64Data, "base64");
        return buffer;
      }

      // Se for buffer, retornar como está
      if (Buffer.isBuffer(mediaData)) {
        return mediaData;
      }

      // Se for objeto com url
      if (typeof mediaData === "object" && mediaData.url) {
        return mediaData;
      }

      // Fallback: tentar como URL
      return { url: mediaData };
    } catch (error) {
      logger.error("Erro ao preparar mídia:", error);
      throw new Error("Formato de mídia inválido");
    }
  }

  // Message sending methods
  static async sendMessage(sessionId, to, message) {
    try {
      const sessionData = await this.redis.get(`sessao:${sessionId}`);
      const sock = this.getSocket(sessionId);

      if (!sessionData || !sock) {
        throw new Error("Sessão não encontrada ou não conectada");
      }

      const jid = to.includes("@") ? to : `${to}@s.whatsapp.net`;

      // Preparar mídia se necessário
      if (message?.image?.url) {
        message.image = await this.prepareMedia(sessionId, message.image.url);
        message.fileName = "image.jpg";
        message.mimetype = "image/jpeg";
      }
      if (message.video?.url) {
        message.video = await this.prepareMedia(sessionId, message.video.url);
      }
      if (message.audio?.url) {
        message.audio = await this.prepareMedia(sessionId, message.audio.url);
      }
      if (message.document?.url) {
        message.document = await this.prepareMedia(
          sessionId,
          message.document.url,
        );
      }
      if (message.sticker?.url) {
        message.sticker = await this.prepareMedia(
          sessionId,
          message.sticker.url,
        );
      }

      const result = await sock.sendMessage(jid, message);
      await sock.sendPresenceUpdate("paused", jid);
      logger.info(`📤 Mensagem enviada: ${sessionId} -> ${jid}`);
      return result;
    } catch (error) {
      logger.error(`Erro ao enviar mensagem:`, error);
      console.log("Erro ao enviar mensagem de texto:", error);
      throw error;
    }
  }

  // Message sending methods
  static async deleteMessage(sessionId, to, message) {
    try {
      const sessionData = await this.redis.get(`sessao:${sessionId}`);
      const sock = this.getSocket(sessionId);
      if (!sessionData || !sock) {
        throw new Error("Sessão não encontrada ou não conectada");
      }

      const result = await sock.sendMessage(to, { delete: message });

      logger.info(`📤 Mensagem Deletada: ${sessionId} -> ${to}`);
      return result;
    } catch (error) {
      logger.error(`Erro ao Deletar mensagem:`, error);
      throw error;
    }
  }

  static async sendReaction(sessionId, to, messageId, emoji) {
    try {
      const sessionData = await this.redis.get(`sessao:${sessionId}`);
      const sock = this.getSocket(sessionId);
      if (!sessionData || !sock) {
        throw new Error("Sessão não encontrada ou não conectada");
      }

      const jid = to.includes("@") ? to : `${to}@s.whatsapp.net`;

      const reactionMessage = {
        react: {
          text: emoji,
          key: { remoteJid: jid, id: messageId },
        },
      };

      const result = await sock.sendMessage(jid, reactionMessage);
      return result;
    } catch (error) {
      logger.error(`Erro ao enviar reação:`, error);
      throw error;
    }
  }

  static async sendTyping(sessionId, to, typing, audio = false) {
    try {
      const sessionData = await this.redis.get(`sessao:${sessionId}`);
      const sock = this.getSocket(sessionId);
      if (!sessionData || !sock) {
        throw new Error("Sessão não encontrada ou não conectada");
      }

      const jid = to.includes("@") ? to : `${to}@s.whatsapp.net`;
      if (audio) {
        await sock.sendPresenceUpdate(typing ? "recording" : "paused", jid);
      } else {
        await sock.sendPresenceUpdate(typing ? "composing" : "paused", jid);
      }

      return { success: true };
    } catch (error) {
      logger.error(`Erro ao enviar status de digitação:`, error);
      throw error;
    }
  }

  static async markAsRead(sessionId, jid, messageId = null) {
    try {
      const sessionData = await this.redis.get(`sessao:${sessionId}`);
      const sock = this.getSocket(sessionId);
      if (!sessionData || !sock) {
        throw new Error("Sessão não encontrada ou não conectada");
      }

      if (messageId) {
        await sock.readMessages([{ remoteJid: jid, id: messageId }]);
      } else {
        await sock.chatModify({ markRead: true }, jid);
      }

      return { success: true };
    } catch (error) {
      logger.error(`Erro ao marcar como lida:`, error);
      throw error;
    }
  }

  // Contact methods
  static async getContactProfile(sessionId, jid) {
    const sessionData = await this.redis.get(`sessao:${sessionId}`);
    const sock = this.getSocket(sessionId);
    if (!sessionData || !sock) {
      throw new Error("Sessão não encontrada ou não conectada");
    }
    try {
      const profile = await sock.getBusinessProfile(jid);
      return profile;
    } catch (error) {
      // Try regular profile if business profile fails
      try {
        const status = await sock.fetchStatus(jid);
        return { status: status?.status };
      } catch (err) {
        logger.error(`Erro ao obter perfil do contato:`, error);
        throw error;
      }
    }
  }

  static async checkNumbers(sessionId, numbers) {
    try {
      const sessionData = await this.redis.get(`sessao:${sessionId}`);
      const sock = this.getSocket(sessionId);
      if (!sessionData || !sock) {
        throw new Error("Sessão não encontrada ou não conectada");
      }

      const results = [];
      for (const number of numbers) {
        try {
          const jid = number.includes("@")
            ? number
            : `${number}@s.whatsapp.net`;
          const [result] = await sock.onWhatsApp(jid);
          results.push({
            number,
            exists: !!result?.exists,
            jid: result?.jid || null,
          });
        } catch (error) {
          results.push({
            number,
            exists: false,
            error: error.message,
          });
        }
      }

      return results;
    } catch (error) {
      logger.error(`Erro ao verificar números:`, error);
      throw error;
    }
  }

  static async blockContact(sessionId, jid) {
    try {
      const sessionData = await this.redis.get(`sessao:${sessionId}`);
      const sock = this.getSocket(sessionId);
      if (!sessionData || !sock) {
        throw new Error("Sessão não encontrada ou não conectada");
      }

      await sock.updateBlockStatus(jid, "block");
      return { success: true };
    } catch (error) {
      logger.error(`Erro ao bloquear contato:`, error);
      throw error;
    }
  }

  static async unblockContact(sessionId, jid) {
    try {
      const sessionData = await this.redis.get(`sessao:${sessionId}`);
      const sock = this.getSocket(sessionId);
      if (!sessionData || !sock) {
        throw new Error("Sessão não encontrada ou não conectada");
      }

      await sock.updateBlockStatus(jid, "unblock");
      return { success: true };
    } catch (error) {
      logger.error(`Erro ao desbloquear contato:`, error);
      throw error;
    }
  }

  // Group methods
  static async getGroupInfo(sessionId, groupJid) {
    try {
      const sessionData = await this.redis.get(`sessao:${sessionId}`);
      const sock = this.getSocket(sessionId);
      if (!sessionData || !sock) {
        throw new Error("Sessão não encontrada ou não conectada");
      }

      const groupInfo = await sock.groupMetadata(groupJid);
      return groupInfo;
    } catch (error) {
      logger.error(`Erro ao obter informações do grupo:`, error);
      throw error;
    }
  }

  static async createGroup(sessionId, subject, participants) {
    try {
      const sessionData = await this.redis.get(`sessao:${sessionId}`);
      const sock = this.getSocket(sessionId);
      if (!sessionData || !sock) {
        throw new Error("Sessão não encontrada ou não conectada");
      }

      const group = await sock.groupCreate(subject, participants);
      return group;
    } catch (error) {
      logger.error(`Erro ao criar grupo:`, error);
      throw error;
    }
  }

  static async addParticipants(sessionId, groupJid, participants) {
    try {
      const sessionData = await this.redis.get(`sessao:${sessionId}`);
      const sock = this.getSocket(sessionId);
      if (!sessionData || !sock) {
        throw new Error("Sessão não encontrada ou não conectada");
      }

      const result = await sock.groupParticipantsUpdate(
        groupJid,
        participants,
        "add",
      );
      return result;
    } catch (error) {
      logger.error(`Erro ao adicionar participantes:`, error);
      throw error;
    }
  }

  static async removeParticipants(sessionId, groupJid, participants) {
    try {
      const sessionData = await this.redis.get(`sessao:${sessionId}`);
      const sock = this.getSocket(sessionId);
      if (!sessionData || !sock) {
        throw new Error("Sessão não encontrada ou não conectada");
      }

      const result = await sock.groupParticipantsUpdate(
        groupJid,
        participants,
        "remove",
      );
      return result;
    } catch (error) {
      logger.error(`Erro ao remover participantes:`, error);
      throw error;
    }
  }

  static async promoteParticipants(sessionId, groupJid, participants) {
    try {
      const sessionData = await this.redis.get(`sessao:${sessionId}`);
      const sock = this.getSocket(sessionId);
      if (!sessionData || !sock) {
        throw new Error("Sessão não encontrada ou não conectada");
      }

      const result = await sock.groupParticipantsUpdate(
        groupJid,
        participants,
        "promote",
      );
      return result;
    } catch (error) {
      logger.error(`Erro ao promover participantes:`, error);
      throw error;
    }
  }

  static async demoteParticipants(sessionId, groupJid, participants) {
    try {
      const sessionData = await this.redis.get(`sessao:${sessionId}`);
      const sock = this.getSocket(sessionId);
      if (!sessionData || !sock) {
        throw new Error("Sessão não encontrada ou não conectada");
      }

      const result = await sock.groupParticipantsUpdate(
        groupJid,
        participants,
        "demote",
      );
      return result;
    } catch (error) {
      logger.error(`Erro ao rebaixar participantes:`, error);
      throw error;
    }
  }

  static async leaveGroup(sessionId, groupJid) {
    try {
      const sessionData = await this.redis.get(`sessao:${sessionId}`);
      const sock = this.getSocket(sessionId);
      if (!sessionData || !sock) {
        throw new Error("Sessão não encontrada ou não conectada");
      }

      await sock.groupLeave(groupJid);
      return { success: true };
    } catch (error) {
      logger.error(`Erro ao sair do grupo:`, error);
      throw error;
    }
  }

  static async updateGroupSubject(sessionId, groupJid, subject) {
    try {
      const sessionData = await this.redis.get(`sessao:${sessionId}`);
      const sock = this.getSocket(sessionId);
      if (!sessionData || !sock) {
        throw new Error("Sessão não encontrada ou não conectada");
      }

      await sock.groupUpdateSubject(groupJid, subject);
      return { success: true };
    } catch (error) {
      logger.error(`Erro ao atualizar nome do grupo:`, error);
      throw error;
    }
  }

  static async groupSettingUpdate(sessionId, groupJid, subject) {
    try {
      const sessionData = await this.redis.get(`sessao:${sessionId}`);
      const sock = this.getSocket(sessionId);
      if (!sessionData || !sock) {
        throw new Error("Sessão não encontrada ou não conectada");
      }

      await sock.groupSettingUpdate(groupJid, subject);
      return { success: true };
    } catch (error) {
      logger.error(`Erro ao abrir/fechar grupos:`, error);
      throw error;
    }
  }

  static async updateGroupDescription(sessionId, groupJid, description) {
    try {
      const sessionData = await this.redis.get(`sessao:${sessionId}`);
      const sock = this.getSocket(sessionId);
      if (!sessionData || !sock) {
        throw new Error("Sessão não encontrada ou não conectada");
      }

      await sock.groupUpdateDescription(groupJid, description);
      return { success: true };
    } catch (error) {
      logger.error(`Erro ao atualizar descrição do grupo:`, error);
      throw error;
    }
  }

  static async deleteSession(sessionId) {
    try {
      // Limpar tentativas de reconexão
      this.reconnectAttempts.delete(sessionId);
      this.keepAliveIntervals.delete(sessionId);
      this.sessionHeartbeats.delete(sessionId);

      const sock = this.getSocket(sessionId);
      if (sock) {
        try {
          if (sock.ev && typeof sock.ev.removeAllListeners === "function") {
            sock.ev.removeAllListeners();
          }
        } catch (error) {}

        try {
          if (typeof sock.end === "function") {
            await sock.end();
          } else if (sock.ws && typeof sock.ws.close === "function") {
            sock.ws.close();
          }
        } catch (error) {}

        this.sockets.delete(sessionId);
      }

      try {
        await clearAuth(sessionId, this.redis.client);
      } catch (err) {
        console.error("Erro ao remover sessão do Redis:", err);
      }

      try {
        await clearDbAuth(sessionId);
      } catch (err) {
        console.error("Erro ao remover sessão do banco:", err);
      }

      // Remover da memória
      const sessionData = await this.redis.get(`sessao:${sessionId}`);
      if (sessionData) {
        await this.qrcodelimites.delete(`limiteqrcode:${sessionId}`);
        await this.redis.del(`tentativas:${sessionId}`);
        await this.redis.del(`sessao:${sessionId}`);
      }
      logger.info(`🗑️ Sessão ${sessionId} deletada completamente`);
    } catch (error) {
      logger.error(`Erro ao deletar sessão ${sessionId}:`, error);
      throw error;
    }
  }

  static delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Utility methods
  static async isSessionConnected(sessionId) {
    const sessionData = await Session.findById(sessionId);
    const sock = this.getSocket(sessionId);
    return sessionData?.status === "connected" && sock?.ws?.readyState === 1;
  }

  static async getSession(sessionId) {
    const sessionData = await this.redis.get(`sessao:${sessionId}`);
    const sock = this.getSocket(sessionId);

    if (
      sock &&
      sessionData &&
      sessionData.status === "connected" &&
      sessionData.phoneNumber
    ) {
      try {
        const perfil = await sock.profilePictureUrl(
          `${sessionData.phoneNumber}@s.whatsapp.net`,
        );
        sessionData.url_imagem = perfil;
      } catch (error) {
        logger.error("Erro ao obter imagem de perfil:", error);
      }
    }
    return sessionData;
  }

  static getActiveSessions() {
    return Array.from(this.redis.getAllSessions());
  }

  static async getSessionsStats() {
    const sessions = await Session.findByApiKey();
    return {
      total: sessions.length,
      connected: sessions.filter((s) => s.status === "connected").length,
      connecting: sessions.filter(
        (s) => s.status === "connecting" || s.status === "qr_ready",
      ).length,
      disconnected: sessions.filter((s) => s.status === "disconnected").length,
    };
  }

  static async healthCheck() {
    const stats = this.getSessionsStats();
    const activeSessions = this.getActiveSessions();
    const historyStats = await this.getHistoryAccumulatorStats();

    return {
      status: "healthy",
      timestamp: moment().tz(configenv.timeZone).toISOString(),
      sessions: stats,
      activeSessions,
      historyAccumulators: historyStats,
      memory: process.memoryUsage(),
      uptime: process.uptime(),
      redis: {
        connected: true,
        accumulatorsInProgress: historyStats.total,
      },
    };
  }

  static startHealthCheck() {
    this.healthCheckInterval = setInterval(
      async () => {
        try {
          await this.cleanupSessions();
        } catch (error) {
          logger.error("Erro no health check:", error);
        }
      },
      5 * 60 * 1000,
    ); // Every 5 minutes
  }

  static stopHealthCheck() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  static async cleanupSessions() {
    const sessionsToCleanup = [];
    const getsessoes = await this.redis.getAllSessions();

    for (const sessao of getsessoes) {
      let sessionId = null;
      try {
        sessionId = sessao.key.split(":")[1];
      } catch (error) {}
      if (
        configenv.delete_sessao &&
        sessao.value.status === "disconnected" &&
        sessionId
      ) {
        const pastTime = moment.tz(
          sessao.value.lastConnected,
          "America/Sao_Paulo",
        );
        const currentTime = moment.tz("America/Sao_Paulo");

        const diffInHours = currentTime.diff(pastTime, "hours", true);
        const hasPassedFiveHours =
          diffInHours >= parseInt(configenv.temp_delete_sessao);

        if (hasPassedFiveHours) {
          // Sincronizar credenciais antes de limpar
          sessionsToCleanup.push(sessionId);
        }
      }
    }

    for (const sessionId of sessionsToCleanup) {
      logger.info(`🧹 Limpando sessão inativa: ${sessionId}`);

      // await this.deleteSession(sessionId, true);
    }

    if (sessionsToCleanup.length > 0) {
      logger.info(`🧹 ${sessionsToCleanup.length} sessões inativas removidas`);
    }
  }

  // Gerenciar reconexão inteligente com backoff exponencial
  static async handleReconnection(sessionId, lastDisconnect) {
    try {
      let attempts = this.reconnectAttempts.get(sessionId) || 0;
      attempts++;
      this.reconnectAttempts.set(sessionId, attempts);

      const maxAttempts = 8; // Reduzido para evitar loops infinitos
      if (attempts > maxAttempts) {
        logger.error(
          `❌ Máximo de tentativas de reconexão atingido para ${sessionId} (${attempts}/${maxAttempts})`,
        );
        await this.deleteSession(sessionId);
        return;
      }

      // Backoff exponencial: 2^attempts segundos, máximo 2 minutos
      const backoffSeconds = Math.min(Math.pow(2, attempts), 120);
      logger.info(
        `🔄 Tentativa de reconexão ${attempts}/${maxAttempts} para ${sessionId} em ${backoffSeconds}s`,
      );

      // Aguardar antes de reconectar
      await this.delay(backoffSeconds * 1000);

      // Verificar se a sessão ainda existe
      const sessionData = await this.redis.get(`sessao:${sessionId}`);
      if (!sessionData) {
        logger.warn(`⚠️ Sessão ${sessionId} foi removida durante reconexão`);
        return;
      }
      // Tentar reconectar
      await this.createSession(sessionId, sessionData.phoneNumber);
    } catch (error) {
      logger.error(`❌ Erro na reconexão de ${sessionId}:`, error);

      // Se erro crítico, aguardar mais tempo antes da próxima tentativa
      const attempts = this.reconnectAttempts.get(sessionId) || 0;
      if (attempts < 8) {
        setTimeout(async () => {
          await this.handleReconnection(sessionId, lastDisconnect);
        }, 60000); // Aguardar 1 minuto em caso de erro
      } else {
        await this.deleteSession(sessionId);
      }
    }
  }

  // Gerenciar perda de conexão detectada
  static async handleConnectionLoss(sessionId) {
    try {
      logger.warn(`🔌 Perda de conexão detectada para ${sessionId}`);

      const sessionData = await this.redis.get(`sessao:${sessionId}`);
      if (!sessionData) return;

      // Marcar como desconectado
      sessionData.status = "disconnected";
      await this.redis.set(`sessao:${sessionId}`, sessionData);
      await Session.update(sessionId, { status: "disconnected" });

      // Remover socket
      this.sockets.delete(sessionId);

      // Emitir evento de desconexão
      await this.emitEvent(sessionId, "session_disconnected", {
        reason: "Connection timeout - heartbeat lost",
      });

      // Iniciar processo de reconexão
      await this.handleReconnection(sessionId, null);
    } catch (error) {
      logger.error(
        `❌ Erro ao gerenciar perda de conexão ${sessionId}:`,
        error,
      );
    }
  }
}

export default BaileysService;
