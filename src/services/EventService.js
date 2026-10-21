
import Session from "../models/Session.js";
import WhatsAppService from "./WhatsAppService.js";
import logger from "../utils/logger.js";
import WebSocketService from "./WebSocketService.js";
import { call } from "./AcoesEventos/call.js";
import { connection } from "./AcoesEventos/connection_update.js";
import { messagemap } from "./AcoesEventos/Message.js";
import redis, { KEYS } from "./redis.js";

/**
 * Liga os eventos da sessão (formato legado da API) aos webhooks/WebSocket e filas.
 * Os nomes e formatos dos eventos são os mesmos que a API sempre publicou.
 */
export const registrarEventos = async (sock, sessionId) => {

    const sessao = await redis.get(KEYS().sessao(sessionId))

    async function enqueueList(lista, fila, sessionId, type = null) {
        if (!Array.isArray(lista) || lista.length === 0) {
            return;
        }

        const pipeline = redis.workerClient.pipeline();
        const unicos = new Map();

        for (const item of lista) {
            const dados = JSON.parse(JSON.stringify(item))
            dados.sessionId = sessionId

            if (type) {
                dados.type = type
            }
            pipeline.lpush(fila, JSON.stringify(dados));
        }

        await pipeline.exec();
    }

    sock.ev.on('connection.update', async (update) => {
        WebSocketService.emitEvents(sessionId, 'connection_update', update)
        connection(sessionId, update)
    })

    sock.ev.on('messages.upsert', async (dados) => {
        messagemap(sessionId, dados)
    })

    sock.ev.on("messaging-history.set", async (data) => {
        try {
            WebSocketService.emitEvents(sessionId, "messaging_history_set", data);
            const { contacts, chats, messages, lidPnMappings } = data
            logger.info(`Sincronização iniciada contatos: ${contacts?.length ?? 0} chats: ${chats?.length ?? 0} message: ${messages?.length ?? 0} lid_map: ${lidPnMappings?.length ?? 0}`)
            await Promise.all([
                Array.isArray(contacts) ? enqueueList(contacts, KEYS().Store_contatos(), sessionId) : [],
                Array.isArray(chats) ? enqueueList(chats, KEYS().Store_chats(), sessionId) : [],
                Array.isArray(messages) ? enqueueList(messages, KEYS().Store_mensagens(), sessionId) : [],
                Array.isArray(lidPnMappings) ? enqueueList(lidPnMappings, KEYS().queue_util(), sessionId, 'lid_map') : []
            ]);




        } catch (error) {
            logger.error(`Erro no messaging-history.set: `, error)
        }

    });

    sock.ev.on("messaging-history.status", (data) => {
        try {
            console.log(data)
            WebSocketService.emitEvents(sessionId, "messaging_history_status", data);
        } catch (error) { }

    });

    sock.ev.on("chats.upsert", (data) => {
        try {
            WebSocketService.emitEvents(sessionId, "chats_upsert", data);
        } catch (error) { }

    });

    sock.ev.on("chats.update", (data) => {
        try {
            WebSocketService.emitEvents(sessionId, "chats_update", data);
        } catch (error) { }

    });

    sock.ev.on("lid-mapping.update", (data) => {
        try {
            WebSocketService.emitEvents(sessionId, "lid_mapping_update", data);
        } catch (error) { }

    });

    sock.ev.on("chats.delete", (data) => {
        try {
            WebSocketService.emitEvents(sessionId, "chats_delete", data);
        } catch (error) { }

    });

    //Evendo de digitando 
    // sock.ev.on("presence.update", (data) => {
    //     try {
    //         WebSocketService.emitEvents(sessionId, "presence_update", data);
    //     } catch (error) { }

    // });

    sock.ev.on("contacts.upsert", (data) => {
        try {
            WebSocketService.emitEvents(sessionId, "contacts_upsert", data);
            enqueueList(data, KEYS().Store_contatos(), sessionId)
        } catch (error) { }
    });

    sock.ev.on("contacts.update", (data) => {
        try {
            WebSocketService.emitEvents(sessionId, "contacts_update", data);
        } catch (error) { }
    });

    sock.ev.on("messages.delete", (data) => {
        try {
            WebSocketService.emitEvents(sessionId, "messages_delete", data);
        } catch (error) { }
    });

    sock.ev.on("messages.update", (data) => {
        try {
            WebSocketService.emitEvents(sessionId, "messages_update", data);
        } catch (error) { }
    });

    sock.ev.on("messages.media-update", (data) => {
        try {
            WebSocketService.emitEvents(sessionId, "messages_media_update", data);
        } catch (error) { }
    });

    sock.ev.on("messages.reaction", (data) => {
        try {
            WebSocketService.emitEvents(sessionId, "messages_reaction", data);
        } catch (error) { }
    });

    sock.ev.on("message-receipt.update", (data) => {
        try {
            WebSocketService.emitEvents(sessionId, "message_receipt_update", data);
        } catch (error) { }
    });

    sock.ev.on("groups.upsert", (data) => {
        try {
            if (sessao?.ignorar_grupos) return; //Verificar se ta ativo ignorar grupos
            WebSocketService.emitEvents(sessionId, "groups_upsert", data);
        } catch (error) { }
    });

    sock.ev.on("groups.update", (data) => {
        try {
            if (sessao?.ignorar_grupos) return; //Verificar se ta ativo ignorar grupos
            WebSocketService.emitEvents(sessionId, "groups_update", data);
        } catch (error) { }
    });

    sock.ev.on("group-participants.update", (data) => {
        try {
            if (sessao?.ignorar_grupos) return; //Verificar se ta ativo ignorar grupos
            WebSocketService.emitEvents(sessionId, "group_participants_update", data);
        } catch (error) { }
    });

    sock.ev.on("group.join-request", (data) => {
        try {
            if (sessao?.ignorar_grupos) return; //Verificar se ta ativo ignorar grupos
            WebSocketService.emitEvents(sessionId, "group_join_request", data);
        } catch (error) { }
    });

    sock.ev.on("group.member-tag.update", (data) => {
        try {
            if (sessao?.ignorar_grupos) return; //Verificar se ta ativo ignorar grupos
            WebSocketService.emitEvents(sessionId, "group_member_tag_update", data);
        } catch (error) { }
    });

    sock.ev.on("blocklist.set", (data) => {
        try {
            WebSocketService.emitEvents(sessionId, "blocklist_set", data);
        } catch (error) { }
    });

    sock.ev.on("blocklist.update", (data) => {
        try {
            WebSocketService.emitEvents(sessionId, "blocklist_update", data);
        } catch (error) { }
    });

    sock.ev.on("call", (data) => {
        try {
            WebSocketService.emitEvents(sessionId, "call", data);
            call(sessionId, data);
        } catch (error) { }
    });

    sock.ev.on("labels.edit", (data) => {
        try {
            WebSocketService.emitEvents(sessionId, "labels_edit", data);
        } catch (error) { }
    });

    sock.ev.on("labels.association", (data) => {
        try {
            WebSocketService.emitEvents(sessionId, "labels_association", data);
        } catch (error) { }
    });

    sock.ev.on("newsletter.reaction", (data) => {
        try {
            WebSocketService.emitEvents(sessionId, "newsletter_reaction", data);
        } catch (error) { }
    });

    sock.ev.on("newsletter.view", (data) => {
        try {
            WebSocketService.emitEvents(sessionId, "newsletter_view", data);
        } catch (error) { }
    });

    sock.ev.on("newsletter-participants.update", (data) => {
        try {
            WebSocketService.emitEvents(sessionId, "newsletter_participants_update", data);
        } catch (error) { }
    });

    sock.ev.on("newsletter-settings.update", (data) => {
        try {
            WebSocketService.emitEvents(sessionId, "newsletter_settings_update", data);
        } catch (error) { }
    });

    sock.ev.on("message-capping.update", (data) => {
        try {
            WebSocketService.emitEvents(sessionId, "message_capping_update", data);
        } catch (error) { }
    });

    sock.ev.on("chats.lock", (data) => {
        try {
            WebSocketService.emitEvents(sessionId, "chats_lock", data);
        } catch (error) { }
    });

    sock.ev.on("settings.update", (data) => {
        try {
            WebSocketService.emitEvents(sessionId, "settings_update", data);
        } catch (error) { }
    });

}


