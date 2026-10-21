/**
 * ZapoSocket - socket "estilo Baileys" implementado em cima da zapo-js.
 *
 * POR QUE EXISTE?
 * ----------------
 * Toda a API (rotas, serviços, workers, webhooks) foi escrita chamando métodos
 * do socket da Baileys: `sock.sendMessage(...)`, `sock.groupMetadata(...)`,
 * `sock.ev.on(...)`, `sock.user`, `sock.end()` etc.
 * Esta classe expõe EXATAMENTE essa mesma interface, mas por baixo usa a
 * `WaClient` da zapo. Assim:
 *   - nenhum endpoint muda;
 *   - nenhum payload de webhook/WebSocket muda;
 *   - o provider (Baileys ou zapo) é escolhido por variável de ambiente
 *     (WA_PROVIDER), permitindo voltar para a Baileys a qualquer momento.
 *
 * ONDE ESTÁ CADA PARTE?
 * ---------------------
 *   conteudo.js  -> traduz o conteúdo das mensagens (Baileys -> zapo)
 *   eventos.js   -> traduz os eventos (zapo -> Baileys)
 *   store.js     -> armazenamento PostgreSQL da zapo
 *   migrarCredenciais.js -> importa as sessões antigas da Baileys (sem novo QR)
 */
import { EventEmitter } from "node:events";
import { WaClient } from "zapo-js";
import { HttpsProxyAgent } from "https-proxy-agent";
import { ProxyAgent } from "undici";
import config from "../../config/env.js";
import logger from "../../utils/logger.js";
import { criarLoggerZapo } from "./logger.js";
import { converterConteudo } from "./conteudo.js";
import { criarErroConexao, CODIGO_DESCONECTADO, CODIGO_DESLOGADO, MENSAGEM_LOGOUT_INTENCIONAL, ligarEventosZapo, registrarMapaLid } from "./eventos.js";
import { gerarIdMensagem, normalizarJid, paraJsonBaileys, resolverMidia, somenteDigitos } from "./utils.js";

const WS_ABERTO = 1; // WebSocket.OPEN
const WS_FECHADO = 3; // WebSocket.CLOSED
const LIMITE_MENSAGENS_ENVIADAS = 200;

/** Converte a versão do .env ("[2, 3000, 1043914743]") para "2.3000.1043914743". */
function versaoParaTexto(versaoEnv) {
  try {
    const lista = typeof versaoEnv === "string" ? JSON.parse(versaoEnv) : versaoEnv;
    if (Array.isArray(lista) && lista.length >= 3) return lista.join(".");
  } catch {
    // versão inválida no .env: deixa a zapo escolher a padrão
  }
  return undefined;
}

export class ZapoSocket {
  /**
   * @param {object} opcoes
   * @param {string} opcoes.sessionId   apikey da sessão (identifica a sessão no store).
   * @param {object} opcoes.store       store criado em store.js.
   * @param {string} [opcoes.proxyUrl]  ex.: "http://usuario:senha@host:porta".
   */
  constructor({ sessionId, store, proxyUrl }) {
    this.sessionId = sessionId;
    this.store = store;
    this.proxyUrl = proxyUrl;

    /** Identifica o provider para o restante da API. */
    this.ehZapo = true;

    /** Emissor de eventos no estilo da Baileys (`sock.ev.on("messages.upsert", ...)`). */
    this.ev = new EventEmitter();
    this.ev.setMaxListeners(50);

    this.client = null;
    this.conectado = false;
    this.encerrado = false; // end() já foi chamado
    this.fechadoEmitido = false; // evita emitir "close" duas vezes no mesmo ciclo
    this.logoutSolicitado = false; // logout() foi chamado pela API
    this.enviadas = new Map(); // id -> proto enviado (para devolver igual à Baileys)

    // `sock.ws.socket.readyState` é lido por createSession() para saber se está conectado.
    const self = this;
    this.ws = {
      socket: {
        get readyState() {
          return self.conectado ? WS_ABERTO : WS_FECHADO;
        },
      },
    };

    // `sock.authState.creds.registered` é lido pelo fluxo de pareamento por código.
    this.authState = {
      creds: {
        get registered() {
          return Boolean(self.client?.getState?.().registered);
        },
      },
    };
  }

