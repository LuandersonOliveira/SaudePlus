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

// O nome é fixo de propósito: ele é o que serializa as escritas entre TODOS
// os processos que apontam para a mesma base, então dois servidores em
// produção precisam usar o mesmo nome para se serializarem. O override existe
// para os testes, que provocam a falha do lock de propósito e não podem
// disputa-lo com os demais arquivos rodando em paralelo.
const AUDIT_LOCK = process.env.AUDIT_LOCK_NAME || 'saudeplus:audit-chain';

/**
 * Sinal observável de falha do mutex.
 *
 * Sem o `GET_LOCK` a escrita segue (ver `logAction`), e a linha pode entrar
 * fora de ordem — aceitável. O que não é aceitável é isso acontecer sem
 * ninguém saber: o único sinal era um `console.warn`, invisível para alerta
 * e para qualquer leitura do `/ready`.
 *
 * O contador e o instante da última falha viram métrica em `GET /ready`
 * (`audit_lock`), que um monitor vigia. É um contador de processo: zera no
 * restart, então o que se observa é "aconteceu desde que o processo
 * subiu", não "aconteceu alguma vez". Para um lock cujo modo de falha é
 * saturação do MySQL, esse recorte é o que interessa.
 */
const auditLock = { falhas: 0, ultimaFalhaEm: null };

function registrarFalhaDeLock(quando = Date.now()) {
  auditLock.falhas += 1;
  auditLock.ultimaFalhaEm = new Date(quando).toISOString();
}

/** Retorno para o `/ready` e para o doctor. */
function auditoriaLockStats() {
  return {
    ok: auditLock.falhas === 0,
    falhas: auditLock.falhas,
    ultimaFalhaEm: auditLock.ultimaFalhaEm,
  };
}

function resetAuditLockStats() {
  auditLock.falhas = 0;
  auditLock.ultimaFalhaEm = null;
}

async function logAction(actorId, action, entityType, entityId, details) {
  const clean = sanitizeDetails(details);
  const createdAt = toSqlDate(new Date());
  const conn = await pool.getConnection().catch(() => null);
  if (!conn) return; // sem banco: não derruba a operação principal
  // Mutex da cadeia.
  //
  // `SELECT ... ORDER BY seq DESC LIMIT 1 FOR UPDATE` NÃO serializa as escritas
  // de auditoria: no fim do índice não existe "próxima" linha, então o InnoDB
  // não pega o gap lock que impediria um INSERT concorrente. Duas requisições
  // simultâneas liam a mesma cabeça e as duas escrevem — a trilha fica com
  // duas linhas no mesmo elo, e o verificador acusa adulteração onde só houve
  // corrida. Aconteceu de verdade em `npm test`.
  //
  // GET_LOCK é um lock nomeado do próprio MySQL, compartilhado entre conexões
  // e entre processos: é exatamente a primitiva que falta aqui.
  let comLock = false;
  try {
    const [[pegou]] = await conn.query('SELECT GET_LOCK(?, ?) AS ok', [AUDIT_LOCK, 5]);
    comLock = Number(pegou && pegou.ok) === 1;
    if (!comLock) {
      // Sem o lock (5s de espera, MySQL sobrecarregado), seguimos mesmo assim
      // para não perder a auditoria. Registrar uma linha fora de ordem é
      // aceitável; perder o registro não é.
      registrarFalhaDeLock();
      console.warn(
        `audit: GET_LOCK não concedido (tentativa ${auditLock.falhas}) — a linha pode entrar fora de ordem na cadeia`
      );
    }
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
    // O lock é da conexão: tem que ser devolvido antes de ela voltar ao pool,
    // senão o próximo borrower fica esperando um lock que ninguém tem.
    if (comLock) {
      try { await conn.query('SELECT RELEASE_LOCK(?)', [AUDIT_LOCK]); } catch { /* ignora */ }
    }
    conn.release();
  }
}

/**
 * Verifica a integridade da trilha percorrendo o ENCADEAMENTO, não a numeração.
 *
 * A versão anterior comparava `linha[i].prev_hash` com `linha[i-1].entry_hash`
 * varrendo por `seq`. Duas coisas quebram isso:
 *
 * 1. `seq` é AUTO_INCREMENT e o MySQL consome o valor ANTES do INSERT. Uma
 *    transação que roda back (chave duplicada, por exemplo) queima o número e
 *    a linha nunca aparece. Salto de sequência é normal, não é adulteração.
 * 2. A ordem em que as linhas chegam do banco pode não ser a ordem da cadeia
 *    (um backfill entra com seq menor e só é lido depois).
 *
 * O que define a ordem é o elo de hash. Então: confere o hash de cada linha
 * contra o próprio conteúdo, e caminha de elo em elo a partir de GENESIS.
 * Salto de seq deixa de importar; duas linhas penduradas no mesmo elo ainda
 * são detectadas — que é a divergência que a corrida de escrita produz.
 */
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
  if (!rows.length) return { ok: true, checked: 0, head: 'GENESIS' };

  for (const r of rows) {
    if (!r.entry_hash) {
      return { ok: false, checked: rows.length, firstBad: r.id, reason: 'linha sem hash (pré-migração 005)' };
    }
    const recomputed = chainHash(r.prev_hash, r.actor_id, r.action, r.entity_type, r.entity_id, r.details, r.created_at);
    if (recomputed !== r.entry_hash) {
      return { ok: false, checked: rows.length, firstBad: r.id, reason: 'conteúdo alterado' };
    }
  }

  // Encadeia: quem aponta para este elo?
  const porElo = new Map();
  for (const r of rows) {
    const lista = porElo.get(r.prev_hash);
    if (lista) lista.push(r);
    else porElo.set(r.prev_hash, [r]);
  }

  const visitadas = new Set();
  let elo = 'GENESIS';
  for (;;) {
    const proximas = porElo.get(elo) || [];
    // Duas linhas claiming o mesmo elo é a divergência da corrida de escrita.
    if (proximas.length > 1) {
      const jaVista = proximas.find((r) => visitadas.has(r.id));
      const outra = proximas.find((r) => !visitadas.has(r.id));
      if (jaVista && outra) {
        return { ok: false, checked: rows.length, firstBad: outra.id, reason: 'elo anterior divergente (duas linhas no mesmo elo)' };
      }
    }
    const proxima = proximas.find((r) => !visitadas.has(r.id));
    if (!proxima) break;
    visitadas.add(proxima.id);
    elo = proxima.entry_hash;
  }

  // Sobrou linha fora do caminho? Ela é órfã: aponta para elo que ninguém
  // alcança a partir de GENESIS, e é exatamente o que uma adulteração hide.
  if (visitadas.size !== rows.length) {
    const orfa = rows.find((r) => !visitadas.has(r.id));
    return {
      ok: false,
      checked: visitadas.size,
      firstBad: orfa.id,
      reason: 'elo anterior divergente (linha fora da cadeia)',
    };
  }

  return { ok: true, checked: rows.length, head: elo };
}

module.exports = {
  logAction,
  sanitizeDetails,
  chainHash,
  verifyChain,
  DETAILS_MAX,
  AUDIT_LOCK,
  registrarFalhaDeLock,
  auditoriaLockStats,
  resetAuditLockStats,
};
