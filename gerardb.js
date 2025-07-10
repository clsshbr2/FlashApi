require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

async function checkAndInitDatabase() {
  const {
    MYSQL_HOST,
    MYSQL_PORT,
    MYSQL_USER,
    MYSQL_PASSWORD,
    MYSQL_DATABASE
  } = process.env;

  if (!MYSQL_HOST || !MYSQL_USER || !MYSQL_DATABASE) {
    console.error('⚠️ Variáveis de ambiente MySQL obrigatórias faltando!');
    process.exit(1);
  }

  let connection;
  try {
    // Conecta sem especificar database para garantir que o DB exista
    connection = await mysql.createConnection({
      host: MYSQL_HOST,
      port: MYSQL_PORT || 3306,
      user: MYSQL_USER,
      password: MYSQL_PASSWORD,
      multipleStatements: true
    });

    // Verifica se o database existe
    const [rows] = await connection.query('SHOW DATABASES LIKE ?', [MYSQL_DATABASE]);
    if (rows.length === 0) {
      await connection.query(`CREATE DATABASE \`${MYSQL_DATABASE}\``);
    }

    // Agora conecta direto ao database para executar o script
    await connection.changeUser({ database: MYSQL_DATABASE });

    // Lê arquivo SQL
    const sqlFilePath = path.resolve(__dirname, 'supabase/migrations/database.sql');
    const sql = fs.readFileSync(sqlFilePath, 'utf8');
    await connection.query(sql);
  } catch (error) {

  } finally {
    if (connection) await connection.end();
        console.log('Script SQL executado com sucesso! Banco pronto para uso.');
  }
}

checkAndInitDatabase();
