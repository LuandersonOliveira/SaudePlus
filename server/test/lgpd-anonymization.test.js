/**
 * Anonimização LGPD precisa ser tudo ou nada.
 *
 * `anonymizeUser` rodava 6 statements independentes. Se o terceiro falhasse,
 * o estado final era o pior possível num pedido do art. 18, VI:
 *
 *   - o perfil JÁ estava apagado (nome, CPF, CNS, endereço, nascimento);
 *   - mas as consultas futuras NÃO foram canceladas;
 *   - e os refresh tokens continuavam válidos.
 *
 * Ou seja: o titular eradeclared removido e mesmo assim conseguia entrar e
 * tinha agenda. E como o titular não tem mais e-mail nem telefone para ser
 * avisado, ninguém nunca saberia que a exclusão ficou pela metade.
 *
 * Estes testes usam um pool falso para simular a falha no meio — é o único
 * jeito de cobrir "e se a terceira consulta falhar" sem corromper a base de
 * desenvolvimento.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { anonymizeUser } = require('../src/utils/privacy');

/**
 * Pool falso que registra o que foi executado e falha na N-ésima query de
 * escrita. `beginTransaction`/`commit`/`rollback` ficam registrados para
 * poderem ser verificados.
 */
function poolFalso({ falharNa = null } = {}) {
  const registro = {
    escritas: [],
    sqls: [],
    begun: 0,
    commit: 0,
    rollback: 0,
    liberado: false,
  };
  let escritas = 0;

  const conn = {
    async beginTransaction() { registro.begun += 1; },
    async commit() { registro.commit += 1; },
    async rollback() { registro.rollback += 1; },
    release() { registro.liberado = true; },
    async query(sql) {
      const txt = String(sql);
      if (/^\s*SELECT/i.test(txt)) return [[{ id: 'u1', email: 'alvo@x.local' }]];
      escritas += 1;
      registro.escritas.push(txt.slice(0, 60).replace(/\s+/g, ' '));
      registro.sqls.push(txt.replace(/\s+/g, ' '));
      if (falharNa === escritas) {
        const e = new Error('deadlock_simulado');
        e.code = 'ER_LOCK_DEADLOCK';
        throw e;
      }
      return [{ affectedRows: 1 }];
    },
  };

  const pool = {
    async query(sql) { return conn.query(sql); },
    async getConnection() { return conn; },
  };
  return { pool, registro };
}

test('a anonimização roda dentro de uma transação', async () => {
  const { pool, registro } = poolFalso();
  const ok = await anonymizeUser(pool, 'u1');

  assert.equal(ok, true);
  assert.equal(registro.begun, 1, 'deveria abrir uma transação');
  assert.equal(registro.commit, 1, 'deveria confirmar');
  assert.equal(registro.rollback, 0);
  assert.equal(registro.liberado, true, 'a conexão tem que voltar ao pool');
});

test('falha no meio desfaz TUDO, em vez de deixar o titular pela metade', async () => {
  // Falha na 3ª escrita: o perfil já foi apagado quando o cancelamento das
  // consultas estoura. Sem transação, era exatamente esse o estado deixado.
  const { pool, registro } = poolFalso({ falharNa: 3 });

  await assert.rejects(() => anonymizeUser(pool, 'u1'), /deadlock_simulado/);

  assert.equal(registro.rollback, 1, 'tem que reverter');
  assert.equal(registro.commit, 0, 'não pode confirmar depois de um erro');
  assert.equal(registro.liberado, true, 'mesmo com erro a conexão volta ao pool');
});

test('a transação cobre TODAS as escritas, inclusive revogação de tokens', async () => {
  const { pool, registro } = poolFalso();
  await anonymizeUser(pool, 'u1');

  const todas = registro.escritas.join(' | ');
  for (const esperado of ['UPDATE users SET', 'appointments', 'exams', 'refresh_tokens']) {
    assert.ok(todas.includes(esperado), `faltou "${esperado}" dentro da transação: ${todas}`);
  }
});

// ADR-0009 (E-10): o que ainda identificava ou guardava segredo depois da anonimização.
test('zera também govbr_sub, IP do consentimento e o segundo fator (ADR-0009)', async () => {
  const { pool, registro } = poolFalso();
  await anonymizeUser(pool, 'u1');

  const update = registro.sqls.find((s) => /^UPDATE users SET/.test(s));
  assert.ok(update, 'deveria haver um UPDATE users');
  for (const coluna of ['govbr_sub = NULL', 'consent_ip = NULL', 'totp_secret = NULL', 'totp_enabled = 0', 'totp_last_step = NULL']) {
    assert.ok(update.includes(coluna), `faltou "${coluna}" na anonimização: ${update}`);
  }
});

test('revoga também os links de redefinição de senha pendentes (ADR-0009)', async () => {
  const { pool, registro } = poolFalso();
  await anonymizeUser(pool, 'u1');
  assert.ok(
    registro.sqls.some((s) => /^UPDATE password_reset_tokens SET used_at/.test(s)),
    `faltou invalidar password_reset_tokens: ${registro.sqls.join(' | ')}`
  );
});

test('preserva deleted_at quando a conta já tinha sido excluída antes', async () => {
  // O script de correção anonimiza contas que o admin já "excluiu": a data original da exclusão não pode ser sobrescrita.
  const { pool, registro } = poolFalso();
  await anonymizeUser(pool, 'u1');
  const update = registro.sqls.find((s) => /^UPDATE users SET/.test(s));
  assert.match(update, /deleted_at = COALESCE\(deleted_at, CURRENT_TIMESTAMP\)/);
});

test('usuário inexistente não abre transação nem mexe em nada', async () => {
  const registro = { begun: 0, commit: 0, rollback: 0 };
  const conn = {
    async beginTransaction() { registro.begun += 1; },
    async commit() { registro.commit += 1; },
    async rollback() { registro.rollback += 1; },
    release() {},
    async query() { return [[]]; }, // SELECT sem resultado
  };
  const pool = { async query(sql) { return conn.query(sql); }, async getConnection() { return conn; } };

  const ok = await anonymizeUser(pool, 'inexistente');
  assert.equal(ok, false);
  assert.equal(registro.begun, 0, 'não há o que transacionar');
});

test('pool sem getConnection é recusado, em vez de rodar sem transação', async () => {
  // Um "fallback" que executa as 6 escritas sem transação seria uma armadilha:
  // a atomicidade desapareceria em silêncio e o estado parcial voltaria a
  // ser possível. O erro tem que ser explícito na hora do bug.
  const pool = { async query() { return [[{ id: 'u1', email: 'a@b.local' }]]; } };
  await assert.rejects(
    () => anonymizeUser(pool, 'u1'),
    /getConnection/,
    'deveria recusar um pool sem transação'
  );
});