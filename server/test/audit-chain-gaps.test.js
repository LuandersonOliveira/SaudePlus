/**
 * O verificador de integridade da auditoria gritava "cadeia quebrada" para uma
 * cadeia intacta.
 *
 * `seq` é AUTO_INCREMENT, e o MySQL consome o valor ANTES do INSERT: se a
 * transação rodar back (chave duplicada, por exemplo), o número é gasto e a
 * linha nunca aparece. Um salto na sequência é comportamento normal do
 * banco, não adulteração.
 *
 * O verificador antigo comparava `rows[i].prev_hash` com `rows[i-1].entry_hash`
 * percorrendo por `seq`. Com um salto, as duas linhas não são vizinhas e a
 * comparação falha — "elo anterior divergente" numa cadeia que ninguém mexeu.
 *
 * A forma correta é seguir o encadeamento pelo próprio hash: partir de
 * GENESIS e caminhar de elo em elo. Salto de `seq` deixa de importar, e
 * adulteração de conteúdo continua sendo detectada.
 *
 * Testado com um pool falso (verifyChain recebe qualquer coisa com `query`),
 * porque o defeito é sobre a forma de percorrer, não sobre SQL.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const { chainHash, verifyChain } = require('../src/utils/audit');

// Monta uma cadeia de N linhas e devolve um pool falso que a serve.
function cadeiaDe(n, { aPartirDoSeq = 1, pularSeq = [] } = {}) {
  const linhas = [];
  let prev = 'GENESIS';
  let seq = aPartirDoSeq;
  const T = '2026-10-16 10:00:00';
  for (let i = 0; i < n; i += 1) {
    const actor = `ator-${i}`;
    const action = 'create';
    const entityType = 'user';
    const entityId = `ent-${i}`;
    const details = `linha ${i}`;
    const hash = chainHash(prev, actor, action, entityType, entityId, details, T);
    // O pulo imita o auto-increment consumido por uma transação que rolou back.
    while (pularSeq.includes(seq)) seq += 1;
    linhas.push({
      id: `id-${i}`,
      actor_id: actor,
      action,
      entity_type: entityType,
      entity_id: entityId,
      details,
      prev_hash: prev,
      entry_hash: hash,
      created_at: T,
      seq,
    });
    seq += 1;
    prev = hash;
  }
  const pool = {
    async query(sql) {
      if (/ORDER BY seq/i.test(sql)) return [linhas.slice().sort((a, b) => a.seq - b.seq)];
      throw new Error(`SQL inesperado: ${sql}`);
    },
  };
  return { pool, linhas };
}

test('cadeia sem salto: íntegra', async () => {
  const { pool, linhas } = cadeiaDe(6);
  const r = await verifyChain(pool);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.checked, linhas.length);
  assert.equal(r.head, linhas[linhas.length - 1].entry_hash);
});

test('salto no seq NÃO é quebra: a cadeia segue inteira', async () => {
  // Este é o defeito. O `seq` 4 e o 6 são consumidos por transações que
  // rolaram back; as linhas 4 e 6 não existem. A integridade depende do
  // encadeamento por hash, não da vizinhança numérica.
  const { pool, linhas } = cadeiaDe(6, { pularSeq: [4, 6] });
  assert.equal(linhas.length, 6);
  assert.ok(
    linhas.some((l, i) => i > 0 && l.seq - linhas[i - 1].seq > 1),
    'o cenário precisa ter mesmo um salto de sequência'
  );

  const r = await verifyChain(pool);
  assert.equal(r.ok, true, `salto de seq não pode ser erro: ${JSON.stringify(r)}`);
  assert.equal(r.checked, 6);
});

test('salto no começo e no fim também é normal', async () => {
  const { pool } = cadeiaDe(4, { aPartirDoSeq: 1000, pularSeq: [1000, 1003] });
  const r = await verifyChain(pool);
  assert.equal(r.ok, true, JSON.stringify(r));
});

test('conteúdo alterado é detectado', async () => {
  const { pool, linhas } = cadeiaDe(5);
  linhas[2].details = 'linha 2 adulterada';
  const r = await verifyChain(pool);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'conteúdo alterado');
  assert.equal(r.firstBad, 'id-2');
});

test('elo apontando para hash inexistente é detectado', async () => {
  // Linha脱落: alguém aponta o prev_hash para um hash que não existe na
  // tabela. A linha é re-hashada para ser consistente por si mesma (senão o
  // verificador acusaria "conteúdo alterado", um diagnóstico ainda mais forte),
  // e mesmo assim a cadeia não fecha.
  const { pool, linhas } = cadeiaDe(5);
  const alvo = linhas[3];
  alvo.prev_hash = 'hash-que-nao-existe';
  alvo.entry_hash = chainHash(alvo.prev_hash, alvo.actor_id, alvo.action, alvo.entity_type, alvo.entity_id, alvo.details, alvo.created_at);

  const r = await verifyChain(pool);
  assert.equal(r.ok, false);
  assert.match(r.reason, /divergente|alterado/);
});

test('mudança no prev_hash sem recalcular o hash é "conteúdo alterado"', async () => {
  // O caso mais forte de todos: mexeram no elo E o hash não fecha. A detecção
  // de conteúdo vem antes da de encadeamento porque é o sinal mais grave.
  const { pool, linhas } = cadeiaDe(5);
  linhas[2].prev_hash = 'hash-forjado';
  const r = await verifyChain(pool);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'conteúdo alterado');
  assert.equal(r.firstBad, 'id-2');
});

test('linha fora da cadeia (órfã) é detectada', async () => {
  const { pool, linhas } = cadeiaDe(4);
  // Uma linha autêntica em si, mas que não é alcançável a partir de GENESIS.
  const orfa = {
    id: 'id-orfa',
    actor_id: 'x',
    action: 'create',
    entity_type: 'user',
    entity_id: 'y',
    details: 'órfã',
    prev_hash: 'cadeia-que-nao-existe',
    entry_hash: 'hash-orfa',
    created_at: '2026-10-16 10:00:00',
    seq: 99,
  };
  linhas.push(orfa);
  const r = await verifyChain(pool);
  assert.equal(r.ok, false, 'órfã não pode passar como cadeia íntegra');
});

test('linha pré-migração (sem hash) continua sendo apontada', async () => {
  const { pool, linhas } = cadeiaDe(3);
  linhas[1].entry_hash = null;
  const r = await verifyChain(pool);
  assert.equal(r.ok, false);
  assert.match(r.reason, /sem hash/);
});

test('cadeia vazia é íntegra (não há o que quebrar)', async () => {
  const pool = { async query() { return [[]]; } };
  const r = await verifyChain(pool);
  assert.equal(r.ok, true);
  assert.equal(r.checked, 0);
});

// ===========================================================================
// A ordem da cadeia NÃO é a ordem do seq — e isso precisa ser detectado
// ===========================================================================

test('duas linhas penduradas no mesmo elo = divergência real', async () => {
  // Este é o que acontece quando duas escritas concorrentes leem a mesma
  // cabeça: as duas linhas apontam para 370, e uma delas é órfã da outra.
  // Não é "cadeia quebrada" por ruído — é exatamente o adulteramento (ou a
  // corrida) que o verificador existe para achar.
  const { pool, linhas } = cadeiaDe(4);
  const ultimo = linhas[linhas.length - 1];
  linhas.push({
    ...ultimo,
    id: 'id-concorrente',
    seq: ultimo.seq + 1,
    details: 'escrita concorrente',
    entry_hash: chainHash(ultimo.prev_hash, ultimo.actor_id, ultimo.action,
      ultimo.entity_type, ultimo.entity_id, 'escrita concorrente', ultimo.created_at),
  });
  const r = await verifyChain(pool);
  assert.equal(r.ok, false);
  assert.match(r.reason, /^elo anterior divergente/, `reason inesperado: ${r.reason}`);
  assert.equal(r.firstBad, 'id-concorrente');
});

test('encadeamento fora da ordem do seq é aceito quando não há divergência', async () => {
  // Um backfill (ou uma escrita que entrou depois, com seq menor) não
  // invalida a cadeia: o que define a ordem é o elo de hash, não o número.
  const { linhas } = cadeiaDe(4);
  // Reordena o array como o banco devolveria por seq, mas a cadeia continua
  // certa — o único caminho válido é seguir prev_hash.
  const bagunado = linhas.slice().reverse();
  const poolBagunado = { async query() { return [bagunado]; } };
  const r = await verifyChain(poolBagunado);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.checked, 4);
});