import { Boom } from "@hapi/boom";
import QRCode from "qrcode";
import Session from "../models/Session.js";
import WhatsAppService from "./WhatsAppService.js";
import WebSocketService from "./WebSocketService.js";
import { sendMessage } from "./messageService.js";
import redis, { KEYS } from "./redis.js";
import config from "../config/env.js";
import { criarErroConexao } from "../whatsapp/eventos.js";
import { limparDadosSessaoZapo } from "../whatsapp/store.js";
import logger from "../utils/logger.js";

// Mensagens que não são publicadas (controle interno do WhatsApp).
const TIPOS_IGNORADOS = new Set(["protocolMessage", "senderKeyDistributionMessage"]);

// Eventos repassados ao WebSocket/webhook sem tratamento extra.
// O nome publicado é o do evento trocando "." e "-" por "_" (ex.: "chats.upsert" -> "chats_upsert").
const EVENTOS_SIMPLES = [
    "messaging-history.status",
    "chats.upsert", "chats.update", "chats.delete", "chats.lock",
    "lid-mapping.update",
    "contacts.upsert", "contacts.update",
    "messages.delete", "messages.update", "messages.media-update", "messages.reaction",
    "message-receipt.update",
    "blocklist.set", "blocklist.update",
    "labels.edit", "labels.association",
    "newsletter.reaction", "newsletter.view", "newsletter-participants.update", "newsletter-settings.update",
    "message-capping.update",
    "settings.update",
];

// Eventos de grupo: respeitam a opção "ignorar grupos" da sessão.
const EVENTOS_GRUPO = [
    "groups.upsert", "groups.update",
    "group-participants.update", "group.join-request", "group.member-tag.update",
];

// Razões de fechamento em que a zapo orienta NÃO reconectar (docs: guides/errors e guides/reconnection).
const RAZOES_FATAIS = /stream_error_replaced|stream_error_device_removed|stream_error_force_logout|failure_banned|failure_locked|failure_client_too_old|failure_bad_user_agent|primary_identity_key_change/;

const nomePublicado = (evento) => evento.replace(/[.-]/g, "_");

/** Tipo principal da mensagem, atravessando efêmera / visualização única. */
const tipoMensagem = (message) => {
    if (!message || typeof message !== "object") return null;
    const interna = message.ephemeralMessage?.message
        || message.viewOnceMessage?.message
        || message.viewOnceMessageV2?.message
        || message.viewOnceMessageV2Extension?.message;
    if (interna) return tipoMensagem(interna);
    return Object.keys(message)[0] || null;
};

/** Grava no Redis e no banco o estado atual da sessão. */
async function updateSessao(sessionId, sessao) {
    await redis.set(KEYS().sessao(sessionId), sessao);
    await Session.update(sessionId, {
        status: sessao.status,
        qr_code: sessao.qrcode,
        phone_number: sessao.numero,
        code: sessao.code,
    });
}

