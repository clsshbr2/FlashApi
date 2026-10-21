import config from "../../../config/env.js";
import Message from "../../../models/Message.js";
import logger from "../../../utils/logger.js";
import { getMessageType } from "../../AcoesEventos/Message.js";

import WhatsAppService from "../../WhatsAppService.js";

const batches = new Map();
const saving = new Set();
const duplicadas = new Map();

export const formMessage = async (dados) => {
    try {

        let jid = dados?.key?.remoteJid || null
        let participant = dados?.key?.participant || null
        if (!dados?.key?.id) return
        const chave = `${dados.sessionId}:${dados?.key?.id}`;
        if (duplicadas.has(chave)) return
        duplicadas.set(chave, true);

        //Buscar JId de remetente
        if (jid.endsWith("@lid")) {
            try {
                const lidlimpo = jid.split("@")[0];
                const mapping = await WhatsAppService.redis.get(WhatsAppService.keys.lid_map(dados.sessionId, lidlimpo));
                if (mapping) {
                    jid = `${mapping}@s.whatsapp.net`
                }
            } catch (error) { }

        }

        //Buscar jid de participante
        if (participant?.endsWith("@lid")) {
            try {
                const lidlimpo = participant.split("@")[0];
                const mapping = await WhatsAppService.redis.get(WhatsAppService.keys.lid_map(dados.sessionId, lidlimpo));
                if (mapping) {
                    participant = `${mapping}@s.whatsapp.net`
                }
            } catch (error) { }
        }

        const dadosInsert = {
            sessao_id: dados.sessionId,
            mensagem_id: dados?.key?.id || null,
            remotejid: jid,
            fromme: dados?.key?.fromMe || false,
            isgrupo: dados?.key?.remoteJid?.endsWith("@g.us") ?? false,
            participant: participant,
            tipo_mensagem: getMessageType(dados.message) ?? null,
            conteudo_mensagem: JSON.stringify(dados),
            status: dados?.key?.fromMe ? "sent" : "received"
        };
        if (!batches.has(dados.sessionId)) {
            batches.set(dados.sessionId, []);
        }

        const batch = batches.get(dados.sessionId);
        batch.push(dadosInsert);
    } catch (error) {
        logger.error(`Erro ao formatar mesage: `, error)
    }

}

setInterval(() => {
    for (const sessionId of batches.keys()) {
        flushMessages(sessionId);
    }
}, 10000);

async function flushMessages(sessionId) {

    if (saving.has(sessionId)) return;
    saving.add(sessionId);

    const batch = batches.get(sessionId);
    if (batch.length === 0) {
        batches.delete(sessionId);
    }
    if (!batch) return

    try {

        while (batch.length > 0) {

            // pega até 500 mensagens
            const lote = batch.splice(0, config.batch_size);

            //Limpar map de duplicados
            for (const msg of lote) {
                duplicadas.delete(`${msg.sessao_id}:${msg.mensagem_id}`);
            }
            await Message.SaveMessageBatch(lote);

        }

    } catch (err) {

        logger.error(err);

    } finally {

        saving.delete(sessionId);

        // chegaram novas mensagens enquanto salvava?
        if (batch.length > 0) {
            void flushMessages(sessionId);
        }

    }

}