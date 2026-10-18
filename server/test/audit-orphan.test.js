/**
 * A listagem de auditoria lia `audit_log` com `JOIN users` (INNER). A
 * `actor_id` é ON DELETE RESTRICT, então essa linha "órfã" só aparece se um
 * ator sumir por carga de dump restaurada ou inconsistência antiga.
 *
 * Quando aparecia, o efeito era pior que um bug de tela: o `verifyChain`
 * (que não usa join) contava a linha na cadeia, mas a listagem a escondia.
 * Admin e verificador discordavam sobre a mesma trilha — que é justamente
 * o que a auditoria existe para impedir.
 *
 * O teste cria um banco DESCARTÁVEL. Inserir direto em `audit_log` na base
 * de desenvolvimento quebrava a cadeia de hash de todas as linhas seguintes
 * (a trilha é append-only e encadeada: `prev_hash`/`entry_hash`), e a
 * suíte seguinte acusava "linha N não encadeia na N-1". Aqui a linha órfã
 * nasce de propósito, o ator é removido com a FK desligada, e a listagem
 * precisa mostrá-la marcada em vez de sumir com ela.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const SERVER = path.join(ROOT, 'server');
const { rewriteSchemaForDb } = require('../../scripts/db-setup');

const DB = `saude_audit_orfao_${process.pid}`;

// O .env precisa vir antes: sem credenciais o mysql responde "Access denied".
require(require.resolve('dotenv', { paths: [SERVER] })).config({ path: path.join(SERVER, '.env') });

const CFG = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  charset: 'utf8mb4',
};

// db.js lê DB_NAME no import — aponta para o banco descartável ANTES de
// require('../src/app'), senão o app abre a base de desenvolvimento.
process.env.DB_NAME = DB;

const mysql = require(require.resolve('mysql2/promise', { paths: [SERVER] }));
const pool = require('../src/db');
const jwt = require(require.resolve('jsonwebtoken', { paths: [SERVER] }));
const bcrypt = require(require.resolve('bcryptjs', { paths: [SERVER] }));
const app = require('../src/app');

let server;
let baseUrl;
let tokenAdmin;
let atorId;
let orfaId;

async function req(metodo, caminho) {
  const res = await fetch(baseUrl + caminho, {
    method: metodo,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tokenAdmin}` },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
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

  // admin real, para chamar a rota
  atorId = crypto.randomUUID();
  const email = `orfa+${atorId.slice(0, 8)}@test.local`;
  await pool.query(
    `INSERT INTO users (id, full_name, email, password_hash, role, admin_level, account_status)
     VALUES (?,?,?,?,?,?,?)`,
    [atorId, 'Ator destinado a sumir', email, await bcrypt.hash('x', 4), 'admin', 'superadmin', 'ativo']
  );
  tokenAdmin = jwt.sign(
    { id: atorId, email, role: 'admin', admin_level: 'superadmin', full_name: 'Ator' },
    process.env.JWT_SECRET,
    { expiresIn: '10m' }
  );

  // Uma ação do ator, para existir na trilha.
  await pool.query(
    `INSERT INTO audit_log (id, actor_id, entity_type, entity_id, action, created_at)
     VALUES (?,?, 'user', ?, 'acao.marcada', NOW())`,
    [crypto.randomUUID(), atorId, atorId]
  );
  const [[reg]] = await pool.query(
    `SELECT id FROM audit_log WHERE actor_id = ? AND action = 'acao.marcada' ORDER BY created_at DESC LIMIT 1`,
    [atorId]
  );
  orfaId = reg.id;

  // Remove o ator com a FK desligada: simula o ator que já não existe
  // (restore de dump, inconsistência antiga) sem mexer no resto da base.
  await pool.query('SET FOREIGN_KEY_CHECKS = 0');
  await pool.query('DELETE FROM users WHERE id = ?', [atorId]);
  await pool.query('SET FOREIGN_KEY_CHECKS = 1');
});

test.after(async () => {
  if (server) await new Promise((r) => server.close(r));
  await pool.end().catch(() => {});
  const admin = await mysql.createConnection(CFG);
  await admin.query(`DROP DATABASE IF EXISTS \`${DB}\``).catch(() => {});
  await admin.end().catch(() => {});
});

test('a listagem mostra a linha cujo ator não existe mais, marcada', async () => {
  const { status, body } = await req('GET', '/admin/audit-log?limit=200');
  assert.equal(status, 200, 'a listagem respondeu');

  const linha = body.find((r) => r.id === orfaId);
  assert.ok(linha, 'a linha órfã NÃO pode desaparecer da listagem');
  assert.equal(linha.actor_missing, 1, 'vem marcada como ator removido');
  assert.equal(linha.action, 'acao.marcada');
});

test('a contagem paginada bate com a listagem (COUNT não usa join)', async () => {
  const { body: pagina } = await req('GET', '/admin/audit-log?limit=200');
  const total = pagina.length;

  const { status, body } = await req('GET', '/admin/audit-log?page=1&pageSize=1');
  assert.equal(status, 200);
  assert.ok(body.total >= total, 'o total paginado não pode ser menor que a listagem');
});

test('o verificador de cadeia ainda conta a linha (concordância lista × verificador)', async () => {
  // Este é o ponto do achado: lista e verificador precisam concordar.
  const { body: pagina } = await req('GET', '/admin/audit-log?limit=200');
  const naLista = pagina.some((r) => r.id === orfaId);

  const [[contagem]] = await pool.query('SELECT COUNT(*) AS n FROM audit_log WHERE id = ?', [orfaId]);
  assert.equal(contagem.n, 1, 'a linha existe no banco');
  assert.ok(naLista, 'e precisa aparecer na listagem, senão os dois discordam');
});