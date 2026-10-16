/**
 * PUT /auth/me é chamado pelos TRÊS painéis com um corpo parcial: cada
 * formulário manda só os campos que ele tem. O back, porém, fazia
 * UPDATE users SET coluna=? … para todas as 22 colunas, com `|| null`
 * em cada uma. Resultado: toda coluna ausente do corpo era apagada.
 *
 * Bugs reais que isso produzia:
 *  - Atendente que corrige só o telefone perdia job_role (o formulário de
 *    Minha conta não tem o campo).
 *  - Admin que salvava o perfil perdia blood_type, priority, race, zone,
 *    mother_name, father_name, guardian_name (o formulário não tem nenhum).
 *
 * Contrato novo e testado aqui:
 *   chave AUSENTE no corpo  -> mantém o valor atual
 *   chave presente e vazia  -> limpa (NULL)
 *   chave presente e válida -> grava
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const SERVER = path.join(ROOT, 'server');
require(require.resolve('dotenv', { paths: [SERVER] })).config({ path: path.join(SERVER, '.env') });

const pool = require('../src/db');
const jwt = require(require.resolve('jsonwebtoken', { paths: [SERVER] }));
const app = require('../src/app');
const bcrypt = require(require.resolve('bcryptjs', { paths: [SERVER] }));

const SENHA = 'senha-de-teste-123';
const CRIADOS = [];

async function criarUsuario(extra = {}) {
  const id = crypto.randomUUID();
  const email = `parcial+${id.slice(0, 8)}@test.local`;
  await pool.query(
    `INSERT INTO users (id, full_name, email, password_hash, role, account_status,
       job_role, blood_type, priority, race, birth_date, mobile, gender, zone, mother_name)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id, 'Fulano de Teste', email, await bcrypt.hash(SENHA, 4), 'paciente', 'ativo',
      'Recepcionista', 'O+', 'gestante', 'parda', '1990-05-10', '87988887777',
      'feminino', 'urbana', 'Maria Teste',
    ]
  );
  CRIADOS.push(id);
  return { id, email, extra };
}

function tokenPara(id, email) {
  return jwt.sign(
    { id, email, role: 'paciente', admin_level: null, full_name: 'Fulano de Teste' },
    process.env.JWT_SECRET,
    { expiresIn: '10m' }
  );
}

let server;
let base;

test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((r) => server.close(r));
  for (const id of CRIADOS) {
    await pool.query('DELETE FROM users WHERE id = ?', [id]).catch(() => {});
  }
  await pool.end().catch(() => {});
});

async function put(id, body) {
  const res = await fetch(`${base}/auth/me`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokenPara(id, 'parcial@test.local')}`,
    },
    body: JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* sem corpo */ }
  return { status: res.status, body: json };
}

async function ler(id, colunas) {
  const [rows] = await pool.query(
    `SELECT ${colunas.join(', ')} FROM users WHERE id = ?`,
    [id]
  );
  return rows[0];
}

test('salvar só o telefone preserva o cargo (o bug do atendente)', async () => {
  const u = await criarUsuario();
  const r = await put(u.id, { full_name: 'Fulano de Teste', phone: '87999990000' });
  assert.equal(r.status, 200, JSON.stringify(r.body));

  const row = await ler(u.id, ['job_role', 'phone']);
  assert.equal(row.job_role, 'Recepcionista', 'o cargo não pode sumir ao salvar o telefone');
  assert.equal(row.phone, '87999990000');
});

test('salvar o perfil no admin preserva os campos que o formulário não tem', async () => {
  const u = await criarUsuario();
  const r = await put(u.id, { full_name: 'Fulano de Teste', gender: 'masculino' });
  assert.equal(r.status, 200, JSON.stringify(r.body));

  const row = await ler(u.id, ['blood_type', 'priority', 'race', 'zone', 'mother_name', 'father_name']);
  assert.deepEqual(
    row,
    { blood_type: 'O+', priority: 'gestante', race: 'parda', zone: 'urbana', mother_name: 'Maria Teste', father_name: null },
    'nenhuma coluna fora do formulário pode ser alterada'
  );
});

test('chave presente e vazia limpa de propósito', async () => {
  const u = await criarUsuario();
  const r = await put(u.id, { full_name: 'Fulano de Teste', job_role: '', phone: '   ' });
  assert.equal(r.status, 200, JSON.stringify(r.body));

  const row = await ler(u.id, ['job_role', 'phone']);
  assert.equal(row.job_role, null, 'string vazia significa limpar');
  assert.equal(row.phone, null, 'só espaços também é limpar');
});

test('chave ausente mantém; presente-e-nula limpa', async () => {
  const u = await criarUsuario();
  await put(u.id, { full_name: 'Fulano de Teste' }); // sem tocar em blood_type
  let row = await ler(u.id, ['blood_type']);
  assert.equal(row.blood_type, 'O+');

  await put(u.id, { full_name: 'Fulano de Teste', blood_type: null });
  row = await ler(u.id, ['blood_type']);
  assert.equal(row.blood_type, null);
});

