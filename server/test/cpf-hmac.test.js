/**
 * RFC-0001 / ADR-0006 (B3): índice cego do CPF.
 *
 * `users.cpf` é cifrado com IV aleatório; sem `cpf_hmac` o banco não garante
 * "um CPF, uma conta" e a busca do Gov.br decifrava a tabela inteira.
 *
 * Cobre: o HMAC em si; cadastro e perfil (409 em duplicata); busca do Gov.br pelo
 * índice; anonimização LGPD liberando o CPF; e a migração (backfill, duplicatas,
 * UNIQUE, idempotência, --rehash).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SERVER = path.join(ROOT, 'server');
require(require.resolve('dotenv', { paths: [SERVER] })).config({ path: path.join(SERVER, '.env') });

// O callback do Gov.br importa estas duas funções no carregamento da rota: troca-se
// ANTES de carregar o app. (Cada arquivo de teste roda em processo próprio.)
let perfilGovbr = {};
const govbr = require('../src/services/govbr');
govbr.exchangeCode = async () => ({ access_token: 'token-falso' });
govbr.fetchUserInfo = async () => perfilGovbr;

const pool = require('../src/db');
const app = require('../src/app');
const jwt = require(require.resolve('jsonwebtoken', { paths: [SERVER] }));
const mysql = require(require.resolve('mysql2/promise', { paths: [SERVER] }));
const { hmacCpf, assertCpfHmacConfigured, ehCpfDuplicado } = require('../src/utils/cpf');
const { encryptField } = require('../src/utils/crypto');
const { anonymizeUser } = require('../src/utils/privacy');
const { rewriteSchemaForDb } = require('../../scripts/db-setup');

// CPF válido (dígitos verificadores corretos) a partir de 9 dígitos.
function cpfValido(base9) {
  const dig = (nums) => {
    const soma = nums.reduce((acc, n, i) => acc + n * (nums.length + 1 - i), 0);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const n = [...base9].map(Number);
  n.push(dig(n));
  n.push(dig(n));
  return n.join('');
}
const comMascara = (c) => `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}`;
const novoCpf = () => cpfValido(String(crypto.randomInt(100000000, 999999999)));

const CHAVE_A = 'a1'.repeat(32);
const CHAVE_B = 'b2'.repeat(32);

function comEnv(vars, fn) {
  const antes = {};
  for (const k of Object.keys(vars)) {
    antes[k] = process.env[k];
    if (vars[k] === undefined) delete process.env[k];
    else process.env[k] = vars[k];
  }
  try {
    return fn();
  } finally {
    for (const k of Object.keys(vars)) {
      if (antes[k] === undefined) delete process.env[k];
      else process.env[k] = antes[k];
    }
  }
}

// ---------------------------------------------------------------------------
// HMAC
// ---------------------------------------------------------------------------

test('hmacCpf: 64 hex, determinístico e indiferente à pontuação', () => {
  comEnv({ CPF_HMAC_KEY: CHAVE_A }, () => {
    const cpf = cpfValido('123456789');
    const h = hmacCpf(cpf);
    assert.match(h, /^[0-9a-f]{64}$/);
    assert.equal(hmacCpf(comMascara(cpf)), h, 'pontuação não pode mudar o resultado');
    assert.equal(hmacCpf(cpf), h);
    assert.notEqual(hmacCpf(cpfValido('987654321')), h);
  });
});

test('hmacCpf: depende da chave e não é um SHA-256 simples do CPF', () => {
  const cpf = cpfValido('123456789');
  const a = comEnv({ CPF_HMAC_KEY: CHAVE_A }, () => hmacCpf(cpf));
  const b = comEnv({ CPF_HMAC_KEY: CHAVE_B }, () => hmacCpf(cpf));
  assert.notEqual(a, b, 'chaves diferentes precisam dar impressões diferentes');
  const simples = crypto.createHash('sha256').update(cpf).digest('hex');
  assert.notEqual(a, simples, 'sem chave, um dump permitiria testar CPFs candidatos');
});

test('hmacCpf: vazio, nulo ou com tamanho errado vira null', () => {
  comEnv({ CPF_HMAC_KEY: CHAVE_A }, () => {
    for (const v of [null, undefined, '', '123', '1234567890', '123456789012']) {
      assert.equal(hmacCpf(v), null, `entrada ${JSON.stringify(v)}`);
    }
  });
});

test('sem CPF_HMAC_KEY o app recusa (fail-closed); só o modo dev deriva uma chave', () => {
  comEnv({ CPF_HMAC_KEY: undefined, ALLOW_PLAINTEXT_DEV: undefined }, () => {
    assert.throws(() => assertCpfHmacConfigured(), /CPF_HMAC_KEY/);
    assert.throws(() => hmacCpf(cpfValido('123456789')), /CPF_HMAC_KEY/);
  });
  comEnv({ CPF_HMAC_KEY: 'curta', ALLOW_PLAINTEXT_DEV: undefined }, () => {
    assert.throws(() => assertCpfHmacConfigured(), /CPF_HMAC_KEY/, 'chave de formato inválido também recusa');
  });
  comEnv({ CPF_HMAC_KEY: undefined, ALLOW_PLAINTEXT_DEV: '1' }, () => {
    assert.equal(assertCpfHmacConfigured(), true);
    assert.match(hmacCpf(cpfValido('123456789')), /^[0-9a-f]{64}$/);
  });
});

test('ehCpfDuplicado só reconhece a violação do UNIQUE do CPF', () => {
  assert.equal(ehCpfDuplicado({ code: 'ER_DUP_ENTRY', message: "Duplicate entry 'x' for key 'users.uq_users_cpf_hmac'" }), true);
  assert.equal(ehCpfDuplicado({ code: 'ER_DUP_ENTRY', message: "Duplicate entry 'x' for key 'users.email'" }), false);
  assert.equal(ehCpfDuplicado(new Error('outro')), false);
  assert.equal(ehCpfDuplicado(null), false);
});

// ---------------------------------------------------------------------------
// HTTP: cadastro, perfil, Gov.br, anonimização
// ---------------------------------------------------------------------------

const SENHA = 'senha-de-teste-123';
const CRIADOS = [];
let server;
let base;

test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((r) => server.close(r));
  for (const id of CRIADOS) await pool.query('DELETE FROM users WHERE id = ?', [id]).catch(() => {});
  await pool.end().catch(() => {});
});

async function chamar(metodo, rota, corpo, token) {
  const res = await fetch(`${base}${rota}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  let json = null;
  try { json = await res.json(); } catch { /* sem corpo */ }
  return { status: res.status, body: json };
}