  // ------------------------------------------------------------------ Estado

  /** Dados da conta conectada (equivale a `sock.user` da Baileys). */
  get user() {
    const credenciais = this.client?.getCredentials?.();
    if (!credenciais?.meJid) return undefined;
    return { id: credenciais.meJid, lid: credenciais.meLid, name: credenciais.meDisplayName };
  }

  /** Emite um evento no formato Baileys para quem estiver escutando em `ev`. */
  emitir(nome, dados) {
    try {
      this.ev.emit(nome, dados);
    } catch (erro) {
      logger.error(`Erro em listener do evento ${nome} (sessão ${this.sessionId}): ${erro?.message || erro}`);
    }
  }

  marcarAberto() {
    this.conectado = true;
    this.fechadoEmitido = false;
  }

  /**
   * Emite UM `connection.update` de fechamento por ciclo de conexão
   * (a zapo e o end() podem ambos sinalizar o fechamento).
   */
  emitirFechamento(erro) {
    this.conectado = false;
    if (this.fechadoEmitido) return;
    this.fechadoEmitido = true;
    this.emitir("connection.update", { connection: "close", lastDisconnect: { error: erro, date: new Date() } });
  }

  // --------------------------------------------------------------- Conexão

  /**
   * Cria o WaClient, liga os eventos e inicia a conexão.
   * IMPORTANTE: chamar DEPOIS de registrar os listeners em `ev`
   * (senão o primeiro QR Code pode ser perdido).
   */
  async iniciar() {
    const proxy = this.proxyUrl ? this.#criarProxy(this.proxyUrl) : undefined;
    const guardarHistorico = process.env.ZAPO_STORE_HISTORICO === "true";

    this.client = new WaClient(
      {
        store: this.store,
        sessionId: this.sessionId,
        // Nome que aparece em "Aparelhos conectados" no celular.
        deviceBrowser: config.sessao_phone_name,
        deviceOsDisplayName: config.sessao_phone,
        version: versaoParaTexto(config.versao),
        proxy,
        markOnlineOnConnect: false,
        // Histórico só é útil se a zapo estiver guardando (ZAPO_STORE_HISTORICO).
        history: { enabled: guardarHistorico, requireFullSync: guardarHistorico && config.sync_sessions },
        keepAliveIntervalMs: 10000,
      },
      criarLoggerZapo({ sessionId: this.sessionId }),
    );

    // Guarda o conteúdo que enviamos para devolver o objeto completo (como a Baileys fazia).
    this.client.on("message_send", (evento) => {
      if (!evento?.id) return;
      this.enviadas.set(evento.id, evento.message);
      if (this.enviadas.size > LIMITE_MENSAGENS_ENVIADAS) {
        this.enviadas.delete(this.enviadas.keys().next().value);
      }
    });

    // A zapo só aceita pedir o código de pareamento depois de "auth_pairing_required"
    // (pedir antes dá "companion hello iq failed (400: bad-request)").
    this.pareamentoPronto = new Promise((resolver) => this.client.once("auth_pairing_required", resolver));

    ligarEventosZapo(this);

    this.emitir("connection.update", { connection: "connecting" });

    // connect() só resolve quando a conexão fica pronta (ou, no primeiro pareamento,
    // depois do QR ser lido). Por isso NÃO damos await aqui.
    this.client.connect().catch((erro) => {
      logger.error(`Sessão ${this.sessionId}: falha ao conectar na zapo: ${erro?.message || erro}`);
      if (!this.encerrado) {
        this.emitirFechamento(criarErroConexao(erro?.message || "Falha ao conectar", CODIGO_DESCONECTADO));
      }
    });
  }

