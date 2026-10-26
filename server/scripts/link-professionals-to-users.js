#!/usr/bin/env node
/**
 * Vincula profissionais existentes a usuários com role 'atendente'.
 * Cria o usuário atendente quando não existir, com senha aleatória impressa
 * uma única vez ao final. Não existe senha padrão: uma senha fixa e conhecida
 * em um script que cria contas de staff é uma porta aberta.
 *
 * Uso:
 *   node server/scripts/link-professionals-to-users.js --dry-run
 *   node server/scripts/link-professionals-to-users.js --yes
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const pool = require('../src/db');

const DRY_RUN = !process.argv.includes('--yes');

function slugEmail(name) {
  const s = String(name).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
  return `${s}@atendente.saude.local`;
}

async function main() {
  console.log(`Modo: ${DRY_RUN ? 'DRY-RUN' : 'EXECUÇÃO REAL'}`);
  const conn = await pool.getConnection();
  try {
    const [pros] = await conn.query('SELECT id, name, job_title, registry, active, user_id FROM professionals ORDER BY name');
    console.log(`\nProfissionais: ${pros.length}`);
    for (const p of pros) {
      console.log(`  - ${p.name} (${p.job_title || '-'}) ${p.user_id ? '[JÁ VINCULADO]' : '[SEM VÍNCULO]'}`);
    }
    
    if (DRY_RUN) {
      console.log('\nPara vincular/criar usuários: node server/scripts/link-professionals-to-users.js --yes');
      console.log('Novas contas recebem senha aleatória, exibida apenas ao final da execução.');
      return;
    }
    
    await conn.beginTransaction();
    const credenciais = [];
    for (const p of pros) {
      if (p.user_id) {
        console.log(`Pulando ${p.name} (já vinculado)`);
        continue;
      }
      const email = slugEmail(p.name);
      const [existing] = await conn.query('SELECT id, role FROM users WHERE LOWER(email)=?', [email]);
      let userId;
      if (existing.length) {
        const u = existing[0];
        // Não rebaixa um admin que por acaso use esse e-mail: o script é de
        // vínculo de atendente, não de reescrita de papel privilegiado.
        if (u.role === 'admin') {
          console.log(`Ignorado ${p.name}: ${email} é uma conta admin`);
          continue;
        }
        userId = u.id;
        await conn.query("UPDATE users SET role='atendente' WHERE id=?", [userId]);
        console.log(`Vinculado ${p.name} ao usuário existente ${email}`);
      } else {
        userId = crypto.randomUUID();
        const senha = crypto.randomBytes(12).toString('base64url');
        const hash = await bcrypt.hash(senha, 10);
        await conn.query(
          "INSERT INTO users (id, full_name, email, password_hash, role) VALUES (?,?,?,?, 'atendente')",
          [userId, p.name, email, hash]
        );
        credenciais.push({ email, senha });
        console.log(`Criado usuário atendente ${email} para ${p.name}`);
      }
      await conn.query('UPDATE professionals SET user_id=? WHERE id=?', [userId, p.id]);
    }
    await conn.commit();
    console.log('\n✅ Vinculação concluída');
    if (credenciais.length) {
      console.log('\nSenhas geradas (anote agora; não são exibidas de novo):');
      for (const c of credenciais) console.log(`  ${c.email} -> ${c.senha}`);
    }
  } catch (e) {
    await conn.rollback();
    console.error('ERRO:', e);
    process.exit(1);
  } finally {
    conn.release();
    await pool.end();
  }
}

main();
