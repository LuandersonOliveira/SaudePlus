const crypto = require('crypto');
const mailer = require('./mailer');
const {
  PRIORITY_GROUPS,
  parseDateTime,
  validateBooking,
  lockBookingActors,
  duracaoMinutos,
} = require('../utils/booking');

const META = {
  appointments: { tipo: 'consulta', table: 'appointments', serviceColumn: 'specialty' },
  exams: { tipo: 'exame', table: 'exams', serviceColumn: 'exam_type' },
};

function metaDoTipo(tipo) {
  return Object.values(META).find((m) => m.tipo === tipo) || null;
}

async function enviarAviso(candidato, record) {
  const quando = new Date(String(record.scheduled_at).replace(' ', 'T'));
  const data = isNaN(quando.getTime())
    ? record.scheduled_at
    : quando.toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  const resposta = await mailer.enviar({
    para: candidato.email,
    assunto: `Vaga liberada: ${record.service_name}`.slice(0, 120),
    texto:
      `Olá, ${candidato.full_name || 'paciente'}.\n\n`
      + `Abriu uma vaga para ${record.service_name} em ${record.location}, ${data}.\n`
      + 'O agendamento já foi feito automaticamente na sua conta do Saúde+.\n\n'
      + 'Se não puder comparecer, cancele pelo painel para liberar a vaga para outra pessoa.',
  });
  return resposta.enviado ? 'sent' : 'pending';
}

async function tentarPreencher(conn, record) {
  const meta = metaDoTipo(record.kind);
  if (!meta) return null;

  const quando = parseDateTime(record.scheduled_at);
  if (!quando || quando.getTime() <= Date.now()) return null;

  if (record.professional_id) {
    await conn.query('SELECT id FROM professionals WHERE id = ? FOR UPDATE', [record.professional_id]);
  }

  const prioridadeParams = [...PRIORITY_GROUPS];
  const [candidatos] = await conn.query(
    `SELECT w.id, w.user_id, u.priority, u.email, u.full_name
     FROM waitlist w
     JOIN users u ON u.id = w.user_id
     WHERE w.status = 'aguardando'
       AND w.kind = ?
       AND w.service_name = ?
       AND w.user_id <> ?
       AND (w.unit_id IS NULL OR w.unit_id = ?)
       AND (w.professional_id IS NULL OR w.professional_id = ?)
       AND u.account_status = 'ativo'
       AND u.deleted_at IS NULL
     ORDER BY CASE WHEN u.priority IN (?, ?, ?, ?) THEN 0 ELSE 1 END,
              w.created_at ASC, w.id ASC
     FOR UPDATE`,
    [
      record.kind,
      record.service_name,
      record.user_id,
      record.unit_id || null,
      record.professional_id || null,
      ...prioridadeParams,
    ]
  );

  for (const candidato of candidatos) {
    await lockBookingActors(conn, {
      userId: candidato.user_id,
      professionalId: record.professional_id,
    });
    const bookingError = await validateBooking(conn, {
      tipo: record.kind,
      userId: candidato.user_id,
      unitId: record.unit_id,
      professionalId: record.professional_id,
      serviceName: record.service_name,
      scheduledAt: record.scheduled_at,
      userPriority: candidato.priority,
    });
    if (bookingError) continue;

    const duracao = await duracaoMinutos(conn, {
      unitId: record.unit_id,
      professionalId: record.professional_id,
      serviceName: record.service_name,
      tipo: record.kind,
      scheduledAt: record.scheduled_at,
    });

    let doctor = record.doctor || null;
    if (record.kind === 'consulta' && !doctor && record.professional_id) {
      const [[prof]] = await conn.query('SELECT name FROM professionals WHERE id = ?', [record.professional_id]);
      if (prof) doctor = prof.name;
    }

    const id = crypto.randomUUID();
    const columns = ['id', 'user_id', meta.serviceColumn];
    const values = [id, candidato.user_id, record.service_name];
    if (record.kind === 'consulta') {
      columns.push('doctor');
      values.push(doctor);
    }
    columns.push('location', 'unit_id', 'professional_id', 'scheduled_at', 'notes', 'duration_minutes', 'status');
    values.push(
      record.location,
      record.unit_id || null,
      record.professional_id || null,
      record.scheduled_at,
      record.notes || null,
      duracao,
      'pendente'
    );

    await conn.query(
      `INSERT INTO ${meta.table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(',')})`,
      values
    );

    const [result] = await conn.query(
      `UPDATE waitlist
       SET status = 'convertido', fulfilled_at = NOW(), record_id = ?
       WHERE id = ? AND status = 'aguardando'`,
      [id, candidato.id]
    );
    if (result.affectedRows !== 1) {
      throw new Error(`lista de espera ${candidato.id} mudou de estado durante a conversão`);
    }

    return { id, candidato, recordId: id };
  }

  return null;
}

async function liberarVagaAposCancelamento(pool, { kindKey, id }) {
  const meta = META[kindKey];
  if (!meta) return null;

  const doctorColumn = meta.table === 'appointments' ? 'doctor' : 'NULL AS doctor';
  const [[record]] = await pool.query(
    `SELECT user_id, ${meta.serviceColumn} AS service_name, unit_id, professional_id,
            scheduled_at, location, notes, duration_minutes, ${doctorColumn}
     FROM ${meta.table} WHERE id = ? AND status = 'cancelado'`,
    [id]
  );
  if (!record) return null;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const converted = await tentarPreencher(conn, { ...record, kind: meta.tipo });
    await conn.commit();
    if (!converted) return null;

    const { id: recordId, candidato } = converted;
    let notify = 'skipped';
    try {
      notify = await enviarAviso(candidato, record);
    } catch (err) {
      console.error(`Falha ao avisar ${candidato.user_id} sobre a vaga: ${err.message}`);
    }
    return {
      waitlist_id: candidato.id,
      user_id: candidato.user_id,
      record_id: recordId,
      notify,
    };
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { liberarVagaAposCancelamento };
