import { BufferJSON } from "@whiskeysockets/baileys";
import config from "../config/env.js";
import BaileysService from "../services/BaileysService.js";
import logger from "../utils/logger.js";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { execute } from "../config/database.js";
import redis, { KEYS } from "../services/redis.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Instância singleton do banco
let vezes = 0;
class Session {

  static async addsessao(dados) {
    try {
      const dadosInsert = {
        nome_sessao: dados.nome_sessao,
        apikey: dados.apikey,
        numero: dados.numero,
        webhook_url: dados.webhook_url,
        webhook_status: dados.webhook_status,
        events: JSON.stringify(dados.events),
        leitura_automatica: dados.leitura_automatica,
        rejeitar_ligacoes: dados.rejeitar_ligacoes,
        msg_rejectcalls: dados.msg_rejectcalls,
        ignorar_grupos: dados.ignorar_grupos
      };

      const colunas = Object.keys(dadosInsert);
      const valores = Object.values(dadosInsert);

      const placeholders = colunas
        .map((_, i) => `$${i + 1}`)
        .join(", ");

      const sql = `INSERT INTO sessao (${colunas.join(", ")}) VALUES (${placeholders})`
      const addsessao = await execute(sql, valores);

      //Adicionar proxy
      try {

        const proxy = {
          sessao_id: dados.apikey,
          protocol: dados?.proxy?.protocol || "http",
          username: dados?.proxy?.username || "teste",
          password: dados?.proxy?.password || "teste",
          host: dados?.proxy?.host || "127.0.0.1",
          port: dados?.proxy?.port || 8080,
          active: dados?.proxy?.active || false,
        }
        const proxyValues = Object.values(proxy)
        const proxyColunas = Object.keys(proxy)
        const placeholdersProxy = proxyColunas
          .map((_, i) => `$${i + 1}`)
          .join(", ");

        const sqlProxy = `INSERT INTO proxy (${proxyColunas.join(", ")}) VALUES (${placeholdersProxy})`
        await execute(sqlProxy, proxyValues);
      } catch (error) { console.log(error) }
      return addsessao;

    } catch (error) {
      return false
    }

  }

  static async findById(id) {
    const { rows } = await execute("SELECT * FROM sessao WHERE apikey = $1", [id]);
    return rows[0] || null;
  }

  static async findByName(nome_sessao) {
    const { rows } = await execute("SELECT * FROM sessao WHERE nome_sessao = $1", [nome_sessao]);
    return rows[0] || null;
  }

  static async findAllSessao() {
    const { rows } = await execute("SELECT * FROM sessao ORDER BY created_at DESC", []);
    return rows || [];
  }

  static async update(id, data) {
    const fields = [];
    const values = [];

    if (Object.prototype.hasOwnProperty.call(data, "status")) {
      values.push(data.status);
      fields.push(`status = $${values.length}`);
    }

    if (Object.prototype.hasOwnProperty.call(data, "qr_code")) {
      const qrValue = data.qr_code === "null" ? null : data.qr_code;
      values.push(qrValue);
      fields.push(`qrcode = $${values.length}`);
    }

    if (Object.prototype.hasOwnProperty.call(data, "phone_number")) {
      values.push(data.phone_number);
      fields.push(`numero = $${values.length}`);
    }

    if (Object.prototype.hasOwnProperty.call(data, "code")) {
      const codeValue = data.code === "null" ? null : data.code;
      values.push(codeValue);
      fields.push(`code = $${values.length}`);
    }

    fields.push("updated_at = CURRENT_TIMESTAMP");
    values.push(id);
    const upsessao = await execute(`UPDATE sessao SET ${fields.join(", ")} WHERE apikey = $${values.length}`, values);
    return upsessao.rowCount > 0;
  }

  //Deletar uma sessão
  static async delete(id, sessaodelete = true) {
    try {
      if (sessaodelete) {
        await execute(`DELETE FROM sessao WHERE apikey = $1`, [id]);
      }
      await execute(`DELETE FROM wa_session_keys WHERE sessao_id = $1`, [id]);
      await execute(`DELETE FROM chats WHERE sessao_id = $1`, [id]);
      await execute(`DELETE FROM contatos WHERE sessao_id = $1`, [id]);
      await execute(`DELETE FROM grupos WHERE sessao_id = $1`, [id]);
      await execute(`DELETE FROM mensagens WHERE sessao_id = $1`, [id]);
      await execute(`DELETE FROM proxy WHERE sessao_id = $1`, [id]);
      // Provider zapo: remove também as credenciais/chaves guardadas pela zapo.
      if (config.waProvider === "zapo") {
        const { limparDadosSessaoZapo } = await import("../providers/zapo/store.js");
        await limparDadosSessaoZapo(id);
      }
      await BaileysService.DeleteSessao(id)
      try {
        const sock = BaileysService.sockets.get(id);
        sock?.end();
      } catch (error) { }
      finally {
        BaileysService.sockets.delete(id);
        BaileysService.countQrcode.delete(id);
        BaileysService.limitReconnect.delete(id);
      }
      await execute(`UPDATE sessao SET status = $1 WHERE apikey = $2`, ['disconnected', id])

    } catch (error) {
      logger.error('Erro ao deletar sessão: ')
      logger.error(error)
    } finally {
      return true;
    }

  }

  static async setProxy(session, proxy) {
    const { rows } = await execute(`SELECT sessao_id FROM proxy WHERE sessao_id = $1`, [session]);
    if (rows[0]?.sessao_id) {
      return await execute(
        `UPDATE proxy SET host = $1, port = $2, protocol = $3, username = $4, password = $5, active = $6 WHERE sessao_id = $7`,
        [proxy.host, proxy.port, proxy.protocol, proxy.username, proxy.password, proxy.active, session],
      );
    } else {
      return await execute(
        `INSERT INTO proxy (host, port, protocol, username, password, active, sessao_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [proxy.host, proxy.port, proxy.protocol, proxy.username, proxy.password, proxy.active, session],
      );
    }
  }

  static async getProxy(session) {
    const { rows } = await execute(`SELECT host, port, protocol, username, password, active FROM proxy WHERE sessao_id = $1`, [session]);
    return rows[0] || {};
  }

  static async GetCreds(session) {
    const { rows } = await execute(`SELECT value_json FROM wa_session_keys WHERE sessao_id = $1`, [session]);
    return rows[0] || null;
  }

  static async setCreds(session, value_json) {
    try {
      /** @type {import("@whiskeysockets/baileys").WASocket} */
      const sock = BaileysService.sockets.get(session);
      const { rows } = await execute(`SELECT value_json, key_id FROM wa_session_keys WHERE sessao_id = $1 AND key_id = $2`, [session, 'creds']);
      if (rows.length > 0) {
        if (sock) { }
        await this.delete(session, false)
        try { sock.end(); } catch (error) { /*ignore*/ }
      }
      const teste = await execute(
        `INSERT INTO wa_session_keys (value_json, sessao_id, key_id) VALUES ($1, $2, $3)`,
        [JSON.stringify(value_json), session, 'creds'],
      );

      if (teste.rowCount > 0) {
        try { BaileysService.createSession(session, null) } catch (error) { /*ignore*/ }
        return { success: true, message: "Sessão injetada com susesso" }
      } else {
        return { success: false, message: "Erro ao injetar sessão" }
      }
    } catch (error) {
      return { success: false, message: "Erro ao injetar sessão", error }
    }

  }



}

export default Session;
