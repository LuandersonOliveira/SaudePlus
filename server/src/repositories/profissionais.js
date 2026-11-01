/* ==========================================================================
   Saúde+ — SQL de `professionals` (A1 da Fase 6, passos 8b e 8c).

   - 8b: o vínculo atendente ↔ profissional que a gestão de usuários mantém;
   - 8c: o CRUD administrativo de profissionais, ofertas (vínculos com serviço),
     horários de atendimento e bloqueios de agenda.

   Cada função recebe `db` primeiro: o pool OU a conexão da transação em curso.
   ========================================================================== */
const crypto = require('crypto');

/**
 * Profissional ATIVO para vincular a um atendente. Com `travar`, usa `FOR UPDATE`
 * (dentro de transação), para que dois admins não vinculem o mesmo profissional.
 * @returns {Promise<{id: string, user_id: string|null}|undefined>}
 */
async function ativoParaVinculo(db, professionalId, { travar = false } = {}) {
  const [[p]] = await db.query(
    `SELECT id, user_id FROM professionals WHERE id = ? AND active = 1${travar ? ' FOR UPDATE' : ''}`,
    [professionalId]
  );
  return p;
}

/** Solta qualquer profissional vinculado a este usuário. */
async function desvincularUsuario(db, userId) {
  await db.query('UPDATE professionals SET user_id = NULL WHERE user_id = ?', [userId]);
}

async function vincular(db, professionalId, userId) {
  await db.query('UPDATE professionals SET user_id = ? WHERE id = ?', [userId, professionalId]);
}

/** O usuário já tem profissional vinculado? */
async function doUsuario(db, userId) {
  const [[p]] = await db.query('SELECT id FROM professionals WHERE user_id = ?', [userId]);
  return p;
}

/** Cria o profissional de um atendente que ainda não tem. @returns {Promise<string>} id */
async function criarParaAtendente(db, { name, jobTitle, userId }) {
  const id = crypto.randomUUID();
  await db.query(
    'INSERT INTO professionals (id, name, job_title, registry, active, user_id) VALUES (?,?,?,?,1,?)',
    [id, name, jobTitle, null, userId]
  );
  return id;
}

/** Acompanha a mudança de cargo do atendente (o nome só é preenchido se estiver vazio). */
async function acompanharCargo(db, userId, jobRole) {
  await db.query(
    'UPDATE professionals SET name = COALESCE(name, ?), job_title = ? WHERE user_id = ?',
    [jobRole, jobRole, userId]
  );
}

// ---------------------------------------------------------------------------
// Administração de profissionais (8c)
// ---------------------------------------------------------------------------

/** Lista completa com usuário vinculado, ofertas, horários e os bloqueios que ainda valem. */
async function listarTudo(db) {
  const [professionals] = await db.query(
    `SELECT p.id, p.name, p.job_title, p.registry, p.active, p.user_id, p.created_at,
            u.full_name AS user_name, u.email AS user_email, u.role AS user_role
     FROM professionals p
     LEFT JOIN users u ON u.id = p.user_id AND u.deleted_at IS NULL
     ORDER BY p.name`
  );
  const [offers] = await db.query(
    `SELECT po.id, po.professional_id, po.unit_id, po.kind, po.name, u.name AS unit_name
     FROM professional_offers po JOIN health_units u ON u.id = po.unit_id
     ORDER BY u.name, po.kind, po.name`
  );
  const [schedules] = await db.query(
    `SELECT ws.id, ws.professional_id, ws.unit_id, ws.weekday, ws.start_time, ws.end_time,
            ws.slot_minutes, ws.active, u.name AS unit_name
     FROM work_schedules ws JOIN health_units u ON u.id = ws.unit_id
     ORDER BY u.name, ws.weekday, ws.start_time`
  );
  const [blocks] = await db.query(
    `SELECT sb.id, sb.professional_id, sb.unit_id, sb.starts_at, sb.ends_at, sb.reason,
            u.name AS unit_name
     FROM schedule_blocks sb JOIN health_units u ON u.id = sb.unit_id
     WHERE sb.ends_at >= NOW() ORDER BY sb.starts_at LIMIT 100`
  );
  return { professionals, offers, schedules, blocks };
}

