import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  proto,
  decryptPollVote,
  makeCacheableSignalKeyStore,
  jidNormalizedUser,
  getKeyAuthor,
} from "@whiskeysockets/baileys";

import redis, { KEYS } from "./redis.js"
import logger from "../utils/logger.js";
import usePostgresAuthState from "./usePostgresAuthStore.js";
import config from "../config/env.js";
import Session from "../models/Session.js";
import pLimit from 'p-limit';
import { release } from "os";
import pino from "pino";
import { eventBaileys } from "./EventService.js";
import { HttpsProxyAgent } from "https-proxy-agent";


class BaileysService {
  constructor() {
    this.WebSocketService = null;
    this.healthCheckInterval = null;
    this.keepAliveInterval = null;
    this.sessionMonitors = new Map();

  }
  static keys = KEYS();
  static sockets = new Map();
  static countQrcode = new Map();
  static limitReconnect = new Map();
  static redis = redis;

  //Serviço de WebSocket
  static SetWebSocketService(service) {
    this.WebSocketService = service;
  }

  //Iniciar bots
  static async initialize() {
    const getsessoes = await Session.findAllSessao()
    logger.info(`Iniciando ${getsessoes.length} Sessões..`)

    const limit = pLimit(15);
    await Promise.allSettled(getsessoes.map(s => limit(() => this.createSession(s.apikey, null))));
    logger.info('Todos os bots foram iniciados')
  }

  static async salvarSessao(SessionId, dados) {
    logger.info(`Salvando sessão ${SessionId} no redis`)
    this.redis.set(this.keys.sessao(SessionId), dados)
  }

  static async GetSessao(SessionId) {
    logger.info(`Buscando sessão ${SessionId} no redis`)
    return this.redis.get(this.keys.sessao(SessionId))
  }

  static async DeleteSessao(SessionId) {
    logger.info(`Deletando sessão ${SessionId} no redis`)
    this.redis.del(this.keys.sessao(SessionId))
  }

  static toBuffer = (value) => {
    if (!value) return value;
    return Buffer.isBuffer(value) ? value : Buffer.from(value, "base64");
  };

