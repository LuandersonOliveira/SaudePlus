/**
 * A4: o job de lembretes roda dentro de cada instância da API. Sem trava, duas
 * instâncias mandavam o mesmo lembrete duas vezes ("já existe?" + INSERT não é
 * atômico). A trava é GET_LOCK do MySQL: uma instância por vez, solta sozinha se
 * a conexão cair.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SERVER = path.resolve(__dirname, '..');
require(require.resolve('dotenv', { paths: [SERVER] })).config({ path: path.join(SERVER, '.env') });

const pool = require('../src/db');
const { comTravaDeJob } = require('../src/utils/jobLock');

test.after(async () => { await pool.end().catch(() => {}); });

const nome = () => `teste-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;

test('segunda instância pula a rodada enquanto a primeira executa; depois a trava volta', async () => {
  const job = nome();
  let liberar;
  const portao = new Promise((r) => { liberar = r; });
  let entrou;
  const dentro = new Promise((r) => { entrou = r; });

  const primeira = comTravaDeJob(pool, job, async () => { entrou(); await portao; return 'a'; });
  await dentro;

  const segunda = await comTravaDeJob(pool, job, async () => 'b');
  assert.deepEqual(segunda, { ran: false }, 'com a trava ocupada a outra instância não pode executar');

  liberar();
  assert.deepEqual(await primeira, { ran: true, result: 'a' });

  const terceira = await comTravaDeJob(pool, job, async () => 'c');
  assert.deepEqual(terceira, { ran: true, result: 'c' }, 'a trava precisa ser solta ao fim');
});

test('várias tentativas simultâneas: exatamente uma executa', async () => {
  const job = nome();
  let execucoes = 0;
  const resultados = await Promise.all(Array.from({ length: 6 }, () =>
    comTravaDeJob(pool, job, async () => { execucoes += 1; await new Promise((r) => setTimeout(r, 150)); })));
  assert.equal(execucoes, 1);
  assert.equal(resultados.filter((r) => r.ran).length, 1);
});

test('se o job lança, a trava é solta e o erro continua subindo', async () => {
  const job = nome();
  await assert.rejects(comTravaDeJob(pool, job, async () => { throw new Error('boom'); }), /boom/);
  const de_novo = await comTravaDeJob(pool, job, async () => 'ok');
  assert.equal(de_novo.ran, true);
});

test('jobs com nomes diferentes não se bloqueiam', async () => {
  let liberar;
  const portao = new Promise((r) => { liberar = r; });
  let entrou;
  const dentro = new Promise((r) => { entrou = r; });
  const a = comTravaDeJob(pool, nome(), async () => { entrou(); await portao; });
  await dentro;
  const b = await comTravaDeJob(pool, nome(), async () => 'b');
  assert.equal(b.ran, true);
  liberar();
  await a;
});

test('a conexão volta ao pool: muitas rodadas seguidas não esgotam o pool', async () => {
  const job = nome();
  for (let i = 0; i < 25; i += 1) {
    const r = await comTravaDeJob(pool, job, async () => i);
    assert.equal(r.result, i);
  }
});

test('instância que morreu com a trava: o MySQL solta e a próxima assume', async () => {
  const job = nome();
  const conn = await pool.getConnection();
  const [[db]] = await conn.query('SELECT DATABASE() AS db');
  const [[got]] = await conn.query('SELECT GET_LOCK(?, 0) AS got', [`saude:${db.db}:${job}`.slice(0, 64)]);
  assert.equal(Number(got.got), 1);

  assert.deepEqual(await comTravaDeJob(pool, job, async () => 'x'), { ran: false }, 'enquanto viva, a trava vale');

  conn.destroy(); // processo "caiu": a conexão fecha sem RELEASE_LOCK
  let r = { ran: false };
  for (let i = 0; i < 20 && !r.ran; i += 1) {
    r = await comTravaDeJob(pool, job, async () => 'assumiu');
    if (!r.ran) await new Promise((res) => setTimeout(res, 100));
  }
  assert.deepEqual(r, { ran: true, result: 'assumiu' });
});

test('o agendador do job de lembretes usa a trava', () => {
  const fonte = fs.readFileSync(path.join(SERVER, 'src', 'jobs', 'reminders.js'), 'utf8');
  assert.match(fonte, /comTravaDeJob\(pool, 'reminders'/);
});
