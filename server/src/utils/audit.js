const crypto = require('crypto');
const pool = require('../db');

/**
 * Registra uma ação administrativa para fins de rastreabilidade.
 * Nunca lança erro para não derrubar a operação principal por causa do log.
 *
 * Fase 0 (LGPD): `details` é sanitizado antes de persistir — tokens, senhas e
 * documentos completos nunca entram no audit_log (só referência/máscara).
 * A tabela é append-only: triggers em migration_002 bloqueiam UPDATE/DELETE.
 *
 * Aulas 1/6 (integridade + não repúdio): cada linha carrega entry_hash =
 * SHA-256(prev_hash | ator | ação | entidade | detalhes | momento), encadeado
 * ao hash anterior em transação (SELECT ... FOR UPDATE). Qualquer alteração
 * ou remoção quebra a cadeia — verificável em GET /admin/audit-log/verify.
 */
const SENSITIVE_PATTERNS = [
  /bearer\s+[a-z0-9\-._~+/=]+/gi,
  /"password"\s*:\s*"[^"]*"/gi,
  /"password_hash"\s*:\s*"[^"]*"/gi,
  /"token"\s*:\s*"[^"]*"/gi,
  /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, // CPF formatado
];

// Teto do details. O schema.sql já declara TEXT, então na prática 1000 nunca
// é atingido — mas um banco com a migration 005b não aplicada ainda tem
// VARCHAR(255), e é aí que o insert estourava. Ver o fallback em logAction.
const DETAILS_MAX = 1000;
const DETAILS_FALLBACK = 255;

function sanitizeDetails(details) {
  if (details === null || details === undefined) return null;
  let text = String(details);
  SENSITIVE_PATTERNS.forEach((re) => {
    text = text.replace(re, '[redigido]');
  });
  // CPF só com dígitos (11 seguidos) vira máscara parcial: mantém 3+2 finais.
  text = text.replace(/(?<!\d)(\d{3})(\d{3})(\d{3})(\d{2})(?!\d)/g, '$1.***.***-$4');
  return text.slice(0, DETAILS_MAX);
}

function toSqlDate(date) {
  const pad = (v) => String(v).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function chainHash(prev, actorId, action, entityType, entityId, details, createdAt) {
  return crypto.createHash('sha256')
    .update([prev, actorId, action, entityType, entityId, details || '', createdAt].join('|'))
    .digest('hex');
}

async function logAction(actorId, action, entityType, entityId, details) {
  const clean = sanitizeDetails(details);
  const createdAt = toSqlDate(new Date());
  const conn = await pool.getConnection().catch(() => null);
  if (!conn) return; // sem banco: não derruba a operação principal
  try {
    await conn.beginTransaction();
    let prev = 'GENESIS';
    try {
      const [[last]] = await conn.query(
        'SELECT entry_hash FROM audit_log ORDER BY seq DESC LIMIT 1 FOR UPDATE'
      );
      if (last && last.entry_hash) prev = last.entry_hash;
    } catch {
      try {
        const [[legacy]] = await conn.query(
          'SELECT entry_hash FROM audit_log ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE'
        );
        if (legacy && legacy.entry_hash) prev = legacy.entry_hash;
      } catch {
        // tabela/coluna ainda sem migração 005: grava sem cadeia (compatível)
      }
    }
    const id = crypto.randomUUID();
    const hash = chainHash(prev, actorId, action, entityType, entityId, clean, createdAt);
    try {
      await conn.query(
        `INSERT INTO audit_log (id, actor_id, action, entity_type, entity_id, details, prev_hash, entry_hash, created_at)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [id, actorId, action, entityType, entityId, clean, prev, hash, createdAt]
      );
    } catch (insertErr) {
      if (insertErr.code === 'ER_BAD_FIELD_ERROR') {
        // banco pré-migração 005: insere sem as colunas da cadeia
        await conn.query(
          'INSERT INTO audit_log (id, actor_id, action, entity_type, entity_id, details) VALUES (?,?,?,?,?,?)',
          [id, actorId, action, entityType, entityId, clean]
        );
      } else if (insertErr.code === 'ER_DATA_TOO_LONG') {
        // Banco ainda com audit_log.details em VARCHAR(255) (migration 005b não
        // aplicada). Antes, esse erro subia para o catch de baixo e a ação
        // ficava SEM NENHUM registro — o oposto do que a trilha deve garantir.
        // Aqui truncamos e gravamos: perde-se o fim da justificativa, nunca o
        // registro. E o hash precisa ser recalculado sobre o texto gravado,
        // senão verifyChain acusaria "conteúdo alterado" numa linha intacta.
        const curto = String(clean == null ? '' : clean).slice(0, DETAILS_FALLBACK);
        const hashCurto = chainHash(prev, actorId, action, entityType, entityId, curto, createdAt);
        await conn.query(
          `INSERT INTO audit_log (id, actor_id, action, entity_type, entity_id, details, prev_hash, entry_hash, created_at)
           VALUES (?,?,?,?,?,?,?,?,?)`,
          [id, actorId, action, entityType, entityId, curto, prev, hashCurto, createdAt]
        );
        console.warn(
          `audit_log.details truncado para ${DETAILS_FALLBACK} — rode: npm run db:migrate`
        );
      } else {
        throw insertErr;
      }
    }
    await conn.commit();
  } catch (err) {
    try { await conn.rollback(); } catch { /* ignora */ }
    // O código entra no log: sem isso, "a ação rodou e a auditoria não" vira
    // um mistério sem rastro — exatamente o que a auditoria existe para evitar.
    console.error(`Falha ao registrar log de auditoria [${err.code || 'SEM_CODIGO'}]:`, err.message);
  } finally {
    conn.release();
  }
}

async function verifyChain(poolOrConn) {
  const query = (sql, params) => poolOrConn.query(sql, params);
  const cols = `id, actor_id, action, entity_type, entity_id, details, prev_hash, entry_hash,
            DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') AS created_at`;
  let rows;
  try {
    [rows] = await query(`SELECT ${cols} FROM audit_log ORDER BY seq ASC`);
  } catch {
    [rows] = await query(`SELECT ${cols} FROM audit_log ORDER BY created_at ASC, id ASC`);
  }
  let prev = 'GENESIS';
  for (const r of rows) {
    if (!r.entry_hash) return { ok: false, checked: rows.length, firstBad: r.id, reason: 'linha sem hash (pré-migração 005)' };
    if (r.prev_hash !== prev) return { ok: false, checked: rows.length, firstBad: r.id, reason: 'elo anterior divergente' };
    const recomputed = chainHash(prev, r.actor_id, r.action, r.entity_type, r.entity_id, r.details, r.created_at);
    if (recomputed !== r.entry_hash) return { ok: false, checked: rows.length, firstBad: r.id, reason: 'conteúdo alterado' };
    prev = r.entry_hash;
  }
  return { ok: true, checked: rows.length, head: prev };
}

module.exports = { logAction, sanitizeDetails, chainHash, verifyChain, DETAILS_MAX };
