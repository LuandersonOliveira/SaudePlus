/**
 * `/ready` é pública e consulta o banco a cada chamada.
 *
 * A Fase 0 a moveu para ANTES do `globalLimiter` — certo, porque um balanceador
 * consultando a cada 5s estourava a janela de 300 req/15min e passava a receber
 * 429 no lugar de tráfego real. Mas "antes do limiter global" significou
 * "sem limite": com `connectionLimit: 10`, um laço de requisições esgota o
 * pool e derruba a API inteira. Trocaram-se um problema por outro.
 *
 * A saída é um teto próprio, alto para o balanceador real (12/min) e baixo
 * para não ser via livre ao banco.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const app = require('../src/app');

let server;
let base;

test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((r) => server.close(r));
  // O pool segura o event loop: sem isto o processo termina os testes e não
  // sai, e o `npm test` inteiro parece travado em vez de reprovado.
  const pool = require('../src/db');
  await pool.end().catch(() => {});
});

test('/health nunca é limitado — é o liveness, não consulta nada', async () => {
  const respostas = [];
  for (let i = 0; i < 90; i += 1) {
    respostas.push((await fetch(`${base}/health`)).status);
  }
  assert.ok(
    respostas.every((s) => s === 200),
    `/health respondeu diferente de 200: ${[...new Set(respostas)].join(', ')}`
  );
});

test('/ready tem teto próprio: um laço esbarra em 429', async () => {
  const respostas = [];
  for (let i = 0; i < 90; i += 1) {
    respostas.push((await fetch(`${base}/ready`)).status);
  }
  const Ok = respostas.filter((s) => s === 200).length;
  const barrados = respostas.filter((s) => s === 429).length;

  assert.ok(Ok > 0, 'o balanceador real precisa passar — a sonda não pode estar bloqueada por padrão');
  assert.ok(
    barrados > 0,
    `sem teto, 90 chamadas de /ready batem no pool (10 conexões). Respostas: ${[...new Set(respostas)].join(', ')}`
  );
  // O número de 200 tem que caber no orçamento do balanceador: 12/min.
  assert.ok(Ok <= 70, `/ready deixou passar ${Ok} em um minuto — folga grande demais para uma sonda`);
});

test('a mensagem do limite é em português, como o resto da API', async () => {
  let corpo = null;
  for (let i = 0; i < 80; i += 1) {
    const res = await fetch(`${base}/ready`);
    if (res.status === 429) { corpo = await res.json(); break; }
  }
  assert.ok(corpo, 'esperava um 429 no laço');
  assert.match(corpo.error, /[a-zà-ú]/i);
  assert.ok(!/Too many requests/i.test(corpo.error), 'a mensagem não pode vazar o texto padrão do express-rate-limit');
});