async function cadastrar(cpf) {
  const email = `cpfhmac+${crypto.randomUUID().slice(0, 8)}@test.local`;
  const r = await chamar('POST', '/auth/signup', {
    email, password: SENHA, full_name: 'Paciente CPF', birth_date: '1990-05-10', cpf,
  });
  if (r.status === 201) CRIADOS.push(r.body.id);
  return { ...r, email };
}

const tokenPara = (id, email) =>
  jwt.sign({ id, email, role: 'paciente', admin_level: null, full_name: 'Paciente CPF' }, process.env.JWT_SECRET, { expiresIn: '10m' });

const ler = async (id) => (await pool.query('SELECT cpf, cpf_hmac, govbr_sub FROM users WHERE id = ?', [id]))[0][0];

test('cadastro grava o cpf_hmac do CPF normalizado', async () => {
  const cpf = novoCpf();
  const r = await cadastrar(comMascara(cpf));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const row = await ler(r.body.id);
  assert.equal(row.cpf_hmac, hmacCpf(cpf));
  assert.ok(String(row.cpf).startsWith('enc:v1:'), 'o CPF segue cifrado em repouso');
});

test('segundo cadastro com o mesmo CPF (com ou sem máscara) é 409, sem revelar quem é o dono', async () => {
  const cpf = novoCpf();
  const primeiro = await cadastrar(cpf);
  assert.equal(primeiro.status, 201, JSON.stringify(primeiro.body));

  for (const forma of [cpf, comMascara(cpf)]) {
    const r = await cadastrar(forma);
    assert.equal(r.status, 409, JSON.stringify(r.body));
    assert.match(r.body.error, /CPF já cadastrado/);
    assert.ok(!JSON.stringify(r.body).includes(primeiro.email), 'a resposta não pode vazar o e-mail do dono');
  }
});

