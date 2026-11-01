/**
 * Recuperação de senha.
 *
 * O risco desta funcionalidade não é o token: é responder de forma diferente
 * para "e-mail não existe" e "e-mail existe". A resposta precisa ser a mesma
 * nos dois casos, senão a rota vira um enumerador de contas — e este é um
 * sistema de saúde, onde saber quem tem conta já é informação sensível.
 *
 * O token segue o mesmo desenho do `refresh_tokens`: só o SHA-256 vai para o
 * banco. Um dump da base não permite forjar um link de redefinição.
 *
 * As regras medidas aqui:
 *   - resposta idêntica exista ou não a conta (sem enumeração);
 *   - o token cru nunca é gravado, só o hash;
 *   - o token é de uso único e expira;
 *   - redefinir a senha derruba as sessões abertas (refresh tokens), senão um
 *     token roubado sobrevive à troca de senha que a vítima fez para expulsar
 *     quem roubou;
 *   - o e-mail do link não pode ser montado a partir de entrada do usuário.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs');

const ROOT = path.resolve(__dirname, '..', '..');
const SERVER = path.join(ROOT, 'server');
const { rewriteSchemaForDb } = require('../../scripts/db-setup');

const DB = `saude_reset_senha_${process.pid}`;

require(require.resolve('dotenv', { paths: [SERVER] })).config({ path: path.join(SERVER, '.env') });

const CFG = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  charset: 'utf8mb4',
};

process.env.DB_NAME = DB;

const mysql = require(require.resolve('mysql2/promise', { paths: [SERVER] }));
const pool = require('../src/db');
const bcrypt = require(require.resolve('bcryptjs', { paths: [SERVER] }));
const app = require('../src/app');
const mailer = require('../src/services/mailer');

const ALVO = '00000000-0000-4000-8000-0000000e1001';
const SENHA_NOVA = 'senha-nova-bem-forte-123';
const SHA = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

let server;
let baseUrl;
let enviados;

async function req(metodo, caminho, corpo) {
  const res = await fetch(baseUrl + caminho, {
    method: metodo,
    headers: { 'content-type': 'application/json' },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** Dublê do transporte que guarda o que teria sido enviado. */
function dublarMailer() {
  enviados = [];
  mailer.enviar = async (msg) => { enviados.push(msg); return { enviado: true }; };
}

test.before(async () => {
  const admin = await mysql.createConnection({ ...CFG, multipleStatements: true });
  await admin.query(`DROP DATABASE IF EXISTS \`${DB}\``);
  await admin.query(`CREATE DATABASE \`${DB}\` CHARACTER SET utf8mb4`);
  await admin.query(
    rewriteSchemaForDb(fs.readFileSync(path.join(SERVER, 'schema.sql'), 'utf8'), DB)
  );
  await admin.end();

  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  await pool.query(
    `INSERT INTO users (id, full_name, email, password_hash, role, account_status)
     VALUES (?, 'Alvo Teste', 'alvo@test.local', ?, 'paciente', 'ativo')`,
    [ALVO, await bcrypt.hash('senha-antiga-123', 4)]
  );

  // Uma sessão aberta, para verificar que a troca de senha a derruba.
  await pool.query(
    `INSERT INTO refresh_tokens (id, user_id, token_hash, family, expires_at)
     VALUES (?,?,?,?, DATE_ADD(NOW(), INTERVAL 30 DAY))`,
    [crypto.randomUUID(), ALVO, SHA('sessao-antiga'), crypto.randomUUID()]
  );

  dublarMailer();
});

/**
 * O token que vale é o único com `used_at IS NULL`: cada pedido novo marca
 * os anteriores como usados. Buscar por `ORDER BY created_at DESC` seria
 * frágil — a coluna tem granularidade de segundo, e dois pedidos no mesmo
 * segundo empatam.
 */
const TOKEN_VIVO = 'SELECT token_hash, id, used_at FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL';

test.after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await pool.end().catch(() => {});
  const admin = await mysql.createConnection(CFG);
  await admin.query(`DROP DATABASE IF EXISTS \`${DB}\``).catch(() => {});
  await admin.end().catch(() => {});
});

test('e-mail existente e inexistente recebem a MESMA resposta', async () => {
  const existe = await req('POST', '/auth/password/forgot', { email: 'alvo@test.local' });
  const naoExiste = await req('POST', '/auth/password/forgot', { email: 'ninguem@test.local' });

  assert.equal(existe.status, naoExiste.status, 'status diferente já enumera contas');
  assert.deepEqual(existe.body, naoExiste.body, 'corpo diferente já enumera contas');
});

test('pedir recuperação grava SÓ o hash do token', async () => {
  await req('POST', '/auth/password/forgot', { email: 'alvo@test.local' });

  const [linhas] = await pool.query(TOKEN_VIVO, [ALVO]);
  assert.equal(linhas.length, 1, 'um token vivo por pedido — os anteriores foram invalidados');
  assert.equal(linhas[0].token_hash.length, 64, 'é um SHA-256 em hex');

  // O que foi enviado não pode bater com o que está no banco.
  const link = enviados[enviados.length - 1].texto;
  assert.ok(!link.includes(linhas[0].token_hash), 'o e-mail não deveria conter o hash');
  assert.ok(enviados.length >= 1, 'um e-mail foi enviado para quem tem conta');
});

