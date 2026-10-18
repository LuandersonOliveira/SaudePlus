/**
 * `PUT /auth/me` precisa devolver 400, nunca 500, para dado que não cabe.
 *
 * A rota valida ENUM (`validateEnum`) e data (`validateDate`) — mas não
 * comprimentos. Com `sql_mode` contendo `STRICT_TRANS_TABLES`, mandar
 * `state: "São Paulo"` numa coluna `CHAR(2)` faz o MySQL recusar com
 * `ER_DATA_TOO_LONG`, e o handler genérico transforma em:
 *
 *   500 {"error":"Erro interno do servidor."}
 *
 * Que é a pior resposta possível para um erro de digitação: o formulário diz ao
 * usuário que o servidor quebrou, e ninguém descobre que o campo é curto demais
 * olhando o console.
 *
 * O mesmo vale para qualquer VARCHAR curto: `cep`, `phone`, `address_number`.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const app = require('../src/app');
const pool = require('../src/db');

const ALVO = { id: '00000000-0000-4000-8000-00000000e001', email: 'limites@caps.local' };

let server;
let base;
let token;

// Limite por coluna, copiado do schema.sql. `profile-field-limits.test.js`
// confere esta tabela contra o schema — foi ela que pegou `phone: 20` quando
// o VARCHAR é 30. Os ENUM não entram aqui: quem valida enum é validateEnum.
const LIMITES = {
  state: 2,                // CHAR(2) — sigla da UF
  cep: 9,                  // VARCHAR(9)
  phone: 30,
  mobile: 30,
  address_number: 10,
  neighborhood: 100,
  city: 100,
  street: 180,
  social_name: 150,
  guardian_name: 150,
  mother_name: 150,
  father_name: 150,
  job_role: 100,
  reference_point: 255,
};

const put = (corpo) => fetch(`${base}/auth/me`, {
  method: 'PUT',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(corpo),
});

test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  await pool.query(
    `INSERT INTO users (id, full_name, email, password_hash, role, account_status)
     VALUES (?, 'Teste Limites', ?, 'x', 'paciente', 'ativo')
     ON DUPLICATE KEY UPDATE account_status = 'ativo'`,
    [ALVO.id, ALVO.email]
  );
  token = jwt.sign({ id: ALVO.id, email: ALVO.email, role: 'paciente', full_name: 'Teste Limites' },
    process.env.JWT_SECRET, { expiresIn: '5m' });
});

test.after(async () => {
  // A conta fica: depois do primeiro PUT bem-sucedido existe linha em
  // audit_log, e `audit_log.actor_id` é FK RESTRICT — apagar o usuário
  // falharia. O .catch só evita que a limpeza derrube o teste; a conta é
  // reaproveitada pelo id fixo, então não acumula.
  await pool.query('DELETE FROM users WHERE id = ?', [ALVO.id]).catch(() => {});
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await pool.end().catch(() => {});
});

test('state maior que 2 caracteres devolve 400, não 500', async () => {
  const res = await put({ state: 'São Paulo' });
  assert.equal(res.status, 400, `esperava 400, veio ${res.status}`);
  const body = await res.json();
  assert.match(body.error, /[a-zà-ú]/i, 'a mensagem tem que explicar o problema');
  assert.ok(!/interno/i.test(body.error), 'não pode vazar erro interno');
});

test('cep com 20 caracteres devolve 400', async () => {
  const res = await put({ cep: '12345678901234567890' });
  assert.equal(res.status, 400, `esperava 400, veio ${res.status}`);
});

test('street, city e neighborhood fora do limite devolvem 400', async () => {
  for (const coluna of ['street', 'city', 'neighborhood']) {
    const res = await put({ [coluna]: 'x'.repeat(LIMITES[coluna] + 1) });
    assert.equal(res.status, 400, `${coluna} com ${LIMITES[coluna] + 1} chars devia dar 400, deu ${res.status}`);
  }
});

test('valores válidos continuam passando', async () => {
  // Contra-prova: a validação de tamanho não pode ter estragado o caminho
  // feliz, incluindo limpeza (string vazia = apagar o campo).
  for (const [coluna, valor] of [
    ['state', 'sp'],
    ['cep', '01001000'],
    ['street', 'Rua das Palmeiras'],
    ['city', 'Lagoa de Itaenga'],
    ['state', ''],
  ]) {
    const res = await put({ [coluna]: valor });
    assert.equal(res.status, 200, `${coluna}="${valor}" devia passar, deu ${res.status}`);
  }
});

test('a validação existe no código e cobre a tabela de limites', () => {
  // Trava a intenção: remover a checagem de tamanho quebraria os testes
  // acima de novo, e o 500 voltaria sem ninguém perceber.
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'auth.routes.js'), 'utf8');
  assert.match(src, /LIMITES|CAMPO_LIMITE|limite de/i, 'a rota precisa de uma tabela de limites por coluna');
  for (const coluna of Object.keys(LIMITES)) {
    assert.ok(src.includes(coluna), `a rota deveria conhecer o limite de ${coluna}`);
  }
});

test('a tabela de limites bate com o schema.sql', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const schema = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
  const bloco = /CREATE TABLE IF NOT EXISTS\s+users\s*\([\s\S]*?\) ENGINE/i.exec(schema);
  assert.ok(bloco, 'schema.sql deveria criar users');

  for (const [coluna, max] of Object.entries(LIMITES)) {
    // CHAR(n) e VARCHAR(n) — a diferença não importa para o limite.
    const def = new RegExp(`\\b${coluna}\\s+(?:CHAR|VARCHAR)\\((\\d+)\\)`, 'i').exec(bloco[0]);
    if (!def) continue; // colunas ENUM/TEXT não têm limite numérico
    assert.equal(
      Number(def[1]),
      max,
      `LIMITES.${coluna} = ${max} não bate com o schema (${def[1]})`
    );
  }
});