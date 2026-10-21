import config from "../../../config/env.js";
import Contato from "../../../models/Contatos.js";
import logger from "../../../utils/logger.js";

import WhatsAppService from "../../WhatsAppService.js";
import redis, { KEYS } from "../../redis.js";

const batches = new Map();
const saving = new Set();
const duplicadas = new Map();

export const formContatos = async (dados) => {
    try {

        let jid = dados?.phoneNumber?.endsWith("@s.whatsapp.net") ?
            dados?.phoneNumber :
            (dados.id.endsWith("@s.whatsapp.net") ?
                dados.id : (dados.lid ? dados.lid :
                    dados.id
                ));

        const name = dados?.name ?
            dados?.name :
            (dados.username ?
                dados.username :
                null
            )

        //Buscar JId de remetente
        if (jid.endsWith("@lid")) {
            try {
                const lidlimpo = jid.split("@")[0];
                const mapping = await redis.get(KEYS().lid_map(dados.sessionId, lidlimpo));
                if (mapping) {
                    jid = `${mapping}@s.whatsapp.net`
                }
            } catch (error) {

            }

        }
        const chave = `${dados.sessionId}:${jid}`;
        if (duplicadas.has(chave)) return
        duplicadas.set(chave, true);

        const dadosInsert = {
            sessao_id: dados.sessionId,
            jid: jid || null,
            nome: name,
            apelido: dados?.apelido || name,
            nome_verificado: dados?.nome_verificado || name,
            url_imagem: dados?.url_imagem || null,
            status_contato: null,
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
        flushContatos(sessionId);
    }
}, 10000);

async function flushContatos(sessionId) {

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
            for (const ctt of lote) {
                duplicadas.delete(`${ctt.sessao_id}:${ctt.jid}`);
            }
            await Contato.SaveContatosBatch(lote);



        }

    } catch (err) {

        logger.error(err);

    } finally {

        saving.delete(sessionId);

        // chegaram novas mensagens enquanto salvava?
        if (batch.length > 0) {
            void flushContatos();
        }

    }

}