test('o e-mail traz um link com o token, e só para quem pediu', async () => {
  enviados = [];
  await req('POST', '/auth/password/forgot', { email: 'alvo@test.local' });
  await req('POST', '/auth/password/forgot', { email: 'ninguem@test.local' });

  assert.equal(enviados.length, 1, 'não se envia e-mail para conta inexistente');
  assert.equal(enviados[0].para, 'alvo@test.local');

  // O link aponta para a rota do front React (/auth), não para o auth.html aposentado:
  // com a rota errada o e-mail chegaria e o clique cairia numa página que não existe.
  assert.match(enviados[0].texto, /\/auth\?tab=reset&token=/);
  assert.doesNotMatch(enviados[0].texto, /auth\.html/);

  // O token do link é o bruto; o banco tem o hash dele.
  const m = enviados[0].texto.match(/token=([a-f0-9]+)/);
  assert.ok(m, `o link precisa trazer o token; texto: ${enviados[0].texto}`);
  const [[grava]] = await pool.query(TOKEN_VIVO, [ALVO]);
  assert.equal(SHA(m[1]), grava.token_hash, 'o token do link é o pré-imagem do hash guardado');
});

test('o token funciona uma vez e só uma', async () => {
  await req('POST', '/auth/password/forgot', { email: 'alvo@test.local' });
  const m = enviados[enviados.length - 1].texto.match(/token=([a-f0-9]+)/);
  const token = m[1];

  const primeiro = await req('POST', '/auth/password/reset', { token, password: SENHA_NOVA });
  assert.equal(primeiro.status, 200, `a primeira redefinição tem que passar: ${JSON.stringify(primeiro.body)}`);

  const segundo = await req('POST', '/auth/password/reset', { token, password: 'outra-senha-123' });
  assert.equal(segundo.status, 401, 'reaproveitar o mesmo link é o ataque clássico');
});

test('redefinir a senha derruba as sessões abertas', async () => {
  // O ponto do teste: quem roubou o token pode estar com uma sessão ativa.
  // Se a redefinição não derrubar o refresh, o roubo continua valendo
  // mesmo depois de a vítima trocar a senha — que é exatamente para isso que
  // ela troca.
  await req('POST', '/auth/password/forgot', { email: 'alvo@test.local' });
  const m = enviados[enviados.length - 1].texto.match(/token=([a-f0-9]+)/);
  await req('POST', '/auth/password/reset', { token: m[1], password: 'senha-para-teste-123456' });

  const [[n]] = await pool.query(
    'SELECT COUNT(*) AS n FROM refresh_tokens WHERE user_id = ? AND revoked = 0', [ALVO]
  );
  assert.equal(n.n, 0, 'nenhuma sessão pode sobreviver à troca de senha');
});

test('a senha antiga deixa de funcionar depois da redefinição', async () => {
  await req('POST', '/auth/password/forgot', { email: 'alvo@test.local' });
  const m = enviados[enviados.length - 1].texto.match(/token=([a-f0-9]+)/);
  await req('POST', '/auth/password/reset', { token: m[1], password: SENHA_NOVA });

  const login = await req('POST', '/auth/login', { email: 'alvo@test.local', password: 'senha-antiga-123' });
  assert.equal(login.status, 401, 'a senha antiga tem que estar morta');
});

test('a senha nova funciona', async () => {
  const login = await req('POST', '/auth/login', { email: 'alvo@test.local', password: SENHA_NOVA });
  assert.equal(login.status, 200, `a senha nova tem que entrar: ${JSON.stringify(login.body)}`);
});

test('token expirado é recusado', async () => {
  await req('POST', '/auth/password/forgot', { email: 'alvo@test.local' });
  const [[t]] = await pool.query(TOKEN_VIVO, [ALVO]);
  await pool.query('UPDATE password_reset_tokens SET expires_at = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE id = ?', [t.id]);

  const m = enviados[enviados.length - 1].texto.match(/token=([a-f0-9]+)/);
  const r = await req('POST', '/auth/password/reset', { token: m[1], password: 'outra-boa-123456' });
  assert.equal(r.status, 401, 'token vencido não pode redefinir');
});

test('token inválido ou ausente é recusado sem quebrar', async () => {
  assert.equal((await req('POST', '/auth/password/reset', { password: 'x-123456-789' })).status, 401);
  assert.equal((await req('POST', '/auth/password/reset', { token: 'nao-existe', password: 'x-123456-789' })).status, 401);
  assert.equal((await req('POST', '/auth/password/reset', {})).status, 401);
});

test('a senha nova é recusada se for curta', async () => {
  await req('POST', '/auth/password/forgot', { email: 'alvo@test.local' });
  const m = enviados[enviados.length - 1].texto.match(/token=([a-f0-9]+)/);
  const r = await req('POST', '/auth/password/reset', { token: m[1], password: '123' });
  assert.equal(r.status, 400, 'senha curta tem que ser recusada com 400');
  // E o token continua válido: uma recusa de validação não deve queimar o link.
  const [[ainda]] = await pool.query(TOKEN_VIVO, [ALVO]);
  assert.ok(ainda, 'o token tem que continuar vivo — erro de digitação não pode queimar o link');
});

test('a redefinição fica registrada na auditoria', async () => {
  // Sem registro, um reset é exatamente o tipo de evento que um admin
  // precisa ver depois.
  const [[n]] = await pool.query(
    `SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'password_reset%' AND entity_id = ?`, [ALVO]
  );
  assert.ok(n.n >= 1, 'o pedido e a redefinição precisam ser auditados');
});

test('conta desativada não recebe link', async () => {
  await pool.query("UPDATE users SET account_status = 'inativo' WHERE id = ?", [ALVO]);
  enviados = [];
  await req('POST', '/auth/password/forgot', { email: 'alvo@test.local' });
  assert.equal(enviados.length, 0, 'conta desativada não deve receber link de recuperação');
  await pool.query("UPDATE users SET account_status = 'ativo' WHERE id = ?", [ALVO]);
});