test('cadastros simultâneos com o mesmo CPF: só um vence, os outros recebem 409', async () => {
  const cpf = novoCpf();
  const resultados = await Promise.all(Array.from({ length: 5 }, () => cadastrar(cpf)));
  const status = resultados.map((r) => r.status).sort();
  assert.deepEqual(status, [201, 409, 409, 409, 409], JSON.stringify(resultados.map((r) => r.body)));
});

test('PUT /auth/me: CPF de outra conta é 409 e não altera nada', async () => {
  const cpfA = novoCpf();
  const cpfB = novoCpf();
  const a = await cadastrar(cpfA);
  const b = await cadastrar(cpfB);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);

  const r = await chamar('PUT', '/auth/me', { cpf: comMascara(cpfA), phone: '87999990000' }, tokenPara(b.body.id, b.email));
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.match(r.body.error, /CPF já cadastrado/);
  const row = await ler(b.body.id);
  assert.equal(row.cpf_hmac, hmacCpf(cpfB), 'o índice do B não pode mudar');
  const [[tel]] = await pool.query('SELECT phone FROM users WHERE id = ?', [b.body.id]);
  assert.equal(tel.phone, null, 'a requisição inteira falhou: nada foi gravado');
});

test('PUT /auth/me: regravar o próprio CPF, trocar e limpar mantêm o índice coerente', async () => {
  const cpf = novoCpf();
  const u = await cadastrar(cpf);
  const token = tokenPara(u.body.id, u.email);

  const mesmo = await chamar('PUT', '/auth/me', { cpf: comMascara(cpf) }, token);
  assert.equal(mesmo.status, 200, JSON.stringify(mesmo.body));

  const outro = novoCpf();
  const troca = await chamar('PUT', '/auth/me', { cpf: outro }, token);
  assert.equal(troca.status, 200, JSON.stringify(troca.body));
  assert.equal((await ler(u.body.id)).cpf_hmac, hmacCpf(outro), 'trocar o CPF recalcula o índice');

  // O CPF antigo foi liberado: outra pessoa pode cadastrá-lo.
  const reuso = await cadastrar(cpf);
  assert.equal(reuso.status, 201, JSON.stringify(reuso.body));

  const limpa = await chamar('PUT', '/auth/me', { cpf: '' }, token);
  assert.equal(limpa.status, 200);
  const row = await ler(u.body.id);
  assert.equal(row.cpf, null);
  assert.equal(row.cpf_hmac, null, 'sem CPF, sem índice');

  // Salvar outro campo sem a chave `cpf` não mexe no índice.
  const v = await cadastrar(novoCpf());
  const antes = (await ler(v.body.id)).cpf_hmac;
  await chamar('PUT', '/auth/me', { phone: '87911112222' }, tokenPara(v.body.id, v.email));
  assert.equal((await ler(v.body.id)).cpf_hmac, antes);
});

test('Gov.br: acha a conta pelo índice, com ou sem máscara, e vincula o sub', async () => {
  const cpf = novoCpf();
  const u = await cadastrar(cpf);
  perfilGovbr = { sub: `sub-${crypto.randomUUID()}`, cpf: comMascara(cpf), nome: 'Fulano' };
  const r = await chamar('GET', '/auth/govbr/callback?code=abc');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.user.id, u.body.id);
  assert.equal((await ler(u.body.id)).govbr_sub, perfilGovbr.sub);
});

test('Gov.br: CPF sem conta devolve 404 com o perfil para pré-preencher o cadastro', async () => {
  perfilGovbr = { sub: `sub-${crypto.randomUUID()}`, cpf: novoCpf(), nome: 'Ninguém' };
  const r = await chamar('GET', '/auth/govbr/callback?code=abc');
  assert.equal(r.status, 404, JSON.stringify(r.body));
  assert.ok(r.body.govbr_profile);
});

