import WhatsAppService from "../WhatsAppService.js";
import WebSocketService from "../WebSocketService.js";
import Message from "../../models/Message.js";
import logger from "../../utils/logger.js";
import config from "../../config/env.js";



export const messagemap = async (sessionId, dados) => {
    const { messages, type } = dados
    if (!Array.isArray(messages) || messages.length === 0) {
        return;
    }
    const pipeline = WhatsAppService.redis.workerClient.pipeline();
    const sessao = await WhatsAppService.redis.get(WhatsAppService.keys.sessao(sessionId))

    for (const msg of messages) {

        let message = JSON.parse(JSON.stringify(msg))
        if (sessao?.ignorar_grupos === true && message?.key?.remoteJid?.endsWith("@g.us")) continue; //Verificar se ta ativo ignorar grupos
        if (!message.key || (config.ignore_boadcast === true && message?.key?.remoteJid == "status@broadcast")) continue; //Verificar se e evendo de status
        const messageType = getMessageType(message.message);
        const tiposIgnoraveis = new Set(["protocolMessage", "senderKeyDistributionMessage"]);
        if (tiposIgnoraveis.has(messageType)) continue; //Ignora tipos de messagem

        const dadosmsg = {
            sessionId: sessionId,
            ...message
        }

        if (message.message?.pollCreationMessageV3 ||
            message.message?.pollCreationMessage ||
            message.message?.pollCreationMessageV2 ||
            message.message?.pollUpdateMessage
        ) {
            // O voto já chega decifrado em pollUpdateMessage.vote (feito em whatsapp/eventos.js)
            Message.SaveMessage(dadosmsg)

        } else {
            //Adicionar messagem a lista de cache
            pipeline.lpush(
                WhatsAppService.keys.Store_mensagens(),
                JSON.stringify(message)
            )
        }
        WebSocketService.emitEvents(sessionId, 'messages_upsert', message);

    }
    await pipeline.exec();
}

export const getMessageType = (message) => {
    if (!message || typeof message !== "object") return null;

    if (message.ephemeralMessage?.message) {
        return getMessageType(message.ephemeralMessage.message);
    }

    if (message.viewOnceMessage?.message) {
        return getMessageType(message.viewOnceMessage.message);
    }

    if (message.viewOnceMessageV2?.message) {
        return getMessageType(message.viewOnceMessageV2.message);
    }

    if (message.viewOnceMessageV2Extension?.message) {
        return getMessageType(message.viewOnceMessageV2Extension.message);
    }
    if (message.pollCreationMessageV3 ||
        message.pollCreationMessage ||
        message.pollCreationMessageV2
    ) {
        return "pollCreationMessage";
    }
    if (message.pollUpdateMessage) {
        return "pollUpdateMessage"
    }

    return Object.keys(message)[0] || null;
}
