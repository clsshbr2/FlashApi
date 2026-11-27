/**
 * SessaoWhatsApp - uma conexão de WhatsApp (uma sessão da API) sobre a zapo-js.
 *
 * Envolve o `WaClient` da zapo e expõe os métodos que rotas, serviços e workers
 * usam (`sendMessage`, `group*`, `readMessages`, `ev.on(...)`, `user`, `end`, `logout`...).
 * Os nomes dos métodos e eventos são os que a API sempre usou, para NÃO alterar
 * nenhum endpoint nem o formato dos webhooks/WebSocket que os sistemas já consomem.
 *
 * Arquivos desta pasta:
 *   conteudo.js  -> traduz o conteúdo das mensagens (requisição -> zapo)
 *   eventos.js   -> traduz os eventos da zapo para o formato publicado pela API
 *   store.js     -> armazenamento PostgreSQL da zapo
 *   importarCredenciais.js -> importa a sessão enviada pela extensão do navegador
 */
import { EventEmitter } from "node:events";
import { WaClient } from "zapo-js";
import { HttpsProxyAgent } from "https-proxy-agent";
import { ProxyAgent } from "undici";
import config from "../config/env.js";
import logger from "../utils/logger.js";
import { criarLoggerZapo } from "./utils.js";
import { iniciarLimpezaStore, pararLimpezaStore } from "./store.js";
import { converterConteudo } from "./conteudo.js";
import { criarErroConexao, CODIGO_DESCONECTADO, CODIGO_DESLOGADO, MENSAGEM_LOGOUT_INTENCIONAL, ligarEventosZapo, registrarMapaLid } from "./eventos.js";
import { base64ParaBinario, desembrulharMensagem, extrairMidia, gerarIdMensagem, normalizarJid, paraJsonApi, resolverMidia, somenteDigitos } from "./utils.js";
import { criarPluginVoip, GerenciadorChamadas } from "./chamadas.js";

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

export class SessaoWhatsApp {
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

    /** Emissor dos eventos da API (`sock.ev.on("messages.upsert", ...)`). */
    this.ev = new EventEmitter();
    this.ev.setMaxListeners(50);

    this.client = null;
    this.conectado = false;
    this.encerrado = false; // end() já foi chamado
    this.fechadoEmitido = false; // evita emitir "close" duas vezes no mesmo ciclo
    this.logoutSolicitado = false; // logout() foi chamado pela API
    this.enviadas = new Map(); // id -> proto enviado (para devolver a mensagem completa ao enviar)
    this.chamadas = null; // GerenciadorChamadas, só com ENABLE_CALLS=true

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

  /** Dados da conta conectada (`sock.user`). */
  get user() {
    const credenciais = this.client?.getCredentials?.();
    if (!credenciais?.meJid) return undefined;
    return { id: credenciais.meJid, lid: credenciais.meLid, name: credenciais.meDisplayName };
  }

  /** Emite um evento (no formato publicado pela API) para quem escuta em `ev`. */
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
    // Chamadas de voz: o plugin só é carregado quando habilitado (ENABLE_CALLS=true)
    const plugins = config.enableCalls ? [await criarPluginVoip()] : [];

    this.client = new WaClient(
      {
        store: this.store,
        sessionId: this.sessionId,
        // Nome que aparece em "Aparelhos conectados" no celular.
        deviceBrowser: config.sessao_phone_name,
        // No pareamento por código o WhatsApp valida o nome do aparelho ("Chrome (SO)"): um SO inventado
        // pode fazer a notificação não aparecer no celular. Nesse caso usa o SO real (padrão da zapo).
        deviceOsDisplayName: this.numeroParaCodigo ? undefined : config.sessao_phone,
        version: versaoParaTexto(config.versao),
        proxy,
        markOnlineOnConnect: false,
        // A zapo guarda mensagens, chats e contatos sozinha; o histórico completo vem se SYNC_SESSIONS=true.
        history: { enabled: true, requireFullSync: config.sync_sessions },
        keepAliveIntervalMs: 10000,
        plugins,
      },
      criarLoggerZapo({ sessionId: this.sessionId }),
    );