/** Trata `connection.update`: QR Code, conexão aberta e reconexão/remoção. */
async function connection(sessionId, update) {
    const { connection, lastDisconnect, qr } = update;

    const count = WhatsAppService.countQrcode.get(sessionId) || 0;

    const sock = WhatsAppService.sockets.get(sessionId);
    if (!sock) return;

    const getsessao = await WhatsAppService.GetSessao(sessionId);
    if (!getsessao) return;

    if (qr) {
        if (count >= parseInt(config.qrcode_limite)) {
            logger.info("Limite de Qrcode atingido");
            Session.delete(sessionId, false);
            return;
        }
        WhatsAppService.countQrcode.set(sessionId, count + 1);

        let code = null;

        // O código de pareamento só é pedido UMA vez e somente quando o número veio na
        // requisição de conectar (sock.numeroParaCodigo). Usar o número guardado da conexão
        // anterior repetia o pedido a cada reconexão e o WhatsApp bloqueava (429 rate-overlimit).
        if (sock.numeroParaCodigo && !sock.authState?.creds?.registered) {
            const numero = sock.numeroParaCodigo;
            sock.numeroParaCodigo = null;

            try {
                logger.info(`Pedindo código de pareamento (sessão ${sessionId})`);
                code = await sock.requestPairingCode(numero);
                logger.info(`Código de pareamento gerado para a sessão ${sessionId}`);
            } catch (error) {
                logger.error(`Erro ao gerar código de pareamento (sessão ${sessionId}): ${error?.message || error}`);
                // requestPairingCode troca o segredo ADV antes de falhar: o QR atual ficou desatualizado e
                // escaneá-lo dá "pair-success HMAC validation failed". Reinicia o ciclo para gerar um QR coerente.
                logger.warn(`Sessão ${sessionId}: reiniciando a conexão para gerar um QR Code válido`);
                void sock.end(criarErroConexao("Falha ao pedir código de pareamento", 408));
                return;
            }
        }

        logger.info(`Qrcode sessão ${sessionId}`);
        // Renovações do QR não trazem código novo: não apaga o que já foi gerado.
        if (code) getsessao.code = code;
        // Com código gerado o segredo ADV foi trocado: este QR já não vale; use o código.
        getsessao.qrcode = code ? null : await QRCode.toDataURL(qr);
        getsessao.status = "qr_ready";
        void updateSessao(sessionId, getsessao);
    }

    if (connection === "connecting") {
        getsessao.status = "connecting";
        void updateSessao(sessionId, getsessao);
    }

    if (connection === "open") {
        const numero = sock.user.id.split(":")[0] || null;
        logger.info(`Sessão ${sessionId} Conectada numero: ${numero} Nome: ${sock.user.name}`);
        getsessao.status = "connected";
        getsessao.numero = numero;
        getsessao.qrcode = null;
        getsessao.code = null;
        void updateSessao(sessionId, getsessao);
        WhatsAppService.countQrcode.delete(sessionId);
        WhatsAppService.limitReconnect.delete(sessionId);
    }

    if (connection === "close") {
        try { sock.ev.removeAllListeners(); sock.end(); } catch { }

        // Desligamento da API (deploy/restart): não reconecta nem mexe no estado da sessão.
        if (WhatsAppService.desligando) return;

        // Proteção contra loop de reconexão. Só desiste de reconectar: NUNCA apaga as credenciais, senão uma
        // falha passageira (rede, DNS ou proxy ainda indisponíveis logo após o deploy) forçaria novo QR Code.
        const tentativas = (WhatsAppService.limitReconnect.get(sessionId) || 0) + 1;
        WhatsAppService.limitReconnect.set(sessionId, tentativas);
        if (tentativas > 10) {
            logger.warn(`Sessão ${sessionId}: limite de tentativas de reconexão atingido (credenciais mantidas)`);
            WhatsAppService.sockets.delete(sessionId);
            const sessaoParada = await WhatsAppService.GetSessao(sessionId);
            if (sessaoParada) { sessaoParada.status = "disconnected"; void updateSessao(sessionId, sessaoParada); }
            return;
        }

        const erro = new Boom(lastDisconnect?.error).output;
        logger.info("sessão desconectado motivo: ", erro?.payload);
        getsessao.status = "disconnected";
        void updateSessao(sessionId, getsessao);

        if (erro.statusCode == 401 && erro.payload?.message == "Intentional Logout") {
            logger.info(`Sessão: ${sessionId} Logout Removendo`);
            await Session.delete(sessionId, false);
            return;
        }

        // Aparelho desvinculado pelo celular (401): as credenciais guardadas não servem mais; limpa para gerar novo QR.
        if (erro.statusCode == 401) await limparDadosSessaoZapo(sessionId);

        // Razões fatais segundo a documentação da zapo: reconectar não resolve (ou piora). Em especial
        // "stream_error_replaced": as MESMAS credenciais abriram em outro lugar (outra instância da API, ex.:
        // container antigo no deploy ou ambiente local no mesmo banco). Reconectar derrubaria a outra de volta e
        // as duas ficariam brigando. Mantém as credenciais; reconecte depois via PUT /session/restart ou conectar_sessao.
        const motivoFechamento = String(erro.payload?.message);
        if (RAZOES_FATAIS.test(motivoFechamento)) {
            logger.warn(`Sessão ${sessionId}: ${motivoFechamento} — não reconecta automaticamente (credenciais mantidas)`);
            WhatsAppService.sockets.delete(sessionId);
            return;
        }

        logger.info(erro.statusCode == 515 ? `Status 515 Reiniciando sessão: ${sessionId}` : `Reconectando sessão: ${sessionId}`);
        getsessao.status = "connecting";
        void updateSessao(sessionId, getsessao);
        // Espera crescente: 3s, 6s, 9s... (máx. 30s) para dar tempo da rede/proxy voltarem.
        await WhatsAppService.delay(Math.min(3000 * tentativas, 30000));
        if (WhatsAppService.desligando) return;
        // Alguém (ex.: o usuário via API) já recriou a conexão enquanto esperávamos: não cria outra.
        if (WhatsAppService.sockets.get(sessionId) !== sock) return;
        return WhatsAppService.createSession(sessionId);
    }
}

