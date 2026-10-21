
import { execute } from '../config/database.js';
import { getMessageType } from '../services/AcoesEventos/Message.js';
import WhatsAppService from '../services/WhatsAppService.js';
import logger from '../utils/logger.js';

// Instância singleton do banco

class Message {

    static async getMessages(key) {
        try {
            const { rows } = await execute(`SELECT * FROM mensagens WHERE sessao_id = $1`, [key]);
            return rows || [];
        } catch (error) {
            logger.error('Erro ao buscar mensagens: ', error)
            return []
        }
    }

    static async getMessage(key, id) {
        try {
            const { rows } = await execute(`SELECT * FROM mensagens WHERE sessao_id = $1 AND mensagem_id = $2`, [key, id]);
            return rows[0] || null;
        } catch (error) {
            logger.error('Erro ao buscar mensagem: ', error)
            return null
        }
    }

    static async SaveMessage(dados) {
        try {
            let jid = dados?.key?.remoteJid || null
            let participant = dados?.key?.participant || null

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

            const colunas = Object.keys(dadosInsert);
            const valores = Object.values(dadosInsert);

            const placeholders = colunas
                .map((_, i) => `$${i + 1}`)
                .join(", ");

            const sql = `INSERT INTO mensagens (${colunas.join(", ")}) VALUES (${placeholders}) ON CONFLICT (sessao_id, mensagem_id)
             DO UPDATE SET
                conteudo_mensagem = EXCLUDED.conteudo_mensagem`
            const addsessao = await execute(sql, valores);

        } catch (error) {
            logger.error("Erro ao salvar message: ", error)
        }
    }

    static async SaveMessageBatch(mensagens) {
        try {

            const colunas = [
                "sessao_id",
                "mensagem_id",
                "remotejid",
                "fromme",
                "isgrupo",
                "participant",
                "tipo_mensagem",
                "conteudo_mensagem",
                "status"
            ];
            const values = [];
            const placeholders = [];
            let index = 1;
            const vistos = new Set();

            for (const msg of mensagens) {
                const key = `${msg.sessao_id}:${msg.mensagem_id}`;
                if (vistos.has(key)) {
                    logger.info(`MEssage duplicada ignorando: `, key)
                    continue;
                }
                vistos.add(key);
                const campos = [
                    msg.sessao_id,
                    msg.mensagem_id,
                    msg.remotejid,
                    msg.fromme,
                    msg.isgrupo,
                    msg.participant,
                    msg.tipo_mensagem,
                    msg.conteudo_mensagem,
                    msg.status
                ]

                placeholders.push(
                    `(${campos.map(() => `$${index++}`).join(", ")})`
                );
                values.push(...campos);
            }

            const sql = `
                INSERT INTO mensagens (${colunas.join(", ")})
                VALUES
                    ${placeholders.join(",\n")}
                ON CONFLICT (sessao_id, mensagem_id)
                DO UPDATE SET
                    conteudo_mensagem = EXCLUDED.conteudo_mensagem
            `;

            const result = await execute(sql, values);

        } catch (error) {
            logger.error("Erro ao salvar message: ", error)
        }
    }

}

export default Message;