    // Guarda o conteúdo que enviamos para devolver o objeto completo (a API sempre devolveu o objeto completo).
    this.client.on("message_send", (evento) => {
      if (!evento?.id) return;
      this.enviadas.set(evento.id, evento.message);
      if (this.enviadas.size > LIMITE_MENSAGENS_ENVIADAS) {
        this.enviadas.delete(this.enviadas.keys().next().value);
      }
    });

    ligarEventosZapo(this);
    if (this.client.voip) {
      this.chamadas = new GerenciadorChamadas(this);
      this.chamadas.ligarEventos();
    }
    iniciarLimpezaStore(this.sessionId);

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

  /**
   * Pareamento por código (alternativa ao QR). Chamar quando o 1º QR chegar (`connection.update` com `qr`):
   * é o sinal de que o servidor está pronto. "auth_pairing_required" NÃO serve de sinal: a zapo só o emite
   * depois que o código já foi pedido (renovação), então esperar por ele só atrasa o código.
   */
  async requestPairingCode(numero) {
    const digitos = somenteDigitos(numero);
    // Evita gastar o estado de pareamento (e quebrar o QR) com um número vazio.
    if (digitos.length < 8) throw new Error("Número inválido para pareamento por código");
    return this.client.auth.requestPairingCode(digitos);
  }

