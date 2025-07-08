const Database = require("../config/database");
const config = require("../config/env");

// Instância singleton do banco
const db = new Database();

class Session {

  static async addsessao(dados) {
    const addsessao = await db.execute('INSERT INTO sessao (apikey, numero, nome_sessao) VALUES (?, ?, ?)', [dados.uuid, dados.numero, dados.finalNomeSessao]);
    return addsessao.affectedRows > 0
  }

  static async findById(id) {
    const [getsessao] = await db.execute('SELECT * FROM sessao WHERE apikey = ?', [id])
    return getsessao
  }

  static async findByApiKey() {
    const getsessoes = await db.execute('SELECT * FROM sessao ORDER BY created_at DESC', [])
    return getsessoes

  }

  static async update(id, data) {
    const fields = [];
    const values = [];

    const status = data.status || null
    const qr_code = data.qr_code || null
    const phone_number = data.phone_number || null

    if (status) {
      fields.push('status = ?');
      values.push(status);
    }

    if (qr_code) {
      fields.push('qrcode = ?');
      values.push(qr_code);
    }

    if (phone_number) {
      fields.push('numero = ?');
      values.push(phone_number);
    }

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const upsessao = await db.execute(`UPDATE sessao SET ${fields.join(', ')} WHERE apikey = ?`, values)
    return upsessao.affectedRows > 0
  }

  static async delete(id) {
    const deletesessao = await db.execute(`DELETE FROM sessao WHERE apikey = ?`, [id])
    return deletesessao
  }
}

module.exports = Session;