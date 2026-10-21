import config from "../../../config/env.js";
import Chats from "../../../models/chats.js";
import logger from "../../../utils/logger.js";

import WhatsAppService from "../../WhatsAppService.js";
import redis, { KEYS } from "../../redis.js";

const batches = new Map();
const saving = new Set();
const duplicadas = new Map();

export const formChats = async (dados) => {
    try {

        let jid = dados?.id || null
        let participant = dados?.key?.participant || null
        const eh_grupo = jid?.endsWith("@g.us") ? true : false

        //Buscar JId de remetente
        if (jid.endsWith("@lid")) {
            try {
                const lidlimpo = jid.split("@")[0];
                const mapping = await redis.get(KEYS().lid_map(dados.sessionId, lidlimpo));
                if (mapping) {
                    jid = `${mapping}@s.whatsapp.net`
                }
            } catch (error) { }

        }

        const dadosInsert = {
            sessao_id: dados.sessionId,
            jid: jid,
            nome: dados?.name || dados?.displayName || "Sem nome",
            eh_grupo,
            mensagens_nao_lidas: parseInt(dados?.unreadCount) || 0,
            arquivado: dados?.archived || false,
            fixado: dados.pinned || false,
            dados: JSON.stringify(dados)
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
        flushChats(sessionId);
    }
}, 10000);

async function flushChats(sessionId) {

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

            await Chats.SaveChatsBatch(lote);
            for (const ctt of lote) {
                duplicadas.delete(`${ctt.sessao_id}:${ctt.jid}`);
            }


        }

    } catch (err) {

        logger.error(err);

    } finally {

        saving.delete(sessionId);

        // chegaram novas mensagens enquanto salvava?
        if (batch.length > 0) {
            void flushChats(sessionId);
        }

    }

}