test('gender inválido devolve 400 e não grava nada', async () => {
  const u = await criarUsuario();
  const r = await put(u.id, { full_name: 'Fulano de Teste', gender: 'xablau' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /g[êe]nero/i);

  const row = await ler(u.id, ['gender', 'blood_type']);
  assert.equal(row.gender, 'feminino', 'o valor inválido não pode entrar');
  assert.equal(row.blood_type, 'O+', 'a rejeição tem de ser atômica');
});

test('blood_type inválido devolve 400 em português', async () => {
  const u = await criarUsuario();
  const r = await put(u.id, { full_name: 'Fulano de Teste', blood_type: 'Z' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /sangue|grupo/i);
});

test('birth_date malformada devolve 400', async () => {
  const u = await criarUsuario();
  const r = await put(u.id, { full_name: 'Fulano de Teste', birth_date: '10/05/1990' });
  assert.equal(r.status, 400);
  const row = await ler(u.id, ['birth_date']);
  assert.equal(String(row.birth_date).slice(0, 10), '1990-05-10', 'a data boa precisa continuar lá');
});

test('full_name vazio devolve 400 — é obrigatório', async () => {
  const u = await criarUsuario();
  const r = await put(u.id, { full_name: '   ', phone: '87999990000' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /nome/i);
});

test('corpo vazio devolve 400 em vez de um UPDATE inócuo', async () => {
  const u = await criarUsuario();
  const r = await put(u.id, {});
  assert.equal(r.status, 400);
  assert.match(r.body.error, /campo/i);
});

test('prioridade e raça fora da lista são recusadas', async () => {
  const u = await criarUsuario();
  const r = await put(u.id, { full_name: 'Fulano de Teste', priority: 'vip' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /prioridade/i);
});

test('CPF válido é cifrado e continua legível por decryptField', async () => {
  const u = await criarUsuario();
  const r = await put(u.id, { full_name: 'Fulano de Teste', cpf: '529.982.247-25' });
  assert.equal(r.status, 200, JSON.stringify(r.body));

  const [[row]] = await pool.query('SELECT cpf FROM users WHERE id = ?', [u.id]);
  assert.ok(String(row.cpf).startsWith('enc:v1:'), 'o CPF precisa ficar cifrado em repouso');
  assert.notEqual(String(row.cpf).includes('52998224725'), true, 'o CPF não pode ficar em claro');
});

test('CPF inválido devolve 400 e não grava', async () => {
  const u = await criarUsuario();
  const r = await put(u.id, { full_name: 'Fulano de Teste', cpf: '111.111.111-11' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /CPF/i);
  const [[row]] = await pool.query('SELECT cpf FROM users WHERE id = ?', [u.id]);
  assert.equal(row.cpf, null);
});

test('CPF salvo sobrevive a um PUT sem cpf no corpo (o campo não é preenchido)', async () => {
  // Os três painéis NÃO pré-preenchem o input de CPF (placeholder, por Privacy).
  // Se mandassem cpf:'' a cada gravação, todo documento salvo seria apagado —
  // foi exatamente o que o `|| undefined` antigo evitava, e vale manter.
  const u = await criarUsuario();
  await put(u.id, { full_name: 'Fulano de Teste', cpf: '529.982.247-25' });
  const [[antes]] = await pool.query('SELECT cpf FROM users WHERE id = ?', [u.id]);
  assert.ok(String(antes.cpf).startsWith('enc:v1:'), 'arranque gravando um CPF');

  await put(u.id, { full_name: 'Fulano de Teste', phone: '87999990000' });
  const [[depois]] = await pool.query('SELECT cpf FROM users WHERE id = ?', [u.id]);
  assert.equal(depois.cpf, antes.cpf, 'salvar o telefone não pode apagar o CPF');
});

test('cpf: "" explícito limpa — quando o usuário realmente quer apagar', async () => {
  const u = await criarUsuario();
  await put(u.id, { full_name: 'Fulano de Teste', cpf: '529.982.247-25' });
  const r = await put(u.id, { full_name: 'Fulano de Teste', cpf: '' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const [[row]] = await pool.query('SELECT cpf FROM users WHERE id = ?', [u.id]);
  assert.equal(row.cpf, null, 'string vazia explícita significa limpar');
});

test('state é gravado em maiúsculas (coluna CHAR(2))', async () => {
  const u = await criarUsuario();
  const r = await put(u.id, { full_name: 'Fulano de Teste', state: 'pe' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const row = await ler(u.id, ['state']);
  assert.equal(row.state, 'PE');
});

test('a rota continua bloqueada sem token', async () => {
  const res = await fetch(`${base}/auth/me`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ full_name: 'X' }),
  });
  assert.equal(res.status, 401);
});