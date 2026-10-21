
import { execute } from '../config/database.js';
import WhatsAppService from '../services/WhatsAppService.js';
import logger from '../utils/logger.js';

// Instância singleton do banco

class Contato {


    static async SaveContatos(dados) {
        try {
            let jid = dados?.phoneNumber?.endsWith("@s.whatsapp.net") ? dados?.phoneNumber : (dados.id.endsWith("@s.whatsapp.net") ? dados.id : (dados.lid ? dados.lid : dados.id))
            const name = dados?.name ? dados?.name : (dados.username ? dados.username : null)

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

            const dadosInsert = {
                sessao_id: dados.sessionId,
                jid: jid || null,
                nome: name,
                apelido: dados?.apelido || name,
                nome_verificado: dados?.nome_verificado || name,
                url_imagem: dados?.url_imagem || null,
                status_contato: null,
            };

            const colunas = Object.keys(dadosInsert);
            const valores = Object.values(dadosInsert);

            const placeholders = colunas
                .map((_, i) => `$${i + 1}`)
                .join(", ");

            const sql = `
            INSERT INTO contatos (${colunas.join(", ")})
            VALUES (${placeholders})
            ON CONFLICT (sessao_id, jid)
            DO UPDATE SET
                nome = COALESCE(EXCLUDED.nome, contatos.nome),
                apelido = COALESCE(EXCLUDED.apelido, contatos.apelido),
                nome_verificado = COALESCE(EXCLUDED.nome_verificado, contatos.nome_verificado),
                url_imagem = EXCLUDED.url_imagem,
                updated_at = CURRENT_TIMESTAMP
            `;
            const addsessao = await execute(sql, valores);

        } catch (error) {
            logger.error("Erro ao salvar Contato: ", error)
        }
    }

    static async SaveContatosBatch(contatos) {
        try {

            const colunas = [
                "sessao_id",
                "jid",
                "nome",
                "apelido",
                "nome_verificado",
                "url_imagem",
                "status_contato"
            ];
            const values = [];
            const placeholders = [];
            let index = 1;
            const vistos = new Set();

            for (const msg of contatos) {
                const key = `${msg.sessao_id}:${msg.jid}`;
                if (vistos.has(key)) {
                    logger.info(`Contatos duplicado ignorando: `, key)
                    continue;
                }
                vistos.add(key);
                const colunas = [
                    msg.sessao_id,
                    msg.jid,
                    msg.nome,
                    msg.apelido,
                    msg.nome_verificado,
                    msg.url_imagem,
                    msg.status_contato
                ]
                placeholders.push(
                    `(${colunas.map(() => `$${index++}`).join(', ')})`
                );

                values.push(...colunas);
            }
            const sql = `
            INSERT INTO contatos (${colunas.join(", ")})
            VALUES 
                ${placeholders.join(",\n")}
                ON CONFLICT (sessao_id, jid)
                DO UPDATE SET
                    nome = COALESCE(EXCLUDED.nome, contatos.nome),
                    apelido = COALESCE(EXCLUDED.apelido, contatos.apelido),
                    nome_verificado = COALESCE(EXCLUDED.nome_verificado, contatos.nome_verificado),
                    url_imagem = EXCLUDED.url_imagem,
                    updated_at = CURRENT_TIMESTAMP
            `;
            const result = await execute(sql, values);

        } catch (error) {
            logger.error("Erro ao salvar message: ", error)
        }
    }

}

export default Contato;