const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'saude',
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true,
});

// Conexão ociosa morre quando o MySQL reinicia, expira por wait_timeout ou a
// rede pisca. O mysql2 reemite isso no próprio pool: sem um listener, o Node
// lança "Unhandled 'error' event" e o processo INTEIRO morre. Não há
// uncaughtException em lugar nenhum para segurar isso.
pool.on('error', (err) => {
  console.error(`Erro na conexão do pool MySQL [${err.code || 'SEM_CODIGO'}]:`, err.message);
  // Não tentamos reconectar aqui: o mysql2 já marca a conexão como morta e o
  // próximo acquire() cria outra. A tentativa aqui competiria com ele.
});

module.exports = pool;
