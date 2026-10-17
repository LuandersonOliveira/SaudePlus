/**
 * "Respondeu sucesso e não fez nada."
 *
 * O grupo mais perigoso de defeitos que sobrou: não é exceção, não é tela
 * quebrada — é a API devolvendo 201/200 para algo que não foi persistido (ou
 * devolvendo null para algo que deveria ser 0). O front acredita, mostra o
 * registro na lista, e ninguém descobre até o dado sumir num relatório.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const jwt = require('jsonwebtoken');

const app = require('../src/app');
const pool = require('../src/db');

const RAIZ = path.resolve(__dirname, '..', '..');
const ler = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');

let server;
let base;
let tokenSuper;

const CRIADOS = { profissionais: [], ofertas: [], horarios: [], unidades: [] };

test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;

  const [[u]] = await pool.query("SELECT id, email, full_name FROM users WHERE role = 'admin' LIMIT 1");
  assert.ok(u, 'precisa de um admin no banco — rode npm run db:seed');
  tokenSuper = jwt.sign(
    { id: u.id, email: u.email, role: 'admin', admin_level: 'superadmin', full_name: u.full_name },
    process.env.JWT_SECRET,
    { expiresIn: '5m' }
  );
});

test.after(async () => {
  // Na ordem inversa das chaves estrangeiras.
  for (const o of CRIADOS.ofertas) await pool.query('DELETE FROM professional_offers WHERE id = ?', [o]).catch(() => {});
  for (const h of CRIADOS.horarios) await pool.query('DELETE FROM work_schedules WHERE id = ?', [h]).catch(() => {});
  for (const p of CRIADOS.profissionais) await pool.query('DELETE FROM professionals WHERE id = ?', [p]).catch(() => {});
  for (const u of CRIADOS.unidades) await pool.query('DELETE FROM health_units WHERE id = ?', [u]).catch(() => {});
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await pool.end().catch(() => {});
});

const auth = () => ({ Authorization: `Bearer ${tokenSuper}`, 'Content-Type': 'application/json' });
const post = (rota, body) => fetch(base + rota, { method: 'POST', headers: auth(), body: JSON.stringify(body) });

async function criarProfissional() {
  const res = await post('/admin/professionals', { name: `Prof. Silencioso ${Date.now()}`, job_title: 'Clínica Geral' });
  assert.equal(res.status, 201);
  const { id } = await res.json();
  CRIADOS.profissionais.push(id);
  return id;
}

async function criarUnidade() {
  // Unidades ficam em /health-units (não em /admin/health-units — o mount é
  // próprio, protegido por verifyToken + requireAdmin + capability 'units').
  const res = await post('/health-units', { name: `UBS Silenciosa ${Date.now()}`, type: 'ubs', neighborhood: 'Centro' });
  assert.equal(res.status, 201, `criar unidade devolveu ${res.status}`);
  const { id } = await res.json();
  CRIADOS.unidades.push(id);
  return id;
}

// ===========================================================================
// INSERT IGNORE devolvendo 201 com id que não existe
// ===========================================================================

test('vínculo duplicado NÃO devolve 201 com um id que não foi persistido', async () => {
  // `professional_offers` tem UNIQUE (professional_id, unit_id, kind, name).
  // O INSERT IGNORE engolia a duplicata, a rota respondia 201 com o id gerado
  // e a auditoria registrava "criou vínculo" para algo que não foi criado. O
  // front mostrava o vínculo na lista e sumia no próximo F5.
  const prof = await criarProfissional();
  const unidade = await criarUnidade();
  const corpo = { unit_id: unidade, kind: 'consulta', name: 'Clínica Geral' };

  const primeira = await post(`/admin/professionals/${prof}/offers`, corpo);
  assert.equal(primeira.status, 201);
  const { id } = await primeira.json();
  CRIADOS.ofertas.push(id);

  const segunda = await post(`/admin/professionals/${prof}/offers`, corpo);
  const body2 = await segunda.json();

  assert.notEqual(segunda.status, 201, 'o duplicado não pode responder "criado"');
  assert.ok([200, 409].includes(segunda.status), `status inesperado: ${segunda.status}`);

  if (body2.id) {
    const [[existe]] = await pool.query('SELECT id FROM professional_offers WHERE id = ?', [body2.id]);
    assert.ok(existe, `a resposta-devolveu id ${body2.id}, que não está no banco`);
  }

  // E o vínculo real continua lá, um só.
  const [[total]] = await pool.query(
    'SELECT COUNT(*) AS n FROM professional_offers WHERE professional_id = ? AND unit_id = ? AND kind = ? AND name = ?',
    [prof, unidade, 'consulta', 'Clínica Geral']
  );
  assert.equal(Number(total.n), 1);
});

test('oferta de serviço duplicado em /health-units segue a mesma regra', async () => {
  // Mesmo defeito em `unit_offers` (units.routes.js).
  const unidade = await criarUnidade();
  const corpo = { kind: 'consulta', name: 'Clínica Geral' };
  const primeira = await post(`/health-units/${unidade}/offers`, corpo);
  assert.equal(primeira.status, 201, `primeira oferta devolveu ${primeira.status}`);
  const { id } = await primeira.json();
  CRIADOS.ofertas.push(id);

  const segunda = await post(`/health-units/${unidade}/offers`, corpo);
  const body2 = await segunda.json();
  assert.notEqual(segunda.status, 201, 'o duplicado não pode responder "criado"');
  if (body2.id) {
    const [[existe]] = await pool.query('SELECT id FROM unit_offers WHERE id = ?', [body2.id]);
    assert.ok(existe, `a resposta devolveu id ${body2.id}, que não está no banco`);
  }
});

// ===========================================================================
// SUM() sobre tabela vazia devolvendo null
// ===========================================================================

test('/admin/stats devolve números, nunca null', async () => {
  // SUM() sobre zero linhas é NULL no MySQL — não 0. O painel admin recebia
  // pending: null e renderizava "null" (ou NaN) nos cards.
  const res = await fetch(`${base}/admin/stats`, { headers: auth() });
  assert.equal(res.status, 200);
  const s = await res.json();

  const numeros = [];
  const coleta = (obj, prefixo = '') => {
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'number') numeros.push([prefixo + k, v]);
      else if (v && typeof v === 'object' && !Array.isArray(v)) coleta(v, `${prefixo}${k}.`);
    }
  };
  coleta(s);
  assert.ok(numeros.length > 0, 'o painel deveria ter contadores');

  for (const [chave, valor] of numeros) {
    assert.ok(Number.isFinite(valor), `/admin/stats devolveu ${chave} = ${valor}`);
  }
  for (const [k, v] of Object.entries(s)) {
    assert.notEqual(v, null, `/admin/stats devolveu ${k}: null`);
  }
});

test('a agregação do painel trata linha vazia como zero', () => {
  // O comportamento do COALESCE acima é testável sem esvaziar tabela nenhuma:
  // o helper que normaliza a linha do COUNT/SUM tem que devolver 0 para null.
  const { normalizeCounts } = require('../src/utils/stats');
  assert.deepEqual(normalizeCounts({ total: 0, pending: null, inactive: null }), {
    total: 0,
    pending: 0,
    inactive: 0,
  });
  assert.deepEqual(normalizeCounts({ total: 3, pending: 2 }), { total: 3, pending: 2 });
});

// ===========================================================================
// TIME_RE aceitando 99:99
// ===========================================================================

test('horário inválido é rejeitado na agenda do profissional', async () => {
  // `TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/` aceitava "99:99". O MySQL
  // trunca/erra em silêncio dependendo da versão, e o horário Some dos filtros
  // de disponibilidade — o profissional some do próprio horário de atendimento.
  const prof = await criarProfissional();
  const unidade = await criarUnidade();

  for (const horario of ['99:99', '25:00', '12:99']) {
    const res = await post(`/admin/professionals/${prof}/schedules`, {
      unit_id: unidade,
      weekday: 1,
      start_time: horario,
      end_time: '17:00',
      slot_minutes: 30,
    });
    assert.equal(res.status, 400, `"${horario}" deveria dar 400, deu ${res.status}`);
    const body = await res.json();
    assert.ok(body.error && body.error.length > 0, 'o 400 precisa explicar o que happened');
  }

  // E o válido continua entrando.
  const ok = await post(`/admin/professionals/${prof}/schedules`, {
    unit_id: unidade,
    weekday: 1,
    start_time: '08:00',
    end_time: '17:00',
    slot_minutes: 30,
  });
  assert.equal(ok.status, 201);
  CRIADOS.horarios.push((await ok.json()).id);
});

test('cleanTime rejeita hora/minuto fora de faixa', () => {
  const { cleanTime } = require('../src/routes/admin.professionals.routes');
  assert.equal(cleanTime('08:00'), '08:00:00');
  assert.equal(cleanTime('99:99'), null);
  assert.equal(cleanTime('24:00'), null);
  assert.equal(cleanTime('08:00:30'), '08:00:00', 'segundos são aceitos e normalizados');
  assert.equal(cleanTime(null), null);
  assert.equal(cleanTime(''), null);
});

// ===========================================================================
// Rota /admin/users duplicada (código morto)
// ===========================================================================

test('GET /admin/users responde o envelope, e existe em um lugar só', async () => {
  const res = await fetch(`${base}/admin/users`, { headers: auth() });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.data), '/admin/users precisa devolver { data: [...] }');
  assert.equal(Number.isInteger(body.total), true);

  // Havia DUAS implementações: router.get('/users') em admin.routes.js e
  // router.get('/') em admin.users.routes.js. O mount de /admin/users vem
  // antes do /admin genérico, então a de admin.routes.js nunca executava —
  // código morto que só desorienta quem for mexer na rota.
  //
  // Comentários são removidos antes do teste: a nota que explica por que a rota
  // foi apagada precisa citar o código que foi apagado, senão o teste obriga
  // alguém a escrever um comentário que não pode ser escrito.
  const fonte = ler('server/src/routes/admin.routes.js')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
  assert.ok(
    !/router\.get\(\s*['"]\/users['"]/.test(fonte),
    'admin.routes.js ainda registra GET /users, que é código morto'
  );
});