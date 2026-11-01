/**
 * services/profile.js + schemas/profile.js (A1, passo 5).
 * O contrato HTTP segue em profile-update, profile-field-limits, lgpd-delete-http e cpf-hmac.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');

const SERVER = path.resolve(__dirname, '..');
require(require.resolve('dotenv', { paths: [SERVER] })).config({ path: path.join(SERVER, '.env') });

const pool = require('../src/db');
const bcrypt = require(require.resolve('bcryptjs', { paths: [SERVER] }));
const { normalizarAtualizacaoPerfil, LIMITES_CAMPO } = require('../src/schemas/profile');
const { obterPerfil, exportarDados, atualizarPerfil, excluirConta } = require('../src/services/profile');
const { encryptField, decryptField } = require('../src/utils/crypto');
const { hmacCpf } = require('../src/utils/cpf');

const docs = { encrypt: encryptField, decrypt: decryptField };
const SENHA = 'senha-de-teste-123';
const CRIADOS = [];

test.after(async () => {
  for (const id of CRIADOS) await pool.query('DELETE FROM users WHERE id = ?', [id]).catch(() => {});
  await pool.end().catch(() => {});
});

function cpfUnico() {
  const dig = (n) => { const r = (n.reduce((a, d, i) => a + d * (n.length + 1 - i), 0) * 10) % 11; return r === 10 ? 0 : r; };
  const n = [...String(crypto.randomInt(100000000, 999999999))].map(Number);
  n.push(dig(n)); n.push(dig(n));
  return n.join('');
}
async function usuario(extra = {}) {
  const id = crypto.randomUUID();
  await pool.query(
    "INSERT INTO users (id, full_name, email, password_hash, role, job_role, blood_type, phone) VALUES (?,?,?,?, 'paciente', ?, ?, ?)",
    [id, 'Perfil Svc', `perfil-${id}@test.local`, await bcrypt.hash(SENHA, 4), extra.job_role ?? 'Recepcionista', 'O+', '87911110000']
  );
  CRIADOS.push(id);
  return id;
}

// ---------------------------------------------------------------------------
// normalizarAtualizacaoPerfil (pura)
// ---------------------------------------------------------------------------

test('normalizar: chave ausente não aparece; presente e vazia vira NULL; presente e válida é aparada', () => {
  const r = normalizarAtualizacaoPerfil({ phone: '  87999990000 ', city: '', street: null });
  assert.equal(r.ok, true);
  assert.deepEqual(Object.fromEntries(r.campos), { phone: '87999990000', city: null, street: null });
  assert.ok(!r.campos.some(([c]) => c === 'job_role'), 'o que não veio não é tocado');
  assert.deepEqual(r.documentos, {});
});

test('normalizar: corpo vazio, nulo ou sem campos conhecidos → "Nenhum campo para atualizar."', () => {
  for (const b of [undefined, null, {}, { desconhecido: 1 }, 'texto']) {
    assert.deepEqual(normalizarAtualizacaoPerfil(b), { ok: false, error: 'Nenhum campo para atualizar.' });
  }
});

test('normalizar: documentos — presença, limpeza, normalização e validação', () => {
  const cpf = cpfUnico();
  const ok = normalizarAtualizacaoPerfil({
    cpf: `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`, rg: ' 1234567 ', cns: '',
  });
  assert.deepEqual(ok.documentos, { cpf, rg: '1234567', cns: null });
  assert.deepEqual(normalizarAtualizacaoPerfil({ cpf: '', rg: '   ' }).documentos, { cpf: null, rg: null });
  assert.equal(normalizarAtualizacaoPerfil({ cpf: '111.111.111-11' }).error, 'CPF inválido. Confira os números digitados.');
  assert.equal(normalizarAtualizacaoPerfil({ cns: '123' }).error, 'Cartão SUS (CNS) inválido. Confira os 15 números.');
});

test('normalizar: nome vazio, data inexistente, tamanho e enum inválidos têm mensagem própria', () => {
  assert.equal(normalizarAtualizacaoPerfil({ full_name: '   ' }).error, 'Informe o nome completo.');
  assert.match(normalizarAtualizacaoPerfil({ birth_date: '2026-02-30' }).error, /não existe no calendário/);
  assert.match(normalizarAtualizacaoPerfil({ birth_date: 'ontem' }).error, /AAAA-MM-DD/);
  assert.equal(normalizarAtualizacaoPerfil({ state: 'São Paulo' }).error, `Campo "state" excede o tamanho máximo (${LIMITES_CAMPO.state} caracteres).`);
  assert.match(normalizarAtualizacaoPerfil({ blood_type: 'Z+' }).error, /sanguíneo/i);
  assert.deepEqual(Object.fromEntries(normalizarAtualizacaoPerfil({ state: 'pe', blood_type: '', birth_date: '1990-05-10T00:00' }).campos),
    { state: 'PE', blood_type: null, birth_date: '1990-05-10' });
});

test('normalizar: a primeira falha na ordem de sempre — documento, nome, data, tamanho, enum', () => {
  const tudoErrado = { cpf: '1', full_name: '', birth_date: 'x', state: 'xxx', blood_type: 'Z' };
  assert.match(normalizarAtualizacaoPerfil(tudoErrado).error, /CPF/);
  delete tudoErrado.cpf;
  assert.match(normalizarAtualizacaoPerfil(tudoErrado).error, /nome completo/);
  delete tudoErrado.full_name;
  assert.match(normalizarAtualizacaoPerfil(tudoErrado).error, /Data inválida/);
  delete tudoErrado.birth_date;
  assert.match(normalizarAtualizacaoPerfil(tudoErrado).error, /excede/);
  delete tudoErrado.state;
  assert.match(normalizarAtualizacaoPerfil(tudoErrado).error, /sanguíneo/i);
});

// ---------------------------------------------------------------------------
// Serviço (banco real)
// ---------------------------------------------------------------------------

test('atualizarPerfil: grava só o que veio, cifra documentos e mantém o índice do CPF', async () => {
  const id = await usuario();
  const cpf = cpfUnico();
  const r = await atualizarPerfil(id, { phone: '87922223333', cpf, rg: '99887766' }, docs);
  assert.deepEqual(r, { ok: true, atualizados: 4 }); // phone + cpf + cpf_hmac + rg

  const [[row]] = await pool.query('SELECT job_role, blood_type, phone, cpf, cpf_hmac, rg FROM users WHERE id = ?', [id]);
  assert.equal(row.job_role, 'Recepcionista', 'não tocado');
  assert.equal(row.blood_type, 'O+', 'não tocado');
  assert.equal(row.phone, '87922223333');
  assert.ok(row.cpf.startsWith('enc:v1:') && row.rg.startsWith('enc:v1:'));
  assert.equal(decryptField(row.cpf), cpf);
  assert.equal(row.cpf_hmac, hmacCpf(cpf));

  await atualizarPerfil(id, { cpf: '' }, docs);
  const [[limpo]] = await pool.query('SELECT cpf, cpf_hmac, rg FROM users WHERE id = ?', [id]);
  assert.equal(limpo.cpf, null);
  assert.equal(limpo.cpf_hmac, null);
  assert.ok(limpo.rg, 'o rg não veio, então fica');
});

test('atualizarPerfil: validação → 400; CPF de outra conta → 409 sem gravar nada', async () => {
  const a = await usuario();
  const b = await usuario();
  const cpf = cpfUnico();
  assert.equal((await atualizarPerfil(a, { cpf }, docs)).ok, true);

  assert.deepEqual(await atualizarPerfil(b, { state: 'xxx' }, docs), { ok: false, status: 400, error: `Campo "state" excede o tamanho máximo (2 caracteres).` });
  const dup = await atualizarPerfil(b, { cpf, phone: '87900000000' }, docs);
  assert.deepEqual([dup.ok, dup.status], [false, 409]);
  assert.match(dup.error, /CPF já cadastrado/);
  const [[row]] = await pool.query('SELECT phone FROM users WHERE id = ?', [b]);
  assert.equal(row.phone, '87911110000', 'o UPDATE inteiro falhou, nada foi gravado');
});

test('obterPerfil: documentos decifrados, sem credenciais; documento ilegível vira null', async () => {
  const id = await usuario();
  const cpf = cpfUnico();
  await atualizarPerfil(id, { cpf }, docs);
  const r = await obterPerfil(id, docs);
  assert.equal(r.ok, true);
  assert.equal(r.user.cpf, cpf);
  assert.ok(!('password_hash' in r.user) && !('totp_secret' in r.user));

  const quebrado = await obterPerfil(id, { decrypt: () => { throw new Error('sem chave'); } });
  assert.equal(quebrado.user.cpf, null);
  assert.deepEqual(await obterPerfil(crypto.randomUUID(), docs), { ok: false, status: 404, error: 'Usuário não encontrado.' });
});

test('exportarDados: tudo do titular, sem password_hash/totp_secret; ilegível é sinalizado', async () => {
  const id = await usuario();
  await atualizarPerfil(id, { cpf: cpfUnico() }, docs);
  await pool.query("UPDATE users SET totp_secret = 'SEGREDO-NAO-PODE-SAIR' WHERE id = ?", [id]);
  const r = await exportarDados(id, docs);
  assert.equal(r.ok, true);
  assert.ok(!JSON.stringify(r.dados).includes('SEGREDO-NAO-PODE-SAIR'));
  assert.ok(!('password_hash' in r.dados.profile));
  assert.ok(r.dados.privacy_version);
  assert.ok(Array.isArray(r.dados.appointments) && Array.isArray(r.dados.exams) && Array.isArray(r.dados.reminders));

  const ilegivel = await exportarDados(id, { decrypt: () => { throw new Error('x'); } });
  assert.equal(ilegivel.dados.profile.cpf, '[ilegível: chave ausente]');
  assert.equal((await exportarDados(crypto.randomUUID(), docs)).status, 404);
});

test('excluirConta: senha errada → 401 e nada muda; senha certa anonimiza', async () => {
  const id = await usuario();
  assert.deepEqual(await excluirConta(id, 'errada'), { ok: false, status: 401, error: 'Senha incorreta.' });
  assert.equal((await excluirConta(crypto.randomUUID(), SENHA)).status, 404);
  const [[antes]] = await pool.query('SELECT full_name, deleted_at FROM users WHERE id = ?', [id]);
  assert.equal(antes.full_name, 'Perfil Svc');
  assert.equal(antes.deleted_at, null);

  assert.deepEqual(await excluirConta(id, SENHA), { ok: true });
  const [[depois]] = await pool.query('SELECT full_name, deleted_at, phone FROM users WHERE id = ?', [id]);
  assert.equal(depois.full_name, 'Titular removido');
  assert.ok(depois.deleted_at);
  assert.equal(depois.phone, null);
});
