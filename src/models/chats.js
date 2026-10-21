
import { execute } from '../config/database.js';
import logger from '../utils/logger.js';

// Instância singleton do banco

class Chats {

  static async SaveChats(dados) {
    try {
      let jid = dados?.id || null
      let participant = dados?.key?.participant || null
      const eh_grupo = jid?.endsWith("@g.us") ? true : false

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
        jid: jid,
        nome: dados?.name || dados?.displayName || "Sem nome",
        eh_grupo,
        mensagens_nao_lidas: parseInt(dados?.unreadCount) || 0,
        arquivado: dados?.archived || false,
        fixado: dados.pinned || false,
        dados: JSON.stringify(dados)
      };

      const colunas = Object.keys(dadosInsert);
      const valores = Object.values(dadosInsert);

      const placeholders = colunas
        .map((_, i) => `$${i + 1}`)
        .join(", ");

      const sql = `INSERT INTO chats (${colunas.join(", ")}) VALUES (${placeholders}) ON CONFLICT (sessao_id, jid)
             DO UPDATE SET
                dados = EXCLUDED.dados,
                nome = EXCLUDED.nome,
                eh_grupo = EXCLUDED.eh_grupo,
                mensagens_nao_lidas = EXCLUDED.mensagens_nao_lidas,
                arquivado = EXCLUDED.arquivado,
                fixado = EXCLUDED.fixado`
      const addsessao = await execute(sql, valores);

    } catch (error) {
      logger.error("Erro ao salvar message: ", error)
    }
  }

  static async SaveChatsBatch(chats) {
    try {

      const colunas = [
        "sessao_id",
        "jid",
        "nome",
        "eh_grupo",
        "mensagens_nao_lidas",
        "arquivado",
        "fixado",
        "dados",
      ];
      const values = [];
      const placeholders = [];
      let index = 1;
      const vistos = new Set();

      for (const msg of chats) {
        const key = `${msg.sessao_id}:${msg.jid}`;
        if (vistos.has(key)) {
          logger.info(`Chats duplicado ignorando: `, key)
          continue;
        }
        vistos.add(key);
        const campos = [
          msg.sessao_id,
          msg.jid,
          msg.nome,
          msg.eh_grupo,
          msg.mensagens_nao_lidas,
          msg.arquivado,
          msg.fixado,
          msg.dados
        ]

        placeholders.push(
          `(${campos.map(() => `$${index++}`).join(", ")})`
        );
        values.push(...campos);
      }
      const sql = `
        INSERT INTO chats (${colunas.join(", ")})
        VALUES
            ${placeholders.join(",\n")}
              ON CONFLICT (sessao_id, jid)
              DO UPDATE SET
                dados = EXCLUDED.dados,
                nome = EXCLUDED.nome,
                eh_grupo = EXCLUDED.eh_grupo,
                mensagens_nao_lidas = EXCLUDED.mensagens_nao_lidas,
                arquivado = EXCLUDED.arquivado,
                fixado = EXCLUDED.fixado
      `;

      const result = await execute(sql, values);

    } catch (error) {
      logger.error("Erro ao salvar message: ", error)
    }
  }

  static async FindChatsAll({ sessionId, page = 1, limit = 50, search = "" }) {
    try {

      const offset = (page - 1) * limit;

      let where = `WHERE sessao_id = $1`;
      const params = [sessionId];

      if (search) {
        params.push(`%${search}%`);
        where += ` AND (
                nome ILIKE $${params.length}
                OR jid ILIKE $${params.length}
            )`;
      }

      params.push(limit);
      params.push(offset);

      const sql = `
            SELECT *
            FROM chats
            ${where}
            ORDER BY jid DESC NULLS LAST
            LIMIT $${params.length - 1}
            OFFSET $${params.length}
        `;

      const chats = await execute(sql, params);

      const totalSql = `
            SELECT COUNT(*) AS total
            FROM chats
            ${where}
        `;

      const total = await execute(totalSql, params.slice(0, params.length - 2));
      console.log(total)
      return {
        page,
        limit,
        total: Number(total?.rows[0]?.total) || 0,
        pages: Math.ceil(Number(total?.rows[0]?.total || 0) / limit),
        data: chats.rows
      };

    } catch (error) {
      logger.error("Erro ao buscar chats", error);

      return {
        page,
        limit,
        total: 0,
        pages: 0,
        data: []
      };
    }
  }

}

export default Chats;