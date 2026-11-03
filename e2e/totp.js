import { createRequire } from 'node:module';
import { resolve } from 'node:path';

/**
 * Apoio dos testes e2e ao segundo fator (ADR-0010): atendente e admin só usam o painel com MFA ativo,
 * então o login deles passa por um código TOTP. O código vem da MESMA função do servidor.
 *
 * Replay: o servidor só aceita um passo TOTP maior que o último usado. Vários testes entram com a mesma
 * conta no mesmo passo de 30 s, então antes de cada login zeramos `totp_last_step` no banco. Isso mexe
 * no banco do teste, por isso recusa o banco de desenvolvimento (`saude`): rode o e2e em banco descartável.
 */
const SERVER = resolve(__dirname, '..', 'server');
const doServidor = createRequire(resolve(SERVER, 'package.json'));

export const { totpNow } = doServidor('./src/utils/totp');

export async function zerarUltimoPasso(email) {
  const banco = process.env.DB_NAME || 'saude';
  if (banco === 'saude') {
    throw new Error('[e2e] os testes com MFA zeram totp_last_step no banco: rode em banco descartável (DB_NAME diferente de "saude").');
  }
  const mysql = doServidor('mysql2/promise');
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: banco,
  });
  try {
    await conn.query('UPDATE users SET totp_last_step = NULL WHERE email = ?', [email]);
  } finally {
    await conn.end();
  }
}