  /** Encerra a conexão (equivale a `sock.end()`). A API reconecta ao receber o "close". */
  async end(erro) {
    if (this.encerrado) return;
    this.encerrado = true;
    pararLimpezaStore(this.sessionId);
    this.chamadas?.limparTudo();
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
   * Envia uma mensagem a partir do corpo da requisição (text, image, audio, poll...).
   * Retorna { key, message, messageTimestamp, status }.
   */
  async sendMessage(jid, conteudoRequisicao, extras = {}) {
    this.#garantirConectado();
    const destino = jid === "status@broadcast" ? jid : normalizarJid(jid);

    const { conteudo, opcoes } = await converterConteudo(destino, conteudoRequisicao, extras);
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
   * Envia uma mensagem já em formato proto (usado por listas/botões). Retorna o id.
   * A zapo monta sozinha os "nós biz" necessários para listas, botões e fluxos nativos.
   */
  async enviarProto(jid, mensagemProto, { id: idPersonalizado } = {}) {
    this.#garantirConectado();
    const destino = normalizarJid(jid);
    const id = idPersonalizado || gerarIdMensagem();
    const resultado = await this.client.message.send(destino, mensagemProto, { id });
    const mensagem = this.#montarMensagemEnviada(destino, resultado?.id || id, mensagemProto);
    return mensagem;
  }

  /** Monta o objeto retornado ao enviar e emite o evento "append" (emitOwnEvents). */
  #montarMensagemEnviada(destino, id, conteudoEnviado) {
    const protoEnviado = this.enviadas.get(id) ?? (conteudoEnviado?.type ? undefined : conteudoEnviado);
    this.enviadas.delete(id);

    const mensagem = paraJsonApi({
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
   *    * @param {object} conteudo  ex.: { image: <buffer|{url}>, caption } ou { video }, { document, mimetype, fileName }
   */
  async prepararMidia(conteudo) {
    this.#garantirConectado();
    let tipo;
    if (conteudo.image) tipo = "image";
    else if (conteudo.video) tipo = "video";
    else if (conteudo.document) tipo = "document";
    else throw new Error("Tipo de mídia não suportado para botões");

    const padrao = { image: "image/jpeg", video: "video/mp4", document: "application/octet-stream" };
    const mimetype = conteudo.mimetype || padrao[tipo];

    // Envia o arquivo (cifrado) para o CDN do WhatsApp e monta o submessage com os dados do upload.
    const envio = await this.client.message.upload(await resolverMidia(conteudo[tipo]), { type: tipo, mimetype });
    const submensagem = {
      url: envio.url,
      directPath: envio.directPath,
      mediaKey: envio.mediaKey,
      fileSha256: envio.fileSha256,
      fileEncSha256: envio.fileEncSha256,
      fileLength: envio.fileLength,
      mediaKeyTimestamp: envio.mediaKeyTimestamp,
      mimetype,
      caption: conteudo.caption || undefined,
    };
    if (envio.streamingSidecar) submensagem.streamingSidecar = envio.streamingSidecar;
    if (tipo === "video" && envio.metadataUrl) submensagem.metadataUrl = envio.metadataUrl;
    if (tipo === "document") submensagem.fileName = conteudo.fileName || "documento";

    return { [`${tipo}Message`]: submensagem };
  }

  /**
   * Baixa e decifra a mídia de uma mensagem recebida (conteúdo no formato dos
   * webhooks: chaves e hashes em base64). Retorna um Buffer.
   * @param {object} mensagem  ex.: { imageMessage: { url, mediaKey, ... } }
   */
  /**
   * Edita o texto de uma mensagem que ESTA conta enviou (o WhatsApp aceita até ~15 minutos após o envio).
   * Mensagens com mídia: o texto novo vira a legenda.
   */
  async editarMensagem(jid, idMensagem, texto) {
    this.#garantirConectado();
    const resultado = await this.client.message.send(normalizarJid(jid), texto, { editKey: { id: idMensagem } });
    return { id: resultado?.id, editedId: idMensagem };
  }

  async baixarMidia(mensagem) {
    this.#garantirConectado();
    const bytes = await this.client.message.downloadBytes(base64ParaBinario(mensagem));
    return Buffer.from(bytes);
  }

  /**
   * Abre a mídia de uma mensagem como stream (já decifrada), sem carregar o arquivo inteiro na memória.
   * Quem chama é dono do stream: precisa consumir (pipe) ou destruir.
   */
  async abrirMidia(mensagem, { chave, timeoutMs = 60000 } = {}) {
    this.#garantirConectado();
    const conteudo = base64ParaBinario(mensagem);
    try {
      return await this.client.message.download(conteudo, { timeoutMs });
    } catch (erro) {
      // Mídia antiga some do servidor do WhatsApp. Com a chave da mensagem, pede ao aparelho
      // que enviou para subir o arquivo de novo e tenta outra vez com o caminho novo.
      const info = extrairMidia(conteudo);
      const midia = info && desembrulharMensagem(conteudo)[info.chave];
      if (!chave?.id || !chave?.remoteJid || !midia?.mediaKey) throw erro;

      const reenvio = await this.client.message.requestMediaReupload({
        messageId: chave.id,
        chatJid: chave.remoteJid,
        fromMe: Boolean(chave.fromMe),
        participant: chave.participant || undefined,
        mediaKey: midia.mediaKey,
        timeoutMs: 30000,
      });
      if (reenvio.result !== "success" || !reenvio.directPath) {
        const motivo = reenvio.result === "not_found" ? "o arquivo não existe mais no aparelho de origem" : reenvio.result;
        throw Object.assign(new Error(`Mídia indisponível: ${motivo}`), { midiaIndisponivel: true });
      }
      midia.directPath = reenvio.directPath;
      delete midia.url; // a URL antiga aponta para o arquivo expirado
      return this.client.message.download(conteudo, { timeoutMs });
    }
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
    // Algumas respostas trazem só o caminho (directPath) e não a URL completa.
    if (resultado?.url) return resultado.url;
    if (resultado?.directPath) return `https://pps.whatsapp.net${resultado.directPath}`;
    return undefined;
  }

  // ------------------------------------------------------ Perfil da conta conectada

  /** Troca a foto da conta (ou de um grupo, se `jid` for informado e a conta for admin). `jpeg` já quadrado. */
  async updateProfilePicture(jpeg, jid) {
    this.#garantirConectado();
    return this.client.profile.setProfilePicture(jpeg, jid ? normalizarJid(jid) : undefined);
  }

  async removeProfilePicture(jid) {
    this.#garantirConectado();
    await this.client.profile.deleteProfilePicture(jid ? normalizarJid(jid) : undefined);
  }

  /** Nome exibido para os outros usuários (pushName). */
  async updateProfileName(nome) {
    this.#garantirConectado();
    await this.client.profile.setPushName(nome);
  }

  /** Recado ("About") da conta. */
  async updateProfileStatus(texto) {
    this.#garantirConectado();
    await this.client.profile.setStatus(texto);
  }

  /** Recado ("About") de um contato; null quando oculto pela privacidade. */
  async fetchStatus(jid) {
    this.#garantirConectado();
    return this.client.profile.getAboutStatus(normalizarJid(jid));
  }

  async getOwnUsername() {
    this.#garantirConectado();
    return this.client.profile.getOwnUsername();
  }

  async checkUsername(username) {
    this.#garantirConectado();
    return this.client.profile.checkUsernameAvailability(username);
  }

  /** Retorna true só quando o servidor aceitou (nome livre e válido). */
  async setUsername(username) {
    this.#garantirConectado();
    return this.client.profile.setUsername({ username, source: "USER_INPUT" });
  }

  async deleteUsername() {
    this.#garantirConectado();
    return this.client.profile.deleteUsername();
  }

  /** Busca a conta de um @username. `status`: "found" | "key-required" | "not-found". */
  async resolveUsername(username, usernameKey) {
    this.#garantirConectado();
    return this.client.profile.resolveUsername({ username, usernameKey: usernameKey || undefined });
  }

  /**
   * Refaz a sessão de criptografia (Signal) com um contato. Corrige "Aguardando mensagem" e falhas
   * de decifração. `modo`: "force" (recria mantendo a identidade) | "identity" (trata como troca de
   * aparelho e reemite o token de contato confiável). Um JID de usuário corresponde ao aparelho 0 (celular).
   */
  async resyncSignalSession(jid, modo = "force") {
    this.#garantirConectado();
    const opcoes = modo === "identity" ? { reasonIdentity: true } : { force: true };
    await this.client.message.syncSignalSession(normalizarJid(jid), opcoes);
  }

  // ------------------------------------------------------------------ Privacidade

  /** Valor atual de cada categoria (lastSeen, online, profilePicture, about, readReceipts...). */
  async fetchPrivacySettings() {
    this.#garantirConectado();
    return this.client.privacy.getPrivacySettings();
  }

  /** Altera uma categoria. Retorna o dhash da lista de exceções (só em "contact_blacklist"). */
  async updatePrivacySetting(configuracao, valor) {
    this.#garantirConectado();
    return this.client.privacy.setPrivacySetting(configuracao, valor);
  }

  /** Contatos excluídos de uma categoria ("meus contatos, exceto..."). */
  async fetchPrivacyDisallowedList(configuracao) {
    this.#garantirConectado();
    return this.client.privacy.getDisallowedList(configuracao);
  }

  /** Adiciona/remove contatos da lista de exceções (passa a categoria para "contact_blacklist"). */
  async updatePrivacyDisallowedList(configuracao, { add = [], remove = [] } = {}) {
    this.#garantirConectado();
    return this.client.privacy.setDisallowedList(configuracao, { add: add.map(normalizarJid), remove: remove.map(normalizarJid) });
  }

  async fetchBlocklist() {
    this.#garantirConectado();
    return this.client.privacy.getBlocklist();
  }

  /** Perfil comercial de um contato (ou da própria conta). null se não for conta comercial. */
  async getBusinessProfile(jid) {
    this.#garantirConectado();
    const [perfil] = await this.client.business.getBusinessProfile([normalizarJid(jid)]);
    return perfil || null;
  }

  /** Edita o perfil comercial da conta (só contas WhatsApp Business). */
  async updateBusinessProfile(dados) {
    this.#garantirConectado();
    await this.client.business.editBusinessProfile(dados);
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
   * montando o nó na mão.
   */
  async rejectCall(idChamada, deQuem) {
    this.#garantirConectado();
    // Com o plugin de chamadas ativo, ele controla a ligação: rejeitar por fora deixaria o estado dele preso.
    if (this.chamadas) return this.chamadas.rejeitar(idChamada);
    const eu = this.user?.id ? normalizarJid(this.user.id) : undefined;
    await this.client.lowlevel.sendNode({
      tag: "call",
      attrs: { from: eu, to: deQuem, id: gerarIdMensagem() },
      content: [{ tag: "reject", attrs: { "call-id": idChamada, "call-creator": deQuem, count: "0" } }],
    });
  }

  // ------------------------------------------------------------------ Grupos

  /** Converte os metadados do grupo da zapo para o formato que a API publica. */
  #metadadosGrupo(g) {
    return paraJsonApi({
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

  /** Retorna um objeto { [jid]: metadados }, (formato da API). */
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

  // ------------------------------------------------------ Convites e pedidos de entrada

  /** Prévia do grupo de um convite (sem entrar). `codigo` = parte final de chat.whatsapp.com/<codigo>. */
  async groupGetInviteInfo(codigo) {
    this.#garantirConectado();
    const info = await this.client.group.queryGroupInviteInfo(codigo);
    return {
      id: info.jid,
      subject: info.subject,
      desc: info.desc,
      size: info.size,
      creation: info.creation,
      owner: info.subjectOwnerPhoneNumber || info.subjectOwner,
      linkedParent: info.linkedParentJid,
      membershipApprovalEnabled: Boolean(info.membershipApprovalEnabled),
      hasPendingMembershipRequest: Boolean(info.hasPendingMembershipRequest),
      participants: (info.participants || []).map((p) => ({ id: p.jid, phoneNumber: p.phoneNumber, admin: p.type || null })),
    };
  }

  /** Entra pelo código do convite. Retorna { status: "joined" | "pending", groupJid }. */
  async groupAcceptInvite(codigo) {
    this.#garantirConectado();
    return this.client.group.joinGroupViaLink(codigo);
  }

  async groupRequestParticipantsList(jid) {
    this.#garantirConectado();
    const pedidos = await this.client.group.queryMembershipApprovalRequests(jid);
    return pedidos.map((p) => ({
      jid: p.jid,
      phoneNumber: p.requestorPhone,
      requestor: p.requestor,
      requestTime: p.requestTime,
      requestMethod: p.requestMethod,
    }));
  }

  /** `acao`: "approve" | "reject". */
  async groupRequestParticipantsUpdate(jid, participantes, acao) {
    this.#garantirConectado();
    const metodos = { approve: "approveMembershipRequests", reject: "rejectMembershipRequests" };
    const metodo = metodos[acao];
    if (!metodo) throw new Error(`Ação inválida para pedidos de entrada: ${acao}`);
    await this.client.group[metodo](jid, participantes.map(normalizarJid));
  }

  /** Mensagens temporárias do grupo: 0 (desliga), 86400 (24h), 604800 (7 dias) ou 7776000 (90 dias). */
  async groupToggleEphemeral(jid, segundos) {
    this.#garantirConectado();
    await this.client.group.setEphemeralDuration(jid, segundos);
  }

  /** Quem pode adicionar membros: "admin_add" | "all_member_add". */
  async groupMemberAddMode(jid, modo) {
    this.#garantirConectado();
    await this.client.group.setMemberAddMode(jid, modo);
  }

  // ------------------------------------------------------------------ Comunidades

  async communityCreate(assunto, opcoes = {}) {
    this.#garantirConectado();
    return this.#metadadosGrupo(await this.client.group.createCommunity(assunto, opcoes));
  }

  async communityDeactivate(jid) {
    this.#garantirConectado();
    await this.client.group.deactivateCommunity(jid);
  }

  async communitySubGroups(jid) {
    this.#garantirConectado();
    return this.client.group.fetchSubGroups(jid);
  }

  /** `acao`: "link" | "unlink". */
  async communityLinkGroups(jid, grupos, acao, opcoes = {}) {
    this.#garantirConectado();
    if (acao === "link") return this.client.group.linkSubGroups(jid, grupos);
    if (acao === "unlink") return this.client.group.unlinkSubGroups(jid, grupos, opcoes);
    throw new Error(`Ação inválida para subgrupos: ${acao}`);
  }
}