  static async createSession(sessionId, phoneNumber) {
    try {

      const getsessao = await Session.findById(sessionId);
      if (!getsessao) {
        return {
          success: false,
          message: "Sessão não encontrada no banco de dados",
        };
      }

      const sockAtual = this.sockets.get(sessionId)
      if (sockAtual) {
        if (sockAtual?.ws?.socket?.readyState === WebSocket.OPEN && getsessao.status === "connected") {
          return {
            success: false,
            message: "Sessão já conectada",
          };
        }
      }

      if (phoneNumber) {
        getsessao.numero = phoneNumber;
      }

      await this.salvarSessao(sessionId, getsessao)

      // Provider zapo (WA_PROVIDER=zapo): usa o ZapoSocket, que imita o socket da Baileys.
      if (config.waProvider === "zapo") {
        return await this.createSessionZapo(sessionId);
      }

      const { state, saveCreds } = await usePostgresAuthState(sessionId);
      state.creds.noiseKey = {
        private: this.toBuffer(state.creds.noiseKey.private),
        public: this.toBuffer(state.creds.noiseKey.public)
      };

      state.creds.signedIdentityKey = {
        private: this.toBuffer(state.creds.signedIdentityKey.private),
        public: this.toBuffer(state.creds.signedIdentityKey.public)
      };

      state.creds.signedPreKey = {
        ...state.creds.signedPreKey,
        keyPair: {
          private: this.toBuffer(state.creds.signedPreKey.keyPair.private),
          public: this.toBuffer(state.creds.signedPreKey.keyPair.public)
        }
      };
      const { version, isLatest } = await fetchLatestBaileysVersion();
      logger.info(`using WA v${version.join(".")}, isLatest: ${isLatest}`);


      let browserOptions = {};
      let number = false;

      const browser = [config.sessao_phone, config.sessao_phone_name, release()];
      if (!phoneNumber) {
        browserOptions = { browser };
      }


      const configs = {
        version: JSON.parse(config.versao),
        logger: pino({ level: config.baileysLogLevel || "info" }),
        ...browserOptions,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        syncFullHistory: config.sync_sessions,
        markOnlineOnConnect: false,
        fireInitQueries: true,
        emitOwnEvents: true,
        msgRetryCounterCache: this.msgRetryCounterCache,
        linkPreviewImageThumbnailWidth: 192,
        generateHighQualityLinkPreview: true,
        defaultQueryTimeoutMs: undefined,
        retryRequestDelayMs: 1000,
        maxMsgRetryCount: 3,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 10000,
        qrTimeout: 45000,
        getMessage: (key) => { },
      };

      // Configurações de proxy individuais por sessão (sobrescreve configurações globais)
      const exists = await Session.getProxy(sessionId);
      if (exists?.active) {
        try {
          const agent = new HttpsProxyAgent(`http://${exists.username}:${exists.password}@${exists.host}:${exists.port}`);
          configs.agent = agent;
          logger.info(`Instacia ${sessionId} 🛰️ Usando proxy ${exists.host}:${exists.port}`);
        } catch (err) {
          logger.error("❌ Erro ao criar ProxyAgent:", err);
          configs.agent = undefined; // fallback sem proxy
        }
      }

      // Configurações de proxy globais (aplicadas apenas se a sessão não tiver proxy individual ativo)
      if (config.proxy_state === "true" && (!exists?.active || exists.active !== true)) {
        try {
          const agent = new HttpsProxyAgent(
            `${config.proxy_protocol}://${config.proxy_usename}:${config.proxy_password}@${config.proxy_host}:${config.proxy_port}`,
          );
          logger.info(`Instacia ${sessionId} 🛰️ Usando proxy ${config.proxy_host}:${config.proxy_port}`);
          configs.agent = agent;
        } catch (err) {
          logger.error("❌ Erro ao criar ProxyAgent:", err);
          configs.agent = undefined; // fallback sem proxy
        }
      }

      const sock = makeWASocket(configs);
      this.sockets.set(sessionId, sock);

      // Event handlers

      eventBaileys(sock, sessionId, saveCreds);

      return { success: true };
    } catch (error) {
      logger.error(`❌ Erro ao criar sessão ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Desligamento limpo: no provider zapo, desconecta todas as sessões para a
   * zapo gravar no banco as chaves que ainda estão em memória (write-behind).
   * No modo Baileys não faz nada (comportamento anterior preservado).
   */
  static async encerrarTodas(timeoutMs = 10000) {
    if (config.waProvider !== "zapo") return;
    const desligar = Promise.allSettled([...this.sockets.values()].map((sock) => sock.client?.disconnect?.()));
    await Promise.race([desligar, this.delay(timeoutMs)]);
    try {
      const { encerrarStoreZapo } = await import("../providers/zapo/store.js");
      await encerrarStoreZapo();
    } catch {
      // ignora erros no desligamento
    }
  }

  //Retorna o socket de uma sessão (usado pela rota de avatar)
  static getSocket(sessionId) {
    return this.sockets.get(sessionId);
  }

  /**
   * Monta a URL do proxy da sessão (individual tem prioridade sobre o global).
   * Retorna undefined quando a sessão não usa proxy.
   */
  static async resolverProxyUrl(sessionId) {
    const proxySessao = await Session.getProxy(sessionId);
    if (proxySessao?.active) {
      return `http://${proxySessao.username}:${proxySessao.password}@${proxySessao.host}:${proxySessao.port}`;
    }
    if (config.proxy_state === "true") {
      return `${config.proxy_protocol}://${config.proxy_usename}:${config.proxy_password}@${config.proxy_host}:${config.proxy_port}`;
    }
    return undefined;
  }

  /**
   * Cria a sessão usando a zapo-js em vez da Baileys.
   * O socket retornado (ZapoSocket) tem a mesma interface do socket da Baileys,
   * então EventService, rotas e serviços funcionam sem alterações.
   * Os módulos da zapo são carregados sob demanda para que o modo Baileys
   * continue funcionando mesmo sem a zapo instalada.
   */
  static async createSessionZapo(sessionId) {
    const { ZapoSocket } = await import("../providers/zapo/ZapoSocket.js");
    const { obterStoreZapo } = await import("../providers/zapo/store.js");
    const { importarSessaoBaileys } = await import("../providers/zapo/migrarCredenciais.js");

    const store = obterStoreZapo();

    // Sessão antiga da Baileys? Importa as credenciais para não pedir novo QR.
    try {
      const importacao = await importarSessaoBaileys(sessionId, store);
      if (importacao.importado) logger.info(`Sessão ${sessionId}: credenciais da Baileys importadas para a zapo`);
    } catch (erro) {
      logger.error(`Sessão ${sessionId}: falha ao importar credenciais da Baileys (será gerado novo QR): ${erro?.message || erro}`);
    }

    const proxyUrl = await this.resolverProxyUrl(sessionId);
    if (proxyUrl) logger.info(`Instacia ${sessionId} 🛰️ Usando proxy`);

    const sock = new ZapoSocket({ sessionId, store, proxyUrl });
    this.sockets.set(sessionId, sock);

    // Primeiro registra os listeners, depois conecta (senão o 1º QR pode se perder).
    // A zapo grava as credenciais sozinha, por isso o saveCreds é vazio.
    await eventBaileys(sock, sessionId, async () => { });
    await sock.iniciar();

    return { success: true };
  }

  // Função genérica para salvar dados em lotes
  static logjson(data, sessionId, nameArquivo = "session_data") {
    try {
      const logsDir = path.join(__dirname, "..", "logs");

      // Cria a pasta se não existir
      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
      }

      const filePath = path.join(logsDir, `${nameArquivo}_${sessionId}.json`);

      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (error) {
      console.log("Erro ao salvar JSON:", error);
    }
  }

  static delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

}

export default BaileysService;