test('Gov.br: confere o CPF cifrado do candidato — HMAC defasado não vincula a conta errada', async () => {
  const dono = novoCpf();
  const intruso = novoCpf();
  const u = await cadastrar(dono);
  // Linha com índice apontando para o CPF do intruso, mas cifra do dono (ex.: chave trocada sem --rehash).
  await pool.query('UPDATE users SET cpf_hmac = ? WHERE id = ?', [hmacCpf(intruso), u.body.id]);
  perfilGovbr = { sub: `sub-${crypto.randomUUID()}`, cpf: intruso, nome: 'Intruso' };
  const r = await chamar('GET', '/auth/govbr/callback?code=abc');
  assert.equal(r.status, 404, 'o índice só aponta; quem decide é o dado cifrado');
});

test('anonimização LGPD zera cpf_hmac e libera o CPF para novo cadastro', async () => {
  const cpf = novoCpf();
  const u = await cadastrar(cpf);
  assert.equal(await anonymizeUser(pool, u.body.id), true);
  const row = await ler(u.body.id);
  assert.equal(row.cpf, null);
  assert.equal(row.cpf_hmac, null, 'senão o CPF anonimizado bloquearia o titular de voltar');

  const volta = await cadastrar(cpf);
  assert.equal(volta.status, 201, JSON.stringify(volta.body));
});

// ---------------------------------------------------------------------------
// Migração
// ---------------------------------------------------------------------------

const DB_MIG = `saude_cpfhmac_${process.pid}`;
const cfg = () => ({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  charset: 'utf8mb4',
});

const migrar = (envExtra = {}, ...args) =>
  spawnSync(process.execPath, [path.join(SERVER, 'migrations', '0002_cpf_hmac.js'), ...args], {
    cwd: SERVER,
    env: { ...process.env, DB_NAME: DB_MIG, CPF_HMAC_KEY: CHAVE_A, ...envExtra },
    encoding: 'utf8',
  });

async function usuarioLegado(conn, { cpf, cifrar = true, email } = {}) {
  const id = crypto.randomUUID();
  const valor = cpf == null ? null : (cifrar ? encryptField(cpf) : cpf);
  await conn.query(
    "INSERT INTO users (id, full_name, email, password_hash, role, cpf) VALUES (?,?,?,?, 'paciente', ?)",
    [id, 'Legado', email || `mig-${id}@test.local`, 'x'.repeat(60), valor]
  );
  return id;
}

