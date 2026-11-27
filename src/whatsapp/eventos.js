/**
 * Tradutor de EVENTOS: zapo -> formato dos eventos publicados pela API.
 *
 * Todo o resto da API (EventService, webhooks, WebSocket, workers) foi escrito
 * para escutar eventos nomeados (`messages.upsert`, `connection.update`,
 * `message-receipt.update`...) com um formato de dados específico.
 * Em vez de reescrever tudo, este módulo escuta os eventos da zapo
 * (`message`, `connection`, `receipt`...) e os re-emite NO FORMATO QUE A API SEMPRE PUBLICOU,
 * mantendo os payloads de webhook/WebSocket idênticos para quem já consome a API.
 *
 * Tabela de correspondência:
 *   zapo `auth_qr` / `connection`  ->  `connection.update`
 *   zapo `message`                 ->  `messages.upsert` (+ `messages.reaction` / `messages.update`)
 *   zapo `receipt`                 ->  `message-receipt.update` + `messages.update`
 *   zapo `group`                   ->  `group-participants.update` / `groups.update` / `groups.upsert`
 *   zapo `call`                    ->  `call`
 *   zapo `history_sync_chunk`      ->  `messaging-history.set` (somente contagens, ver docs)
 *   zapo `blocklist`               ->  `blocklist.set`
 *   zapo `picture`                 ->  `contacts.update`
 */
import { Boom } from "@hapi/boom";
import redis, { KEYS } from "../services/redis.js";
import logger from "../utils/logger.js";
import { paraJsonApi, somenteDigitos } from "./utils.js";

// Códigos de status de desconexão, usados por
// connection_update.js para decidir entre reconectar ou remover a sessão.
export const CODIGO_DESCONECTADO = 428; // connectionClosed -> reconecta
export const CODIGO_DESLOGADO = 401; // loggedOut
export const MENSAGEM_LOGOUT_INTENCIONAL = "Intentional Logout";

// Status de mensagem (3 entregue, 4 lido, 5 reproduzido)
const STATUS_MENSAGEM = { delivered: 3, read: 4, played: 5 };

/** Cria um erro Boom (com statusCode) como o connection_update.js espera. */
export function criarErroConexao(mensagem, statusCode) {
  return new Boom(mensagem, { statusCode });
}

/**
 * Registra o mapeamento LID -> número de telefone no Redis
 * (vem dos campos *Alt das mensagens e dos eventos de grupo). Aceita JIDs completos ou só os dígitos.
 */
export function registrarMapaLid(sessionId, lidJid, pnJid) {
  try {
    const lid = somenteDigitos(String(lidJid).split("@")[0].split(":")[0]);
    const pn = somenteDigitos(String(pnJid).split("@")[0].split(":")[0]);
    if (!lid || !pn) return;
    void redis.set(KEYS().lid_map(sessionId, lid), pn);
  } catch {
    // mapeamento é "melhor esforço": nunca deve quebrar o fluxo de mensagens
  }
}

/** Se a chave trouxer o par LID/telefone, registra o mapeamento. */
function aprenderMapaLidDaChave(sessionId, chave) {
  const pares = [
    [chave.remoteJid, chave.remoteJidAlt],
    [chave.participant, chave.participantAlt],
  ];
  for (const [principal, alternativo] of pares) {
    if (!principal || !alternativo) continue;
    if (principal.endsWith("@lid") && alternativo.endsWith("@s.whatsapp.net")) {
      registrarMapaLid(sessionId, principal, alternativo);
    } else if (principal.endsWith("@s.whatsapp.net") && alternativo.endsWith("@lid")) {
      registrarMapaLid(sessionId, alternativo, principal);
    }
  }
}

/** Converte a mensagem recebida da zapo para o formato de mensagem publicado pela API. */
function paraMensagemApi(evento) {
  const k = evento.key || {};
  return paraJsonApi({
    key: {
      remoteJid: k.remoteJid,
      fromMe: k.fromMe,
      id: k.id,
      participant: k.participant,
      remoteJidAlt: k.remoteJidAlt,
      participantAlt: k.participantAlt,
    },
    message: evento.message,
    messageTimestamp: evento.timestampSeconds,
    pushName: evento.pushName,
    broadcast: k.isBroadcast || undefined,
  });
}

