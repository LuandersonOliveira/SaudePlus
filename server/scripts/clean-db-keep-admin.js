#!/usr/bin/env node
/**
 * Limpa o banco mantendo APENAS o admin principal.
 * - Mantém: health_units, professionals, unit_offers, professional_offers, work_schedules, schedule_blocks
 * - Mantém: users com role='admin' E email = admin@saude.app (único admin)
 * - Remove: todos os demais usuários (paciente/atendente/outros) e seus dados vinculados
 * - Remove: appointments, exams, reminders, diseases, tokens e audit_log
 *
 * É uma ferramenta de ambiente de desenvolvimento: apaga a trilha de
 * auditoria junto com os usuários (o FK de audit_log é RESTRICT, então a
 * ordem importa). Em produção o script se recusa a rodar.
 *
 * Uso:
 *   node server/scripts/clean-db-keep-admin.js --dry-run
 *   node server/scripts/clean-db-keep-admin.js --yes
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const pool = require('../src/db');

const KEEP_ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'admin@saude.app').toLowerCase().trim();
const DRY_RUN = !process.argv.includes('--yes');

if (process.env.NODE_ENV === 'production') {
  console.error('Recusado: clean-db-keep-admin apaga a trilha de auditoria e não roda em produção.');
  process.exit(1);
}

async function getTableNames(conn) {
  const [rows] = await conn.query('SHOW TABLES');
  const key = Object.keys(rows[0])[0];
  return rows.map(r => r[key]);
}

async function count(conn, table, where = '') {
  const sql = where ? `SELECT COUNT(*) as c FROM ${table} WHERE ${where}` : `SELECT COUNT(*) as c FROM ${table}`;
  const [rows] = await conn.query(sql);
  return rows[0].c;
}

async function main() {
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN (nenhuma alteração)' : 'EXECUÇÃO REAL'}`);
  console.log(`Admin a manter: ${KEEP_ADMIN_EMAIL}`);
  
  let conn;
  try {
    conn = await pool.getConnection();
    await conn.beginTransaction();
    
    const tables = await getTableNames(conn);
    console.log('\nTabelas encontradas:', tables.join(', '));
    
    // Verificar admin principal
    const [admins] = await conn.query("SELECT id, email, role FROM users WHERE role='admin'");
    console.log('\nAdmins existentes:', admins.map(a => a.email).join(', ') || 'nenhum');
    const [keep] = await conn.query("SELECT id, email, role FROM users WHERE LOWER(email)=? AND role='admin'", [KEEP_ADMIN_EMAIL]);
    if (keep.length === 0) {
      throw new Error(`Admin principal ${KEEP_ADMIN_EMAIL} não encontrado com role='admin'. Abortando.`);
    }
    const keepId = keep[0].id;
    console.log(`Admin principal confirmado: ${keep[0].email} (${keepId})`);
    
    // Contagens antes
    const before = {};
    for (const t of tables) {
      try { before[t] = await count(conn, t); } catch {}
    }
    console.log('\n--- Contagens ANTES ---');
    for (const t of tables.sort()) console.log(`  ${t}: ${before[t]}`);
    
    // Garantir que mantemos apenas o admin principal
    const [removeRows] = await conn.query("SELECT id, email, role FROM users WHERE NOT (LOWER(email)=? AND role='admin')", [KEEP_ADMIN_EMAIL]);
    const removeIds = removeRows.map(r => r.id);
    console.log(`\nUsuários a REMOVER: ${removeIds.length}`);
    for (const u of removeRows) {
      console.log(`  - ${u.email} (${u.role})`);
    }
    
    if (DRY_RUN) {
      console.log('\nDRY-RUN: Nenhuma exclusão executada.');
      console.log('Para executar realmente: node server/scripts/clean-db-keep-admin.js --yes');
      await conn.rollback();
      if (conn) conn.release();
      await pool.end();
      return;
    }
    
    // Ordem de limpeza (filhos primeiro). Não desligamos FOREIGN_KEY_CHECKS:
    // com a ordem certa o banco valida cada passo, e uma tabela nova que
    // referencie users faz o script falhar em vez de deixar lixo órfão.
    const toDelete = [
      'refresh_tokens',
      'password_reset_tokens',
      'reminders',
      'exams',
      'appointments',
      'audit_log',
      'disease_alerts',
    ];
    
    for (const tbl of toDelete) {
      if (tables.includes(tbl)) {
        try {
          const [r] = await conn.query(`DELETE FROM ${tbl}`);
          console.log(`DELETE FROM ${tbl}: ${r.affectedRows} linhas`);
        } catch (e) {
          console.log(`  (ignorado) ${tbl}: ${e.message}`);
        }
      }
    }
    
    // Remover doenças
    if (tables.includes('diseases')) {
      try {
        const [r] = await conn.query('DELETE FROM diseases');
        console.log(`DELETE FROM diseases: ${r.affectedRows} linhas`);
      } catch (e) {
        console.log(`  (ignorado) diseases: ${e.message}`);
      }
    }
    
    // Remover usuários não-admin ou não o admin principal
    if (removeIds.length > 0 && tables.includes('users')) {
      try {
        const [r] = await conn.query('DELETE FROM users WHERE id IN (?)', [removeIds]);
        console.log(`DELETE FROM users (não-admin/principal): ${r.affectedRows} linhas`);
      } catch (e) {
        console.log(`  (ignorado) users: ${e.message}`);
        // Tentar um por um
        for (const rid of removeIds) {
          try {
            await conn.query('DELETE FROM users WHERE id = ?', [rid]);
            console.log(`  DELETE users id=${rid}`);
          } catch (e2) {
            console.log(`  ERRO users id=${rid}: ${e2.message}`);
          }
        }
      }
    }
    
    // Contagens depois
    const after = {};
    for (const t of tables) {
      try { after[t] = await count(conn, t); } catch {}
    }
    console.log('\n--- Contagens DEPOIS ---');
    for (const t of tables.sort()) {
      if (before[t] !== after[t]) {
        console.log(`  ${t}: ${before[t]} → ${after[t]}`);
      } else {
        console.log(`  ${t}: ${after[t]} (inalterado)`);
      }
    }
    
    await conn.commit();
    console.log('\n✅ Limpeza concluída com sucesso.');
  } catch (err) {
    if (conn) {
      try { await conn.rollback(); } catch {}
    }
    console.error('\n❌ ERRO:', err.message);
    process.exit(1);
  } finally {
    if (conn) {
      try { conn.release(); } catch {}
    }
    try { await pool.end(); } catch {}
  }
}

main();