  #criarProxy(url) {
    return {
      ws: new HttpsProxyAgent(url),
      mediaUpload: new ProxyAgent(url),
      mediaDownload: new ProxyAgent(url),
      linkPreview: new ProxyAgent(url),
    };
  }

  /** Pareamento por código (alternativa ao QR). Chamar com a conexão aguardando pareamento. */
  async requestPairingCode(numero) {
    const digitos = somenteDigitos(numero);
    // Evita gastar o estado de pareamento (e quebrar o QR) com um número vazio.
    if (digitos.length < 8) throw new Error("Número inválido para pareamento por código");
    // Espera o servidor ficar pronto para o pareamento (no máximo 15s).
    await Promise.race([this.pareamentoPronto, new Promise((resolver) => setTimeout(resolver, 15000))]);
    return this.client.auth.requestPairingCode(digitos);
  }

  /** Encerra a conexão (equivale a `sock.end()`). A API reconecta ao receber o "close". */
  async end(erro) {
    if (this.encerrado) return;
    this.encerrado = true;
    try {
      await this.client?.disconnect();
    } catch {
      // já estava desconectado
    }
    this.emitirFechamento(erro || criarErroConexao("Connection Closed", CODIGO_DESCONECTADO));
    try {
      this.client?.removeAllListeners();
    } catch {
      // ignora
    }
  }

  /** Desvincula o aparelho (equivale a `sock.logout()`). */
  async logout() {
    this.logoutSolicitado = true;
    try {
      await this.client.logout();
    } catch (erro) {
      logger.warn(`Sessão ${this.sessionId}: erro ao fazer logout na zapo: ${erro?.message || erro}`);
      this.emitirFechamento(criarErroConexao(MENSAGEM_LOGOUT_INTENCIONAL, CODIGO_DESLOGADO));
    }
  }

  #garantirConectado() {
    if (!this.client) throw new Error("Sessão não iniciada");
  }

  // --------------------------------------------------------------- Mensagens

  /**
   * Envia uma mensagem (mesma assinatura da Baileys).
   * Retorna um objeto no formato WAMessage da Baileys.
   */
  async sendMessage(jid, conteudoBaileys, extras = {}) {
    this.#garantirConectado();
    const destino = jid === "status@broadcast" ? jid : normalizarJid(jid);

    const { conteudo, opcoes } = await converterConteudo(destino, conteudoBaileys, extras);
    const id = gerarIdMensagem();
    opcoes.id = id;

    let resultado;
    if (destino === "status@broadcast") {
      resultado = await this.client.status.send({
        content: conteudo,
        recipients: (extras.statusJidList || []).map(normalizarJid),
        options: opcoes,
      });
    } else {
      resultado = await this.client.message.send(destino, conteudo, opcoes);
    }

    return this.#montarMensagemEnviada(destino, resultado?.id || id, conteudo);
  }

  /**
   * Envia uma mensagem já em formato proto (usado por listas/botões).
   * Os "nós biz" extras (`additionalNodes`) são ignorados porque a zapo monta
   * a estrutura correta sozinha para listas, botões e fluxos nativos.
   */
  async relayMessage(jid, mensagemProto, { messageId } = {}) {
    this.#garantirConectado();
    const destino = normalizarJid(jid);
    const id = messageId || gerarIdMensagem();
    const resultado = await this.client.message.send(destino, mensagemProto, { id });
    const mensagem = this.#montarMensagemEnviada(destino, resultado?.id || id, mensagemProto);
    return mensagem.key.id;
  }

  /** Monta o objeto retornado ao enviar e emite o evento "append" (emitOwnEvents). */
  #montarMensagemEnviada(destino, id, conteudoEnviado) {
    const protoEnviado = this.enviadas.get(id) ?? (conteudoEnviado?.type ? undefined : conteudoEnviado);
    this.enviadas.delete(id);

    const mensagem = paraJsonBaileys({
      key: { remoteJid: destino, fromMe: true, id },
      message: protoEnviado ?? (conteudoEnviado?.type === "text" ? { conversation: conteudoEnviado.text } : undefined),
      messageTimestamp: Math.floor(Date.now() / 1000),
      status: 1,
    });

    if (mensagem.message) {
      this.emitir("messages.upsert", { messages: [mensagem], type: "append" });
    }
    return mensagem;
  }

  /**
   * Prepara uma mídia (upload) para ser usada dentro de botões/carrossel.
   * Substitui `prepareWAMessageMedia(..., { upload: sock.waUploadToServer })` da Baileys.
   * @param {object} conteudo  ex.: { image: <buffer|{url}>, caption } ou { video }, { document, mimetype, fileName }
   */
  async prepararMidiaZapo(conteudo) {
    this.#garantirConectado();
    let tipo;
    if (conteudo.image) tipo = "image";
    else if (conteudo.video) tipo = "video";
    else if (conteudo.document) tipo = "document";
    else throw new Error("Tipo de mídia não suportado para botões");

    const padrao = { image: "image/jpeg", video: "video/mp4", document: "application/octet-stream" };
    const { message } = await this.client.status.buildMessageContent({
      type: tipo,
      media: await resolverMidia(conteudo[tipo]),
      mimetype: conteudo.mimetype || padrao[tipo],
      caption: conteudo.caption || undefined,
      fileName: tipo === "document" ? conteudo.fileName : undefined,
    });
    return message;
  }

  /** Marca mensagens como lidas. `chaves` = [{ remoteJid, id, participant? }]. */
  async readMessages(chaves) {
    this.#garantirConectado();
    // Agrupa por conversa/participante, pois cada recibo é por chat.
    const grupos = new Map();
    for (const chave of chaves) {
      if (!chave?.remoteJid || !chave?.id) continue;
      const indice = `${chave.remoteJid}|${chave.participant || ""}`;
      if (!grupos.has(indice)) grupos.set(indice, { jid: chave.remoteJid, participant: chave.participant, ids: [] });
      grupos.get(indice).ids.push(chave.id);
    }
    for (const { jid, participant, ids } of grupos.values()) {
      await this.client.message.sendReceipt(jid, ids, { type: "read", participant });
    }
    return true;
  }

  // ---------------------------------------------------------------- Presença

  /**
   * "composing" | "recording" | "paused" (com jid) ou "available" | "unavailable" (sem jid).
   * Erros são engolidos de propósito: presença é cosmético e várias rotas chamam
   * sem `await`, então uma rejeição derrubaria o processo.
   */
  async sendPresenceUpdate(tipo, jid) {
    try {
      this.#garantirConectado();
      if (!jid || tipo === "available" || tipo === "unavailable") {
        return await this.client.presence.send(tipo === "unavailable" ? "unavailable" : "available");
      }
      if (tipo === "recording") {
        return await this.client.presence.sendChatstate(jid, { state: "composing", media: "audio" });
      }
      return await this.client.presence.sendChatstate(jid, { state: tipo === "composing" ? "composing" : "paused" });
    } catch (erro) {
      logger.debug(`Sessão ${this.sessionId}: presença "${tipo}" não enviada: ${erro?.message || erro}`);
    }
  }

  // ---------------------------------------------------------------- Contatos

  /** URL da foto de perfil. `tipo`: "image" (alta resolução) ou "preview". */
  async profilePictureUrl(jid, tipo = "preview") {
    this.#garantirConectado();
    const resultado = await this.client.profile.getProfilePicture(normalizarJid(jid), tipo === "image" ? "image" : "preview");
    return resultado?.url;
  }

  /** Verifica se números existem no WhatsApp. Retorna [{ jid, exists, lid }]. */
  async onWhatsApp(...numeros) {
    this.#garantirConectado();
    const digitos = numeros.flat().map(somenteDigitos).filter(Boolean);
    if (digitos.length === 0) return [];
    const resultados = await this.client.profile.getLidsByPhoneNumbers(digitos);
    return resultados.map((r) => {
      if (r.lidJid && r.phoneJid) registrarMapaLid(this.sessionId, r.lidJid, r.phoneJid);
      return { jid: r.phoneJid || r.queriedJid, exists: r.exists, lid: r.lidJid || undefined };
    });
  }

  /** Bloqueia/desbloqueia um contato. `acao`: "block" | "unblock". */
  async updateBlockStatus(jid, acao) {
    this.#garantirConectado();
    if (acao === "block") await this.client.privacy.blockUser(jid);
    else await this.client.privacy.unblockUser(jid);
  }

  /**
   * Rejeita uma chamada recebida. A zapo só RECEBE sinalização de chamada
   * (o plugin de VoIP é separado), então enviamos o nó `<call><reject/></call>` na mão,
   * da mesma forma que a Baileys faz.
   */
  async rejectCall(idChamada, deQuem) {
    this.#garantirConectado();
    const eu = this.user?.id ? normalizarJid(this.user.id) : undefined;
    await this.client.lowlevel.sendNode({
      tag: "call",
      attrs: { from: eu, to: deQuem, id: gerarIdMensagem() },
      content: [{ tag: "reject", attrs: { "call-id": idChamada, "call-creator": deQuem, count: "0" } }],
    });
  }

  // ------------------------------------------------------------------ Grupos

  /** Converte os metadados do grupo da zapo para o formato da Baileys. */
  #metadadosGrupo(g) {
    return paraJsonBaileys({
      id: g.jid,
      subject: g.subject,
      subjectOwner: g.subjectOwner,
      subjectTime: g.subjectTime,
      size: g.size ?? g.participants?.length,
      creation: g.creation,
      owner: g.owner,
      ownerPn: g.ownerPhoneNumber,
      desc: g.desc,
      descId: g.descId,
      descOwner: g.descOwner,
      descTime: g.descTime,
      restrict: g.restrict,
      announce: g.announce,
      isCommunity: g.isParentGroup,
      isCommunityAnnounce: g.generalSubgroup,
      joinApprovalMode: g.membershipApprovalEnabled,
      ephemeralDuration: g.ephemeral,
      addressingMode: g.addressingMode,
      participants: (g.participants || []).map((p) => ({
        id: p.jid,
        lid: p.lid,
        phoneNumber: p.phoneNumber,
        admin: p.isSuperAdmin ? "superadmin" : p.isAdmin ? "admin" : null,
      })),
    });
  }

  async groupMetadata(jid) {
    this.#garantirConectado();
    return this.#metadadosGrupo(await this.client.group.queryGroupMetadata(jid));
  }

  /** Retorna um objeto { [jid]: metadados }, como a Baileys. */
  async groupFetchAllParticipating() {
    this.#garantirConectado();
    const lista = await this.client.group.queryAllGroups();
    return Object.fromEntries(lista.map((g) => [g.jid, this.#metadadosGrupo(g)]));
  }

  async groupCreate(assunto, participantes) {
    this.#garantirConectado();
    return this.#metadadosGrupo(await this.client.group.createGroup(assunto, participantes.map(normalizarJid)));
  }

  async groupUpdateSubject(jid, assunto) {
    this.#garantirConectado();
    await this.client.group.setSubject(jid, assunto);
  }

  async groupUpdateDescription(jid, descricao) {
    this.#garantirConectado();
    await this.client.group.setDescription(jid, descricao || null);
  }

  /** `acao`: "add" | "remove" | "promote" | "demote". Retorna [{ status, jid }]. */
  async groupParticipantsUpdate(jid, participantes, acao) {
    this.#garantirConectado();
    const lista = participantes.map(normalizarJid);
    const metodos = {
      add: "addParticipants",
      remove: "removeParticipants",
      promote: "promoteParticipants",
      demote: "demoteParticipants",
    };
    const metodo = metodos[acao];
    if (!metodo) throw new Error(`Ação de participante inválida: ${acao}`);
    const resultados = await this.client.group[metodo](jid, lista);
    return resultados.map((r) => ({ status: String(r.code), jid: r.jid }));
  }

  async groupLeave(jid) {
    this.#garantirConectado();
    await this.client.group.leaveGroup([jid]);
  }

  /** `configuracao`: "announcement" | "not_announcement" | "locked" | "unlocked". */
  async groupSettingUpdate(jid, configuracao) {
    this.#garantirConectado();
    const mapa = {
      announcement: ["announcement", true],
      not_announcement: ["announcement", false],
      locked: ["restrict", true],
      unlocked: ["restrict", false],
    };
    const item = mapa[configuracao];
    if (!item) throw new Error(`Configuração de grupo inválida: ${configuracao}`);
    await this.client.group.setSetting(jid, item[0], item[1]);
  }

  async groupInviteCode(jid) {
    this.#garantirConectado();
    return this.client.group.queryInviteCode(jid);
  }

  async groupRevokeInvite(jid) {
    this.#garantirConectado();
    const resultado = await this.client.group.revokeInvite(jid);
    return resultado?.code ?? resultado;
  }
}