/** Rejeita ligações automaticamente (e avisa quem ligou) quando a sessão está configurada para isso. */
async function call(sessionId, data) {
    const sock = WhatsAppService.sockets.get(sessionId);
    if (!sock) return;

    const sessao = await WhatsAppService.GetSessao(sessionId);
    if (!sessao?.rejeitar_ligacoes) return;

    for (const chamada of data) {
        if (chamada.status !== "offer") continue;

        await sock.rejectCall(chamada.id, chamada.from);

        if (sessao.msg_rejectcalls) {
            let destino = chamada.from;
            if (destino.includes("@lid")) {
                const telefone = await redis.get(KEYS().lid_map(sessionId, destino.split(":")[0].split("@")[0]));
                if (telefone) destino = `${telefone}@s.whatsapp.net`;
            }
            if (chamada.callerPn) destino = chamada.callerPn;

            await sendMessage(sessionId, { jid: destino, text: sessao.msg_rejectcalls, delay: "1200" });
        }
        logger.info(`📞 Chamada rejeitada automaticamente de ${chamada.from}`);
    }
}

/** Publica as mensagens recebidas no WebSocket/webhook (quem guarda é a zapo). */
async function mensagens(sessionId, { messages }) {
    if (!Array.isArray(messages) || messages.length === 0) return;
    const sessao = await redis.get(KEYS().sessao(sessionId));

    for (const msg of messages) {
        if (!msg.key) continue;
        if (sessao?.ignorar_grupos === true && msg.key.remoteJid?.endsWith("@g.us")) continue;
        if (config.ignore_boadcast === true && msg.key.remoteJid == "status@broadcast") continue;
        if (TIPOS_IGNORADOS.has(tipoMensagem(msg.message))) continue;

        WebSocketService.emitEvents(sessionId, "messages_upsert", JSON.parse(JSON.stringify(msg)));
    }
}

/**
 * Liga os eventos da sessão (formato legado da API) aos webhooks/WebSocket.
 * Os nomes e formatos dos eventos são os mesmos que a API sempre publicou.
 */
export const registrarEventos = async (sock, sessionId) => {
    const sessao = await redis.get(KEYS().sessao(sessionId));

    const repassar = (evento, depois) => {
        sock.ev.on(evento, (data) => {
            try {
                WebSocketService.emitEvents(sessionId, nomePublicado(evento), data);
                depois?.(data);
            } catch (error) { }
        });
    };

    sock.ev.on("connection.update", (update) => {
        WebSocketService.emitEvents(sessionId, "connection_update", update);
        connection(sessionId, update);
    });

    sock.ev.on("messages.upsert", (dados) => mensagens(sessionId, dados));

    repassar("messaging-history.set", ({ contacts, chats, messages }) => {
        logger.info(`Sincronização iniciada contatos: ${contacts?.length ?? 0} chats: ${chats?.length ?? 0} message: ${messages?.length ?? 0}`);
    });

    EVENTOS_SIMPLES.forEach((evento) => repassar(evento));

    EVENTOS_GRUPO.forEach((evento) => {
        sock.ev.on(evento, (data) => {
            try {
                if (sessao?.ignorar_grupos) return;
                WebSocketService.emitEvents(sessionId, nomePublicado(evento), data);
            } catch (error) { }
        });
    });

    repassar("call", (data) => call(sessionId, data));
};
