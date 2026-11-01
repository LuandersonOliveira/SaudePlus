const crypto = require('node:crypto');
/**
 * Fase 1.8 - saÃºde do catÃ¡logo: serviÃ§os ativos sem profissional ativo ou sem escala.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const jwt = require('jsonwebtoken');

const SERVER = path.resolve(__dirname, '..');
require(require.resolve('dotenv', { paths: [SERVER] })).config({ path: path.join(SERVER, '.env') });

const app = require('../src/app');
const pool = require('../src/db');

const P = {
  unidade: '00000000-0000-4000-8000-0000001f0001',
  profAtivo: '00000000-0000-4000-8000-0000001f0002',
  profComEscala: '00000000-0000-4000-8000-0000001f0005',
  profInativo: '00000000-0000-4000-8000-0000001f0003',
  admin: '00000000-0000-4000-8000-0000001f0004',
  schedule: '00000000-0000-4000-8000-0000001f0010',
  ofertaSemProf: '00000000-0000-4000-8000-0000001f0020',
  ofertaSemEscala: '00000000-0000-4000-8000-0000001f0021',
  ofertaOk: '00000000-0000-4000-8000-0000001f0022',
};

let server;
let base;
let token;

const headers = () => ({ Authorization: `Bearer ${token}` });

async function preparar() {
  await pool.query('INSERT IGNORE INTO health_units (id, name, type, neighborhood) VALUES (?,?,?,?)',
    [P.unidade, 'UBS Catalogo', 'ubs', 'Centro']);
  await pool.query(
    'INSERT INTO professionals (id, name, job_title, active) VALUES (?,?,?,1) ON DUPLICATE KEY UPDATE active=1',
    [P.profAtivo, 'Prof Ativo', 'ClÃ­nica Geral']
  );
  await pool.query(
    'INSERT INTO professionals (id, name, job_title, active) VALUES (?,?,?,1) ON DUPLICATE KEY UPDATE active=1',
    [P.profComEscala, 'Prof Com Escala', 'ClÃ­nica Geral']
  );
  await pool.query(
    'INSERT INTO professionals (id, name, job_title, active) VALUES (?,?,?,0) ON DUPLICATE KEY UPDATE active=0',
    [P.profInativo, 'Prof Inativo', 'ClÃ­nica Geral']
  );
  await pool.query(
    `INSERT INTO users (id, full_name, email, password_hash, role, account_status, admin_level)
     VALUES (?, 'Admin Catalogo', ?, 'x', 'admin', 'ativo', 'superadmin')
     ON DUPLICATE KEY UPDATE account_status='ativo', admin_level='superadmin', deleted_at=NULL`,
    [P.admin, `admin.catalogo+${P.admin.slice(-6)}@test.local`]
  );

  for (const [id, nome, prof] of [
    [P.ofertaSemProf, 'Servico Sem Prof', null],
    [P.ofertaSemEscala, 'Servico Sem Escala', P.profAtivo],
    [P.ofertaOk, 'Servico Ok', P.profComEscala],
  ]) {
    await pool.query(
      `INSERT INTO unit_offers (id, unit_id, kind, name, duration_minutes, active)
       VALUES (?,?,?,?,30,1) ON DUPLICATE KEY UPDATE active=1`,
      [id, P.unidade, 'consulta', nome]
    );
    if (prof) {
      await pool.query(
        `INSERT INTO professional_offers (id, professional_id, unit_id, kind, name)
         VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE professional_id=VALUES(professional_id)`,
        [crypto.randomUUID ? crypto.randomUUID() : `${id}-po`, prof, P.unidade, 'consulta', nome]
      );
    }
  }

  // Inativo tambÃ©m vinculado ao serviÃ§o "Sem Profissional", nÃ£o deve contar.
  await pool.query(
    `INSERT INTO professional_offers (id, professional_id, unit_id, kind, name)
     VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE professional_id=VALUES(professional_id)`,
    [crypto.randomUUID(), P.profInativo, P.unidade, 'consulta', 'Servico Sem Prof']
  );

  const wd = new Date().getDay();
  await pool.query('DELETE FROM work_schedules WHERE id = ?', [P.schedule]);
  await pool.query(
    `INSERT INTO work_schedules (id, professional_id, unit_id, weekday, start_time, end_time, slot_minutes, active)
     VALUES (?,?,?,?, '08:00','12:00',30,1)`,
    [P.schedule, P.profComEscala, P.unidade, wd]
  );

  token = jwt.sign({ id: P.admin, role: 'admin', full_name: 'Admin Catalogo', admin_level: 'superadmin' },
    process.env.JWT_SECRET, { expiresIn: '5m' });
}

test.before(async () => {
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await preparar();
});

test.after(async () => {
  await pool.query('DELETE FROM work_schedules WHERE id = ?', [P.schedule]).catch(() => {});
  await pool.query('DELETE FROM professional_offers WHERE unit_id = ? AND name IN (?,?,?)',
    [P.unidade, 'Servico Sem Prof', 'Servico Sem Escala', 'Servico Ok']).catch(() => {});
  await pool.query('DELETE FROM unit_offers WHERE id IN (?,?,?)', [P.ofertaSemProf, P.ofertaSemEscala, P.ofertaOk]).catch(() => {});
  await pool.query('DELETE FROM professionals WHERE id IN (?,?,?)', [P.profAtivo, P.profComEscala, P.profInativo]).catch(() => {});
  await pool.query('DELETE FROM health_units WHERE id = ?', [P.unidade]).catch(() => {});
  await pool.query('DELETE FROM users WHERE id = ?', [P.admin]).catch(() => {});
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise((r) => server.close(r));
  await pool.end().catch(() => {});
});

test('aponta serviÃ§o sem profissional ativo e serviÃ§o sem escala, mas nÃ£o o saudÃ¡vel', async () => {
  const res = await fetch(`${base}/admin/catalog-health`, { headers: headers() });
  assert.equal(res.status, 200);
  const data = await res.json();
  const issues = new Map(data.data.map((r) => [r.name, r.issue]));
  assert.equal(issues.get('Servico Sem Prof'), 'sem_profissional');
  assert.equal(issues.get('Servico Sem Escala'), 'sem_escala');
  assert.equal(issues.has('Servico Ok'), false);
  assert.ok(data.total >= 2);
});
