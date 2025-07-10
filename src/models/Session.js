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

  static async findByName(nome_sessao) {
    const [getsessao] = await db.execute('SELECT * FROM sessao WHERE nome_sessao = ?', [nome_sessao])
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
    const code = data.code || null

    if (status) {
      fields.push('status = ?');
      values.push(status);
    }

    if (qr_code) {
      fields.push('qrcode = ?');
      values.push(qr_code == 'null' ? null : qr_code);
    }

    if (phone_number) {
      fields.push('numero = ?');
      values.push(phone_number);
    }

    if (code) {
      fields.push('code = ?');
      values.push(code == 'null' ? null : code);
    }

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(id);

    const upsessao = await db.execute(`UPDATE sessao SET ${fields.join(', ')} WHERE apikey = ?`, values)
    return upsessao.affectedRows > 0
  }

  static async saveCreds(id, creds) {
    try {

      const saveCreds = await db.execute('UPDATE sessao SET creds = ?, updated_at = CURRENT_TIMESTAMP WHERE apikey = ?', [creds, id]);
      return saveCreds.affectedRows > 0;
    } catch (error) {

      console.error('Erro ao salvar credenciais:', error);
      return false;
    }
  }

  static async delete(id) {
    const deletesessao = await db.execute(`DELETE FROM sessao WHERE apikey = ?`, [id])
    await db.execute(`DELETE FROM chats WHERE sessao_id = ?`, [id])
    await db.execute(`DELETE FROM contatos WHERE sessao_id = ?`, [id])
    await db.execute(`DELETE FROM grupos WHERE sessao_id = ?`, [id])
    await db.execute(`DELETE FROM mensagens WHERE sessao_id = ?`, [id])
    return deletesessao
  }

}

module.exports = Session;