/**
 * WhatsAppService - gerencia as sessões de WhatsApp da API (uma por apikey).
 *
 * Usa a zapo-js através da classe SessaoWhatsApp (src/whatsapp/), que expõe
 * os métodos que as rotas e serviços utilizam (sendMessage, group*, ev.on...).
 */
import redis, { KEYS } from "./redis.js";
import logger from "../utils/logger.js";
import Session from "../models/Session.js";
import pLimit from "p-limit";
import { registrarEventos } from "./EventService.js";
import { SessaoWhatsApp } from "../whatsapp/SessaoWhatsApp.js";
import { obterStoreZapo, encerrarStoreZapo } from "../whatsapp/store.js";
import config from "../config/env.js";

class WhatsAppService {
  constructor() {
    this.WebSocketService = null;
  }

  static keys = KEYS();
  /** Sessões ativas: apikey -> SessaoWhatsApp */
  static sockets = new Map();
  /** Quantidade de QR Codes gerados por sessão (limite: LIMITE_QRCODE) */
  static countQrcode = new Map();
  /** Quantidade de eventos de conexão por sessão (proteção contra loop de reconexão) */
  static limitReconnect = new Map();
  static redis = redis;

  //Serviço de WebSocket
  static SetWebSocketService(service) {
    this.WebSocketService = service;
  }

  //Iniciar todas as sessões cadastradas (15 por vez)
  static async initialize() {
    const sessoes = await Session.findAllSessao();
    logger.info(`Iniciando ${sessoes.length} Sessões..`);

    const limite = pLimit(15);
    await Promise.allSettled(sessoes.map((s) => limite(() => this.createSession(s.apikey, null))));
    logger.info("Todas as sessões foram iniciadas");
  }

  // ---------------------------------------------------------------- Cache da sessão (Redis)

  static async salvarSessao(sessionId, dados) {
    logger.info(`Salvando sessão ${sessionId} no redis`);
    this.redis.set(this.keys.sessao(sessionId), dados);
  }

  static async GetSessao(sessionId) {
    logger.info(`Buscando sessão ${sessionId} no redis`);
    return this.redis.get(this.keys.sessao(sessionId));
  }

  static async DeleteSessao(sessionId) {
    logger.info(`Deletando sessão ${sessionId} no redis`);
    this.redis.del(this.keys.sessao(sessionId));
  }

  // ---------------------------------------------------------------- Sessões

  /**
   * Cria (ou recria) a conexão de uma sessão.
   * @param {string} sessionId    apikey da sessão.
   * @param {string|null} phoneNumber  se informado, o pareamento é feito por código em vez de QR.
   */
  static async createSession(sessionId, phoneNumber) {
    try {
      const getsessao = await Session.findById(sessionId);
      if (!getsessao) {
        return { success: false, message: "Sessão não encontrada no banco de dados" };
      }

      const sockAtual = this.sockets.get(sessionId);
      if (sockAtual?.ws?.socket?.readyState === WebSocket.OPEN && getsessao.status === "connected") {
        return { success: false, message: "Sessão já conectada" };
      }

      if (phoneNumber) {
        getsessao.numero = phoneNumber;
      }
      await this.salvarSessao(sessionId, getsessao);

      const proxyUrl = await this.resolverProxyUrl(sessionId);
      if (proxyUrl) logger.info(`Instacia ${sessionId} 🛰️ Usando proxy`);

      const sock = new SessaoWhatsApp({ sessionId, store: obterStoreZapo(), proxyUrl });
      this.sockets.set(sessionId, sock);

      // Primeiro registra os listeners, depois conecta (senão o 1º QR pode se perder).
      await registrarEventos(sock, sessionId);
      await sock.iniciar();

      return { success: true };
    } catch (error) {
      logger.error(`❌ Erro ao criar sessão ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Monta a URL do proxy da sessão (o proxy individual tem prioridade sobre o global).
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

  //Retorna o socket de uma sessão
  static getSocket(sessionId) {
    return this.sockets.get(sessionId);
  }

  /**
   * Desligamento limpo: desconecta todas as sessões para a zapo gravar no banco
   * as chaves que ainda estão em memória (write-behind) e fecha o pool do store.
   */
  static async encerrarTodas(timeoutMs = 10000) {
    const desligar = Promise.allSettled([...this.sockets.values()].map((sock) => sock.client?.disconnect?.()));
    await Promise.race([desligar, this.delay(timeoutMs)]);
    await encerrarStoreZapo();
  }

  static delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default WhatsAppService;