async function inserir(db, { name, jobTitle, registry }) {
  const id = crypto.randomUUID();
  await db.query('INSERT INTO professionals (id, name, job_title, registry) VALUES (?,?,?,?)', [id, name, jobTitle, registry]);
  return id;
}

async function existe(db, id) {
  const [[p]] = await db.query('SELECT id FROM professionals WHERE id = ?', [id]);
  return Boolean(p);
}

/** @returns {Promise<{id: string, name: string}|undefined>} */
async function unidade(db, unitId) {
  const [[u]] = await db.query('SELECT id, name FROM health_units WHERE id = ?', [unitId]);
  return u;
}

/** Nome da unidade para a trilha; sem unidade ou desconhecida, um texto que explica. */
async function rotuloDaUnidade(db, unitId) {
  if (!unitId) return 'unidade não informada';
  const u = await unidade(db, unitId);
  return u ? u.name : `unidade ${unitId}`;
}

// Vínculo profissional ↔ unidade ↔ serviço
async function inserirOferta(db, { professionalId, unitId, kind, serviceName }) {
  const id = crypto.randomUUID();
  await db.query(
    'INSERT INTO professional_offers (id, professional_id, unit_id, kind, name) VALUES (?,?,?,?,?)',
    [id, professionalId, unitId, kind, serviceName]
  );
  return id;
}

async function ofertaDoProfissional(db, offerId, professionalId) {
  const [[o]] = await db.query(
    `SELECT po.id, po.kind, po.name, u.name AS unit_name
     FROM professional_offers po JOIN health_units u ON u.id = po.unit_id
     WHERE po.id = ? AND po.professional_id = ?`,
    [offerId, professionalId]
  );
  return o;
}

async function removerOferta(db, offerId) {
  await db.query('DELETE FROM professional_offers WHERE id = ?', [offerId]);
}

// Horários de atendimento
async function inserirHorario(db, { professionalId, unitId, weekday, start, end, slot }) {
  const id = crypto.randomUUID();
  await db.query(
    `INSERT INTO work_schedules (id, professional_id, unit_id, weekday, start_time, end_time, slot_minutes)
     VALUES (?,?,?,?,?,?,?)`,
    [id, professionalId, unitId, weekday, start, end, slot]
  );
  return id;
}

async function horarioDoProfissional(db, scheduleId, professionalId) {
  const [[r]] = await db.query('SELECT id FROM work_schedules WHERE id = ? AND professional_id = ?', [scheduleId, professionalId]);
  return r;
}

async function removerHorario(db, scheduleId) {
  await db.query('DELETE FROM work_schedules WHERE id = ?', [scheduleId]);
}

// Bloqueios de agenda (folgas, intervalos)
async function inserirBloqueio(db, { professionalId, unitId, start, end, reason }) {
  const id = crypto.randomUUID();
  await db.query(
    'INSERT INTO schedule_blocks (id, professional_id, unit_id, starts_at, ends_at, reason) VALUES (?,?,?,?,?,?)',
    [id, professionalId, unitId, start, end, reason || null]
  );
  return id;
}

async function bloqueioDoProfissional(db, blockId, professionalId) {
  const [[r]] = await db.query('SELECT id FROM schedule_blocks WHERE id = ? AND professional_id = ?', [blockId, professionalId]);
  return r;
}

async function removerBloqueio(db, blockId) {
  await db.query('DELETE FROM schedule_blocks WHERE id = ?', [blockId]);
}

// Edição do cadastro (8d)
async function paraEdicao(db, id, { travar = false } = {}) {
  const [[p]] = await db.query(
    `SELECT name, job_title, registry, active FROM professionals WHERE id = ?${travar ? ' FOR UPDATE' : ''}`,
    [id]
  );
  return p;
}

async function atualizar(db, id, sets, params) {
  await db.query(`UPDATE professionals SET ${sets.join(', ')} WHERE id=?`, [...params, id]);
}

module.exports = {
  paraEdicao, atualizar,
  ativoParaVinculo, desvincularUsuario, vincular, doUsuario, criarParaAtendente, acompanharCargo,
  listarTudo, inserir, existe, unidade, rotuloDaUnidade,
  inserirOferta, ofertaDoProfissional, removerOferta,
  inserirHorario, horarioDoProfissional, removerHorario,
  inserirBloqueio, bloqueioDoProfissional, removerBloqueio,
};
