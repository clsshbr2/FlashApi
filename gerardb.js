import dotenv from 'dotenv';
import { resolve } from 'path';
import fs from 'fs';
import path from 'path';
import { Client } from 'pg';
import { fileURLToPath } from 'url';
import logger from './src/utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: resolve('.env') });
const dbType = process.env.DB_TYPE || 'postgres';

export async function checkAndInitDatabase() {
  const {
    DB_HOST,
    DB_PORT,
    DB_USER,
    DB_PASSWORD,
    DB_DATABASE
  } = process.env;

  if (!DB_HOST || !DB_USER || !DB_DATABASE) {
    logger.error('⚠️ Variáveis de ambiente do banco obrigatórias faltando!');
    process.exit(1);
  }

  let connection;
  let client;
  try {
    // PostgreSQL
    // Conecta ao banco padrão
    client = new Client({
      host: DB_HOST,
      port: DB_PORT || 5432,
      user: DB_USER,
      password: DB_PASSWORD,
      database: 'postgres'
    });

    await client.connect();

    // Verifica se o database existe
    const res = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [DB_DATABASE]);
    if (res.rows.length === 0) {
      const rex = /^[a-zA-Z0-9_]+$/
      if (!rex.test(DB_DATABASE)) {
        logger.error(`Nome do banco de dados "${DB_DATABASE}" não é permitido.`);
        process.exit(1)
      }
      await client.query(`CREATE DATABASE "${DB_DATABASE}"`);
      logger.info(`Banco "${DB_DATABASE}" criado.`);
    } else {
      logger.info(`Banco "${DB_DATABASE}" já existe.`);
    }

    await client.end();

    // Agora conecta ao DB certo para rodar o script
    client = new Client({
      host: DB_HOST,
      port: DB_PORT || 5432,
      user: DB_USER,
      password: DB_PASSWORD,
      database: DB_DATABASE
    });
    await client.connect();

    const sqlFilePath = path.resolve(__dirname, 'supabase/migrations/postgres.sql');
    const sql = fs.readFileSync(sqlFilePath, 'utf8');
    await client.query(sql);

    logger.info('Script SQL executado com sucesso! Banco pronto para uso.');
  } catch (error) {
    logger.error('Erro ao preparar o banco:', error);
  } finally {
    if (client) await client.end();
  }
}