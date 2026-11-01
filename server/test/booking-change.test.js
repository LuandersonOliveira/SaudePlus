/**
 * services/bookingChange.js (A1, passo 7c). A parte PURA (normalizarMudanca) é testada sem
 * banco; a transacional segue coberta por booking-status, priority-booking e race/*.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');

const SERVER = path.resolve(__dirname, '..');
require(require.resolve('dotenv', { paths: [SERVER] })).config({ path: path.join(SERVER, '.env') });

const { normalizarMudanca, applyBookingChange } = require('../src/services/bookingChange');
const atendimentos = require('../src/repositories/atendimentos');

const futuro = (dias = 5) => {
  const d = new Date(Date.now() + dias * 24 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} 10:00:00`;
};
const erro = (r) => (r.ok ? null : [r.status, r.body.error]);

test('normalizar: só status → um SET e a linha de log', () => {
  const r = normalizarMudanca({ status: 'confirmado' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.updates, ['status=?']);
  assert.deepEqual(r.params, ['confirmado']);
  assert.deepEqual(r.logParts, ['status -> confirmado']);
  assert.equal(r.scheduledAt, undefined);
});

test('normalizar: ordem dos SETs é status, desfecho, horário, motivo', () => {
  const quando = futuro();
  const r = normalizarMudanca({ reschedule_reason: 'profissional_indisponivel', scheduled_at: quando, outcome: 'compareceu', status: 'concluido' });
  assert.equal(r.ok, true, JSON.stringify(r.body));
  assert.deepEqual(r.updates, ['status=?', 'outcome=?', 'scheduled_at=?', 'reschedule_reason=?']);
  assert.deepEqual(r.params, ['concluido', 'compareceu', quando, 'profissional_indisponivel']);
  assert.match(r.logParts.join(';'), /status -> concluido;desfecho -> compareceu;reagendado para .*;motivo -> profissional_indisponivel/);
});

test('normalizar: status inválido, desfecho inválido e horário fora da janela são 400 com mensagem', () => {
  assert.deepEqual(erro(normalizarMudanca({ status: 'voando' })), [400, 'Status inválido.']);
  assert.equal(erro(normalizarMudanca({ outcome: 'xyz-invalido' }))[0], 400);
  assert.equal(erro(normalizarMudanca({ scheduled_at: '2000-01-01 10:00:00' }))[1], 'Não é permitido agendar em data passada.');
  assert.equal(erro(normalizarMudanca({ scheduled_at: 'amanhã' }))[1], 'Informe uma data e horário válidos.');
});

test('normalizar: corpo vazio, nulo ou sem campos conhecidos → "Nada para atualizar."', () => {
  for (const b of [undefined, null, {}, { foo: 1 }]) {
    assert.deepEqual(erro(normalizarMudanca(b)), [400, 'Nada para atualizar.']);
  }
});

test('normalizar: desfecho vazio limpa (NULL); motivo vazio limpa', () => {
  const a = normalizarMudanca({ outcome: '' });
  assert.deepEqual([a.updates, a.params, a.logParts], [['outcome=?'], [null], ['desfecho -> limpo']]);
  const b = normalizarMudanca({ reschedule_reason: '' });
  assert.deepEqual([b.updates, b.params, b.logParts], [['reschedule_reason=?'], [null], ['motivo -> limpo']]);
  assert.equal(b.temMotivo, true);
});

test('normalizar: motivo padrão (autoReason/defaultReason) preenche e grava, sem o chamador enviar', () => {
  const r = normalizarMudanca({ status: 'para_remarcar' }, { defaultReason: 'profissional_inativado' });
  assert.equal(r.ok, true, JSON.stringify(r.body));
  assert.equal(r.reason, 'profissional_inativado');
  assert.deepEqual(r.updates, ['status=?', 'reschedule_reason=?']);
  assert.equal(r.motivoObrigatorio, false, 'com motivo padrão, não se exige que o chamador envie');
  const auto = normalizarMudanca({ status: 'confirmado' }, { autoReason: 'reagendado_pelo_paciente' });
  assert.equal(auto.reason, 'reagendado_pelo_paciente');
  // motivo enviado vence o padrão
  const proprio = normalizarMudanca({ status: 'confirmado', reschedule_reason: 'profissional_indisponivel' }, { defaultReason: 'profissional_inativado' });
  assert.equal(proprio.reason, 'profissional_indisponivel');
});

test('normalizar: motivoObrigatorio segue reasonRequired, ou a ausência de motivo padrão', () => {
  assert.equal(normalizarMudanca({ status: 'confirmado' }).motivoObrigatorio, true);
  assert.equal(normalizarMudanca({ status: 'confirmado' }, { reasonRequired: false }).motivoObrigatorio, false);
  assert.equal(normalizarMudanca({ status: 'confirmado' }, { reasonRequired: true, defaultReason: 'x' }).motivoObrigatorio, true);
  assert.equal(normalizarMudanca({ status: 'confirmado' }, { defaultReason: 'profissional_inativado' }).motivoObrigatorio, false);
});

test('normalizar: comMotivoOuPadrao só é verdadeiro se houve motivo enviado ou padrão', () => {
  assert.equal(normalizarMudanca({ status: 'confirmado' }).comMotivoOuPadrao, false);
  assert.equal(normalizarMudanca({ reschedule_reason: '' }).comMotivoOuPadrao, true);
  assert.equal(normalizarMudanca({ status: 'confirmado' }, { autoReason: 'a' }).comMotivoOuPadrao, true);
});

test('normalizar: não altera o corpo recebido', () => {
  const body = Object.freeze({ status: 'confirmado', outcome: ' compareceu ' });
  assert.doesNotThrow(() => normalizarMudanca(body));
});

// ---------------------------------------------------------------------------
// applyBookingChange: caminhos que nem chegam ao banco
// ---------------------------------------------------------------------------

test('applyBookingChange: tipo desconhecido → 404; pedido inválido → 400, sem tocar na tabela', async () => {
  const consultas = [];
  const falso = { query: async (...a) => { consultas.push(a); return [[]]; } };
  assert.deepEqual(await applyBookingChange(falso, { kindKey: 'outro', id: 'x', body: { status: 'confirmado' } }),
    { status: 404, body: { error: 'Tipo inválido.' } });
  assert.deepEqual(await applyBookingChange(falso, { kindKey: 'appointments', id: 'x', body: { status: 'voando' } }),
    { status: 400, body: { error: 'Status inválido.' } });
  assert.deepEqual(await applyBookingChange(falso, { kindKey: 'exams', id: 'x', body: {} }),
    { status: 400, body: { error: 'Nada para atualizar.' } });
  assert.equal(consultas.length, 0, 'validação do pedido vem antes de qualquer SQL');
});

test('applyBookingChange: registro inexistente → 404 e a mesma conexão é usada (sem abrir transação própria)', async () => {
  const consultas = [];
  const falso = { query: async (sql) => { consultas.push(sql); return [[undefined]]; } };
  const r = await applyBookingChange(falso, { kindKey: 'appointments', id: 'nao-existe', body: { status: 'confirmado' } });
  assert.deepEqual(r, { status: 404, body: { error: 'Registro não encontrado.' } });
  assert.equal(consultas.length, 1);
  assert.match(consultas[0], /FOR UPDATE/);
});

test('applyBookingChange: com pool abre transação, faz rollback em recusa e libera a conexão', async () => {
  const log = [];
  const conn = {
    beginTransaction: async () => log.push('begin'),
    commit: async () => log.push('commit'),
    rollback: async () => log.push('rollback'),
    release: () => log.push('release'),
    query: async () => [[undefined]],
  };
  const pool = { getConnection: async () => conn };
  const r = await applyBookingChange(pool, { kindKey: 'exams', id: crypto.randomUUID(), body: { status: 'confirmado' } });
  assert.equal(r.status, 404);
  assert.deepEqual(log, ['begin', 'rollback', 'release']);

  // erro inesperado: rollback, libera e propaga
  log.length = 0;
  conn.query = async () => { throw new Error('banco caiu'); };
  await assert.rejects(applyBookingChange(pool, { kindKey: 'exams', id: 'x', body: { status: 'confirmado' } }), /banco caiu/);
  assert.deepEqual(log, ['begin', 'rollback', 'release']);
});

// ---------------------------------------------------------------------------
// repositories/atendimentos
// ---------------------------------------------------------------------------

test('repositório de atendimentos: tabela fora do mapa fechado é recusada antes do SQL', async () => {
  const falso = { query: async () => { throw new Error('não deveria consultar'); } };
  await assert.rejects(atendimentos.lerETravar(falso, 'users; DROP TABLE x', 'id'), /inválida/);
  await assert.rejects(atendimentos.atualizar(falso, 'users', 'id', ['a=?'], [1]), /inválida/);
  assert.deepEqual(Object.keys(atendimentos.TABELAS).sort(), ['appointments', 'exams']);
});
