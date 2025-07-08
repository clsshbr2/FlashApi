const Database = require('../config/database');
const config = require('../config/env');
const logger = require('../utils/logger');

// Instância singleton do banco
const db = new Database();

class Chats {

  static async getchats(key) {
    try {
      const getchats = await db.execute(`SELECT * FROM mensagens WHERE sessao_id = ?`, [key]);
      return getchats
    } catch (error) {
      logger.error('Erro ao buscar mensagens: ', error)
      return []
    }
  }

  static async getchat(key, id) {
    try {
      const [getchat] = await db.execute(`SELECT * FROM mensagens WHERE sessao_id = ? AND mensagem_id = ?`, [key, id]);
      return getchat
    } catch (error) {
      logger.error('Erro ao buscar mensagem: ', error)
      return null
    }
  }

  static async salvachat(key, dados) {
    try {
      await db.execute(`INSERT INTO mensagens (sessao_id, mensagem_id, remoteJid, fromMe, isgrupo, participant, conteudo_mensagem) VALUES (?, ?, ?, ?, ?, ?, ?)`, 
        [key, dados.mensagem_id, dados.remoteJid, dados.fromMe, dados.isgrupo, dados.participant, dados.message]);
    } catch (error) {
      logger.error('Erro ao salvar mensagem: ', error)
      return null
    }
  }
}

module.exports = Chats;