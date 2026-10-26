#!/usr/bin/env node
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const pool = require('../src/db');

async function main() {
  const conn = await pool.getConnection();
  try {
    const [cols] = await conn.query("SHOW COLUMNS FROM professionals LIKE 'user_id'");
    if (cols.length === 0) {
      await conn.query('ALTER TABLE professionals ADD COLUMN user_id CHAR(36) NULL AFTER active');
      console.log('coluna user_id adicionada');
    } else {
      console.log('coluna user_id já existe');
    }
    try {
      await conn.query('ALTER TABLE professionals ADD CONSTRAINT fk_professionals_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL');
      console.log('FK adicionada');
    } catch (e) {
      if (/Duplicate key|exists/i.test(e.message)) console.log('FK já existe');
      else console.log('FK:', e.message);
    }
    try {
      await conn.query('CREATE UNIQUE INDEX uq_professionals_user ON professionals (user_id)');
      console.log('UNIQUE adicionada');
    } catch (e) {
      if (/Duplicate key|exists/i.test(e.message)) console.log('UNIQUE já existe');
      else console.log('UNIQUE:', e.message);
    }
    console.log('migrate:professional-user-link concluída');
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
