/**
 * ADR-0009: script de correção das contas "excluídas" pelo admin antes da anonimização.
 * Roda em banco descartável (o runner define DB_NAME); cria e remove as próprias contas.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');

const SERVER = path.resolve(__dirname, '..');
require(require.resolve('dotenv', { paths: [SERVER] })).config({ path: path.join(SERVER, '.env') });

const pool = require('../src/db');
const { candidatas, anonimizarExcluidos } = require('../scripts/anonimizar-excluidos');

const IDS = [];

async function conta({ excluida = false, anonimizada = false, nome = 'Pessoa Teste' } = {}) {
  const id = crypto.randomUUID();
  const email = anonimizada ? `removido_${id}@removido.local` : `exc-${id}@test.local`;
  await pool.query(
    `INSERT INTO users (id, full_name, email, password_hash, role, account_status, mobile, govbr_sub, consent_ip, deleted_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [id, anonimizada ? 'Titular removido' : nome, email, 'hash', 'paciente', excluida ? 'inativo' : 'ativo',
      anonimizada ? null : '81988887777', anonimizada ? null : 'sub-xyz', anonimizada ? null : '10.1.1.1',
      excluida || anonimizada ? new Date('2026-01-15T10:00:00') : null]
  );
  IDS.push(id);
  return id;
}
const linha = async (id) => (await pool.query('SELECT * FROM users WHERE id = ?', [id]))[0][0];
const ids = (rows) => rows.map((r) => r.id);

test.after(async () => {
  for (const id of IDS) {
    await pool.query('DELETE FROM audit_log WHERE entity_id = ?', [id]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id = ?', [id]).catch(() => {});
  }
  await pool.end().catch(() => {});
});

test('candidatas: só excluídas que ainda guardam dado pessoal', async () => {
  const antiga = await conta({ excluida: true });
  const viva = await conta();
  const jaAnonima = await conta({ anonimizada: true });

  const achadas = ids(await candidatas(pool));
  assert.ok(achadas.includes(antiga), 'a conta excluída com dado pessoal é candidata');
  assert.ok(!achadas.includes(viva), 'conta viva não é candidata');
  assert.ok(!achadas.includes(jaAnonima), 'conta já anonimizada não é candidata');
});

test('simulação (padrão) não altera nada', async () => {
  const id = await conta({ excluida: true, nome: 'Fulana Simulada' });
  const r = await anonimizarExcluidos(pool);
  assert.ok(r.encontradas >= 1);
  assert.equal(r.anonimizadas, 0);
  const depois = await linha(id);
  assert.equal(depois.full_name, 'Fulana Simulada');
  assert.equal(depois.mobile, '81988887777');
});

test('--apply anonimiza, preserva a data original da exclusão e é idempotente', async () => {
  const id = await conta({ excluida: true, nome: 'Fulano Excluído' });
  const antes = await linha(id);

  const r = await anonimizarExcluidos(pool, { apply: true });
  assert.equal(r.falhas.length, 0, JSON.stringify(r.falhas));
  assert.ok(r.anonimizadas >= 1);

  const depois = await linha(id);
  assert.equal(depois.full_name, 'Titular removido');
  assert.equal(depois.email, `removido_${id}@removido.local`);
  for (const coluna of ['mobile', 'govbr_sub', 'consent_ip', 'cpf', 'cpf_hmac']) {
    assert.equal(depois[coluna], null, `${coluna} deveria ser zerado`);
  }
  assert.equal(String(depois.deleted_at), String(antes.deleted_at), 'a data da exclusão original é mantida');

  const [[trilha]] = await pool.query(
    "SELECT details FROM audit_log WHERE action = 'lgpd_delete' AND entity_id = ? ORDER BY seq DESC LIMIT 1",
    [id]
  );
  assert.match(trilha.details, /correção ADR-0009/);

  assert.ok(!ids(await candidatas(pool)).includes(id), 'rodar de novo não acha a conta');
});