/**
 * Liga todos os eventos da zapo ao emissor de eventos da sessão.
 * @param {import("./SessaoWhatsApp.js").SessaoWhatsApp} socket
 */
export function ligarEventosZapo(socket) {
  const { client, sessionId } = socket;
  const emitir = (nome, dados) => socket.emitir(nome, dados);

  // ---------------------------------------------------------------- QR Code
  client.on("auth_qr", ({ qr }) => {
    emitir("connection.update", { qr });
  });

  // A zapo para de gerar QR quando o limite de renovações acaba (forceManual) e
  // fica esperando. Nesse caso a API espera um fechamento com 408 e
  // reiniciava o ciclo (novo QR / contador de QR). Reproduzimos esse comportamento.
  client.on("auth_pairing_required", ({ forceManual }) => {
    if (forceManual) {
      logger.info(`Sessão ${sessionId}: QR expirado, reiniciando conexão`);
      void socket.end(criarErroConexao("QR refs attempts ended", 408));
    }
  });

  // ------------------------------------------------------------- Conexão
  client.on("auth_paired", () => {
    logger.info(`Sessão ${sessionId} pareada com sucesso`);
  });

  client.on("connection", (evento) => {
    if (evento.status === "open") {
      socket.marcarAberto();
      emitir("connection.update", { connection: "open", isNewLogin: evento.isNewLogin });
      return;
    }

    // status === "close"
    const logoutSolicitado = socket.logoutSolicitado;

    let erro;
    if (evento.isLogout && logoutSolicitado) {
      // Logout pedido pela própria API -> a sessão deve ser removida.
      erro = criarErroConexao(MENSAGEM_LOGOUT_INTENCIONAL, CODIGO_DESLOGADO);
    } else if (evento.isLogout) {
      // Aparelho desvinculado pelo celular. Comportamento esperado pela API:
      // 401 "não intencional" (a API tenta reconectar e gera novo QR).
      erro = criarErroConexao("Dispositivo desvinculado", CODIGO_DESLOGADO);
    } else {
      erro = criarErroConexao(`Conexão fechada (${evento.reason})`, evento.code || CODIGO_DESCONECTADO);
    }

    // emitirFechamento() garante um único "close" por ciclo de conexão.
    socket.emitirFechamento(erro);
  });

  // ------------------------------------------------------------ Mensagens

  // Votos de enquete: a zapo entrega a mensagem ("message") e o voto já decifrado
  // ("message_addon") em eventos separados, sem ordem garantida. Juntamos os dois
  // para publicar pollUpdateMessage.vote com os nomes das opções escolhidas.
  const votosProntos = new Map(); // idDaMensagem -> opções (voto chegou antes da mensagem)
  const mensagensAguardandoVoto = new Map(); // idDaMensagem -> { mensagem, timer }
  const ESPERA_VOTO_MS = 3000;

  /** Publica a mensagem recebida e os eventos derivados (reação, apagar, editar). */
  const publicarMensagem = (mensagem) => {
    emitir("messages.upsert", { messages: [mensagem], type: "notify" });

    const conteudo = mensagem.message || {};

    // Reação -> também gera `messages.reaction`
    if (conteudo.reactionMessage) {
      emitir("messages.reaction", [
        {
          key: conteudo.reactionMessage.key,
          reaction: { ...conteudo.reactionMessage, key: mensagem.key },
        },
      ]);
    }

    // Mensagem apagada para todos / editada -> `messages.update`
    const proto = conteudo.protocolMessage;
    if (proto) {
      // 0 = REVOKE, 14 = MESSAGE_EDIT (valores do proto do WhatsApp)
      if (proto.type === 0 || proto.type === "REVOKE") {
        emitir("messages.update", [
          { key: proto.key, update: { message: null, messageStubType: 1, key: mensagem.key, messageTimestamp: mensagem.messageTimestamp } },
        ]);
      } else if (proto.type === 14 || proto.type === "MESSAGE_EDIT") {
        emitir("messages.update", [
          { key: proto.key, update: { message: { editedMessage: { message: proto.editedMessage } }, messageTimestamp: mensagem.messageTimestamp } },
        ]);
      }
    }
  };

  client.on("message", (evento) => {
    try {
      const mensagem = paraMensagemApi(evento);
      if (!mensagem?.key?.id) return;

      aprenderMapaLidDaChave(sessionId, mensagem.key);


      const voto = mensagem.message?.pollUpdateMessage;
      if (!voto) return publicarMensagem(mensagem);

      // Voto de enquete: se a zapo já decifrou, publica; senão espera um pouco.
      const id = mensagem.key.id;
      if (votosProntos.has(id)) {
        voto.vote = votosProntos.get(id);
        votosProntos.delete(id);
        return publicarMensagem(mensagem);
      }
      const timer = setTimeout(() => {
        // Não conseguiu decifrar (ex.: enquete criada antes da sessão existir): publica sem opções.
        mensagensAguardandoVoto.delete(id);
        voto.vote = [];
        publicarMensagem(mensagem);
      }, ESPERA_VOTO_MS);
      mensagensAguardandoVoto.set(id, { mensagem, timer });
    } catch (erro) {
      logger.error(`Erro ao converter mensagem recebida (sessão ${sessionId}): ${erro?.message || erro}`);
    }
  });

  client.on("message_addon", (evento) => {
    try {
      if (evento.kind !== "poll_vote") return;
      const opcoes = [...(evento.decrypted?.selectedOptionNames || [])];
      const id = evento.key?.id;
      if (!id) return;

      const aguardando = mensagensAguardandoVoto.get(id);
      if (aguardando) {
        clearTimeout(aguardando.timer);
        mensagensAguardandoVoto.delete(id);
        aguardando.mensagem.message.pollUpdateMessage.vote = opcoes;
        return publicarMensagem(aguardando.mensagem);
      }
      // O voto chegou antes da mensagem: guarda por alguns segundos.
      votosProntos.set(id, opcoes);
      setTimeout(() => votosProntos.delete(id), 10000).unref?.();
    } catch (erro) {
      logger.error(`Erro ao tratar voto de enquete (sessão ${sessionId}): ${erro?.message || erro}`);
    }
  });

  // -------------------------------------------------------------- Recibos
  client.on("receipt", (evento) => {
    try {
      const agora = Math.floor(Date.now() / 1000);
      const chat = evento.chatJid;
      const participante = evento.participantJid || undefined;
      const ids = evento.messageIds || [];
      if (!chat || ids.length === 0) return;

      const campoTempo = { delivered: "receiptTimestamp", read: "readTimestamp", played: "playedTimestamp" }[evento.status];
      const status = STATUS_MENSAGEM[evento.status];
      if (!campoTempo) return; // "inactive" etc. não são publicados

      const chaves = ids.map((id) => ({ remoteJid: chat, id, fromMe: true, participant: participante }));

      emitir(
        "message-receipt.update",
        chaves.map((key) => ({
          key,
          receipt: { userJid: participante || chat, [campoTempo]: agora },
        })),
      );
      emitir(
        "messages.update",
        chaves.map((key) => ({ key, update: { status } })),
      );
    } catch (erro) {
      logger.error(`Erro ao converter recibo (sessão ${sessionId}): ${erro?.message || erro}`);
    }
  });

  // ---------------------------------------------------------------- Grupos
  client.on("group", (evento) => {
    try {
      const id = evento.groupJid || evento.chatJid;
      if (!id) return;
      const participantes = (evento.participants || []).map((p) => p.jid).filter(Boolean);

      // Aproveita para aprender o mapeamento LID <-> telefone dos participantes.
      for (const p of evento.participants || []) {
        if (p.lidJid && p.phoneJid) registrarMapaLid(sessionId, p.lidJid, p.phoneJid);
      }

      switch (evento.action) {
        case "add":
        case "remove":
        case "promote":
        case "demote":
          emitir("group-participants.update", { id, author: evento.authorJid, participants: participantes, action: evento.action });
          break;
        case "delete":
          emitir("group-participants.update", { id, author: evento.authorJid, participants: participantes, action: "remove" });
          break;
        case "subject":
          emitir("groups.update", [{ id, subject: evento.subject, subjectOwner: evento.subjectOwnerJid, subjectTime: evento.timestampSeconds }]);
          break;
        case "description":
          emitir("groups.update", [{ id, desc: evento.description, descId: evento.descriptionId }]);
          break;
        case "announce":
          emitir("groups.update", [{ id, announce: evento.enabled !== false }]);
          break;
        case "restrict":
          emitir("groups.update", [{ id, restrict: evento.enabled !== false }]);
          break;
        case "ephemeral":
          emitir("groups.update", [{ id, ephemeralDuration: evento.expirationSeconds }]);
          break;
        case "membership_approval_request":
        case "created_membership_requests":
          for (const pedido of evento.membershipRequests || []) {
            emitir("group.join-request", { id, author: evento.authorJid, participant: pedido.jid, action: "created", method: evento.requestMethod });
          }
          break;
        case "create":
          emitir("groups.upsert", [{ id, subject: evento.subject, owner: evento.authorJid, creation: evento.timestampSeconds }]);
          break;
        default:
          // Outras ações (convite, link, etc.) não têm evento dedicado na API.
          emitir("groups.update", [{ id, ...paraJsonApi(evento.details || {}) }]);
      }
    } catch (erro) {
      logger.error(`Erro ao converter evento de grupo (sessão ${sessionId}): ${erro?.message || erro}`);
    }
  });

  // ------------------------------------------------------------- Chamadas
  client.on("call", (evento) => {
    try {
      const de = evento.callCreatorJid || evento.senderLidJid || evento.chatJid;
      emitir("call", [
        {
          id: evento.callId,
          chatId: evento.chatJid,
          from: de,
          callerPn: evento.callerPnJid,
          date: new Date((evento.timestampSeconds || Math.floor(Date.now() / 1000)) * 1000),
          offline: Boolean(evento.offline),
          status: evento.type, // "offer" | "accept" | "reject" | "terminate" ...
          isVideo: Boolean(evento.isVideo),
          isGroup: Boolean(evento.groupJid),
          groupJid: evento.groupJid,
        },
      ]);
    } catch (erro) {
      logger.error(`Erro ao converter chamada (sessão ${sessionId}): ${erro?.message || erro}`);
    }
  });

  // ------------------------------------------------- Presença / digitando
  client.on("chatstate", (evento) => {
    const id = evento.chatJid;
    if (!id) return;
    const quem = evento.participantJid || id;
    const mapa = { composing: "composing", recording: "recording", paused: "paused" };
    emitir("presence.update", { id, presences: { [quem]: { lastKnownPresence: mapa[evento.state] || "available" } } });
  });

  // -------------------------------------------------- Histórico (resumo)
  client.on("history_sync_chunk", (evento) => {
    // A zapo NÃO entrega as listas de chats/contatos/mensagens no evento
    // (ela só informa contagens). Emitimos o evento com listas vazias para
    // manter o fluxo e informar o progresso.
    emitir("messaging-history.set", {
      contacts: [],
      chats: [],
      messages: [],
      lidPnMappings: [],
      syncType: evento.syncType,
      progress: evento.progress,
      counts: {
        messages: evento.messagesCount,
        conversations: evento.conversationsCount,
        contacts: evento.inlineContactsCount,
      },
    });
  });

  // -------------------------------------------- Bloqueios e foto de perfil
  client.on("blocklist", (resultado) => {
    const lista = (resultado?.blocklist || resultado?.jids || resultado || []);
    const jids = Array.isArray(lista) ? lista.map((i) => (typeof i === "string" ? i : i?.jid)).filter(Boolean) : [];
    emitir("blocklist.set", { blocklist: jids });
  });

  client.on("picture", (evento) => {
    if (!evento.targetJid) return;
    emitir("contacts.update", [{ id: evento.targetJid, imgUrl: evento.action === "set" ? "changed" : "removed" }]);
  });

  // ------------------------------------------------------------- Erros
  client.on("stream_failure", (evento) => {
    logger.warn(`Sessão ${sessionId}: falha de stream ${JSON.stringify(paraJsonApi(evento))}`);
  });
  client.on("debug_client_error", ({ error }) => {
    logger.debug(`Sessão ${sessionId}: erro interno da zapo: ${error?.message || error}`);
  });
}