test('migração: preenche, trata casos ruins, para em duplicata e cria o UNIQUE', async (t) => {
  const admin = await mysql.createConnection({ ...cfg(), multipleStatements: true });
  await admin.query('DROP DATABASE IF EXISTS `' + DB_MIG + '`');
  await admin.query('CREATE DATABASE `' + DB_MIG + '` CHARACTER SET utf8mb4');
  await admin.end();
  const conn = await mysql.createConnection({ ...cfg(), database: DB_MIG, multipleStatements: true });
  t.after(async () => {
    await conn.end().catch(() => {});
    const a = await mysql.createConnection(cfg());
    await a.query('DROP DATABASE IF EXISTS `' + DB_MIG + '`').catch(() => {});
    await a.end().catch(() => {});
  });
  await conn.query(rewriteSchemaForDb(fs.readFileSync(path.join(SERVER, 'schema.sql'), 'utf8'), DB_MIG));

  // Banco "antigo": sem a coluna e sem o índice.
  await conn.query('ALTER TABLE users DROP INDEX uq_users_cpf_hmac, DROP COLUMN cpf_hmac');

  const c1 = novoCpf();
  const c2 = novoCpf();
  const c3 = novoCpf();
  const u1 = await usuarioLegado(conn, { cpf: c1 });
  const u2 = await usuarioLegado(conn, { cpf: c2 });
  const u3 = await usuarioLegado(conn, { cpf: null });
  const u4 = await usuarioLegado(conn, { cpf: c3, cifrar: false }); // legado em texto puro
  const u5 = await usuarioLegado(conn, { cpf: '123' }); // lixo sem 11 dígitos
  const idx = async () => (await conn.query("SELECT 1 FROM information_schema.statistics WHERE table_schema = ? AND index_name = 'uq_users_cpf_hmac'", [DB_MIG]))[0].length;
  const hmacDe = async (id) => (await conn.query('SELECT cpf_hmac FROM users WHERE id = ?', [id]))[0][0].cpf_hmac;

  await t.test('banco antigo: cria coluna, preenche o que é válido e cria o UNIQUE', async () => {
    const r = migrar();
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /users\.cpf_hmac criada/);
    assert.match(r.stdout, /3 preenchido/);
    assert.equal(await hmacDe(u1), comEnv({ CPF_HMAC_KEY: CHAVE_A }, () => hmacCpf(c1)));
    assert.equal(await hmacDe(u2), comEnv({ CPF_HMAC_KEY: CHAVE_A }, () => hmacCpf(c2)));
    assert.equal(await hmacDe(u4), comEnv({ CPF_HMAC_KEY: CHAVE_A }, () => hmacCpf(c3)), 'CPF legado em texto puro também entra');
    assert.equal(await hmacDe(u3), null);
    assert.equal(await hmacDe(u5), null, 'CPF sem 11 dígitos não gera índice');
    assert.match(r.stderr, /sem 11 dígitos/);
    assert.equal(await idx(), 1);
    assert.ok(!(r.stdout + r.stderr).includes(c1), 'a migração nunca imprime CPF');
  });

  await t.test('é idempotente: rodar de novo não preenche nem cria nada', () => {
    const r = migrar();
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /0 preenchido/);
    assert.match(r.stdout, /já existe/);
    assert.doesNotMatch(r.stdout, /\+ /);
  });

  await t.test('duplicata: PARA, lista só ids e não cria o UNIQUE', async () => {
    await conn.query('ALTER TABLE users DROP INDEX uq_users_cpf_hmac');
    const dup = await usuarioLegado(conn, { cpf: c1 }); // mesmo CPF do u1, outro ciphertext
    const r = migrar();
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /mesmo CPF/);
    assert.ok(r.stderr.includes(u1) && r.stderr.includes(dup), 'os dois ids precisam aparecer');
    assert.ok(!(r.stdout + r.stderr).includes(c1));
    assert.equal(await idx(), 0, 'com duplicata o UNIQUE não pode ser criado');
    const [[{ n }]] = await conn.query('SELECT COUNT(*) n FROM users');
    assert.equal(Number(n), 6, 'nenhuma conta é mesclada ou apagada');

    // Resolvida a pendência (decisão humana), a migração conclui.
    await conn.query('UPDATE users SET cpf = NULL, cpf_hmac = NULL WHERE id = ?', [dup]);
    const ok = migrar();
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(await idx(), 1);
  });

  await t.test('--rehash recalcula tudo com a chave nova e recria o UNIQUE', async () => {
    const r = migrar({ CPF_HMAC_KEY: CHAVE_B }, '--rehash');
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /removido para o --rehash/);
    assert.equal(await hmacDe(u1), comEnv({ CPF_HMAC_KEY: CHAVE_B }, () => hmacCpf(c1)));
    assert.equal(await hmacDe(u2), comEnv({ CPF_HMAC_KEY: CHAVE_B }, () => hmacCpf(c2)));
    assert.equal(await idx(), 1);
  });

  await t.test('sem CPF_HMAC_KEY e com linhas a indexar: falha com instrução, sem alterar', async () => {
    await conn.query('UPDATE users SET cpf_hmac = NULL WHERE id = ?', [u1]);
    const r = migrar({ CPF_HMAC_KEY: '', ALLOW_PLAINTEXT_DEV: '' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /CPF_HMAC_KEY/);
    assert.equal(await hmacDe(u1), null);
  });
});
