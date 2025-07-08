const mysql = require('mysql2/promise');
const logger = require('../utils/logger');
const config = require('./env');

class Database {
    constructor() {
        if (Database.instance) {
            return Database.instance;
        }

        this.pool = mysql.createPool({
            host: config.host || 'localhost',
            user: config.user || 'root',
            password: config.password || '',
            database: config.database || 'FlashApi',
            waitForConnections: true,
            connectionLimit: config.connectionLimit || 10, // Reduzido para 10
            queueLimit: config.queuelimit || 0
        });

        // Log de eventos do pool
        this.pool.on('connection', (connection) => {
            logger.debug(`Nova conexão MySQL estabelecida: ${connection.threadId}`);
        });

        this.pool.on('error', (err) => {
            logger.error('Erro no pool MySQL:', err);
        });

        Database.instance = this;
    }

    async execute(sql, parameters = []) {
        let connection;
        try {
            connection = await this.pool.getConnection();
            const [rows] = await connection.execute(sql, parameters);
            return rows;
        } catch (err) {
            logger.error('Erro ao executar a consulta:', err);
            throw err; // Re-throw para que o erro seja tratado pelo chamador
        } finally {
            if (connection) {
                connection.release(); // Sempre liberar a conexão
            }
        }
    }

    async getPoolStatus() {
        return {
            totalConnections: this.pool.pool._allConnections.length,
            freeConnections: this.pool.pool._freeConnections.length,
            acquiringConnections: this.pool.pool._acquiringConnections.length,
            connectionLimit: this.pool.config.connectionLimit
        };
    }

    async close() {
        try {
            await this.pool.end();
            logger.info('Pool de conexões MySQL encerrado.');
            Database.instance = null;
        } catch (err) {
            logger.error('Erro ao encerrar o pool de conexões MySQL:', err);
        }
    }
}

// Singleton instance
Database.instance = null;

module.exports = Database;