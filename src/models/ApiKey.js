const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const Database = require('../config/database');
const config = require('../config/env');
const logger = require('../utils/logger');

// Instância singleton do banco
const db = new Database();

class ApiKey {

  static async findByKey(key) {
    try {
      const [getapikey] = await db.execute(`SELECT * FROM sessao WHERE active = 1 AND apikey = ?`, [key]);
      return getapikey
    } catch (error) {
      logger.error('Erro ao buscar sessao: ', error)
      return false
    }
  }

  static async list() {
    try {
      const getapikeys = await db.execute(`SELECT apikey, nome_sessao, active, created_at, updated_at FROM sessao ORDER BY created_at DESC`, []);
      return getapikeys
    } catch (error) {
      logger.error('Erro ao buscar sessao')
      return false
    }

  }

  static async deactivate(id) {
    try {
      const desativarkey = await db.execute('UPDATE api_keys SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE apikey = ?', [id])
      return desativarkey.affectedRows > 0
    } catch (error) {
      logger.error('Erro ao buscar desativar sessao')
      return false
    }

  }

}

module.exports = ApiKey;