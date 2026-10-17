/**
 * O boot não sobe num esquema que quebraria a agenda.
 *
 * `duration_minutes` (migration 007) é referenciada no SELECT de
 * disponibilidade e no INSERT do agendamento, sem fallback. Banco sem a coluna
 * = 500 em todo agendamento.
 *
 * A alternativa seria degradar para 30 min, e isso foi descartado de propósito:
 * devolveria o agendamento sobreposto em silêncio — dois compromissos no mesmo
 * profissional sem nenhum sinal. Um 500 é ruim, mas visível. Por isso o app
 * recusa o boot e diz exatamente qual comando rodar.
 *
 * O teste também cobre o outro lado do acordo: uma base migrada precisa
 * passar, senão o guard seria um primeiro passo para não subir nunca.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { conferirColunas, COLUNAS_OBRIGATORIAS } = require('../src/server');

/** Pool falso que responde information_schema.columns. */
function poolCom(presentes) {
  return {
    async query() {
      return [presentes.map((p) => ({ t: p.split('.')[0], c: p.split('.')[1] }))];
    },
  };
}

test('base completa: o boot segue', async () => {
  const r = await conferirColunas(poolCom([
    'appointments.duration_minutes',
    'exams.duration_minutes',
  ]));
  assert.equal(r.ok, true);
  assert.deepEqual(r.faltando, []);
});

test('base sem duration_minutes: o boot é recusado com a lista do que falta', async () => {
  const r = await conferirColunas(poolCom(['exams.duration_minutes']));
  assert.equal(r.ok, false, 'faltando uma coluna, o app não pode subir');
  assert.deepEqual(r.faltando, ['appointments.duration_minutes']);
});

test('base sem nenhuma das duas: ambas são apontadas', async () => {
  const r = await conferirColunas(poolCom([]));
  assert.equal(r.ok, false);
  assert.equal(r.faltando.length, COLUNAS_OBRIGATORIAS.length);
});

test('totp_last_step NÃO é obrigatória — essa rota tem fallback próprio', async () => {
  // Deliberado: /auth/mfa/verify trata ER_BAD_FIELD_ERROR e degrada só o
  // replay, com aviso no console. Bloquear o boot por causa disso tiraria o
  // segundo fator de quem já tem MFA funcionando por causa de uma coluna de
  // endurecimento — troca ruim.
  const nomes = COLUNAS_OBRIGATORIAS.map(([t, c]) => `${t}.${c}`);
  assert.ok(!nomes.includes('users.totp_last_step'));
});

test('a coluna é exigida de verdade — o código referencia duration_minutes', () => {
  // Trava a intenção: se alguém remover a coluna do INSERT por "otimização",
  // este teste passa a falhar em vez de o bug voltar em silêncio.
  const fs = require('node:fs');
  const path = require('node:path');
  const rota = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'me.booking.routes.js'), 'utf8');
  assert.match(rota, /columns\.push\('duration_minutes'\)/, 'o INSERT precisa gravar a duração');

  const booking = fs.readFileSync(path.join(__dirname, '..', 'src', 'utils', 'booking.js'), 'utf8');
  assert.match(booking, /duration_minutes FROM/, 'o cálculo de conflito precisa ler a duração');
});