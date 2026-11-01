#!/usr/bin/env node
/* ==========================================================================
   Saúde+ — Prova de conceito (PoC) das propostas B1, B2 e B3 da Fase 6.
   Ver docs/tecnico/poc/POC-001-integridade-agendamento-e-cpf.md

   NÃO toca o banco real: cria e apaga o banco descartável `saude_poc_tmp`
   (nome fixo no código) com as credenciais do server/.env.

   Uso:  node server/scripts/poc-integridade.js
   ========================================================================== */
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const DB = 'saude_poc_tmp';
const resultados = [];
const registrar = (nome, ok, detalhe) => {
  resultados.push({ nome, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${nome}${detalhe ? ` — ${detalhe}` : ''}`);
};
const ms = (t0) => Number(process.hrtime.bigint() - t0) / 1e6;

async function conectar(database) {
  return mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database,
    dateStrings: true,
  });
}

async function codigoDeErro(promessa) {
  try { await promessa; return null; } catch (e) { return e.code || e.message; }
}

// ---- B2: exclusividade de horário no banco (coluna gerada + UNIQUE) ----
async function pocHorarioUnico(c) {
  await c.query(`CREATE TABLE booking_poc (
    id INT AUTO_INCREMENT PRIMARY KEY,
    professional_id CHAR(36) NOT NULL,
    scheduled_at DATETIME NOT NULL,
    status ENUM('pendente','confirmado','cancelado','concluido','para_remarcar') NOT NULL DEFAULT 'pendente',
    active_slot DATETIME GENERATED ALWAYS AS (IF(status IN ('pendente','confirmado'), scheduled_at, NULL)) STORED,
    UNIQUE KEY uq_prof_slot (professional_id, active_slot)
  )`);
  const ins = (prof, quando, status = 'pendente') =>
    c.query('INSERT INTO booking_poc (professional_id, scheduled_at, status) VALUES (?,?,?)', [prof, quando, status]);

  await ins('p1', '2026-12-01 08:00:00');
  registrar('B2: o 2º agendamento no mesmo horário é recusado pelo banco',
    (await codigoDeErro(ins('p1', '2026-12-01 08:00:00'))) === 'ER_DUP_ENTRY');
  registrar('B2: outro profissional no mesmo horário é aceito', (await codigoDeErro(ins('p2', '2026-12-01 08:00:00'))) === null);
  registrar('B2: mesmo profissional em outro horário é aceito', (await codigoDeErro(ins('p1', '2026-12-01 08:30:00'))) === null);

  await c.query("UPDATE booking_poc SET status='cancelado' WHERE professional_id='p1' AND scheduled_at='2026-12-01 08:00:00'");
  registrar('B2: depois de cancelar, o horário volta a poder ser marcado',
    (await codigoDeErro(ins('p1', '2026-12-01 08:00:00'))) === null);
  registrar('B2: vários cancelados no mesmo horário convivem (NULL não colide)',
    (await codigoDeErro(ins('p3', '2026-12-02 08:00:00', 'cancelado'))) === null
      && (await codigoDeErro(ins('p3', '2026-12-02 08:00:00', 'cancelado'))) === null);

  // 20 conexões tentando o mesmo horário ao mesmo tempo, SEM nenhum FOR UPDATE.
  const conns = await Promise.all(Array.from({ length: 20 }, () => conectar(DB)));
  const r = await Promise.all(conns.map((x) =>
    codigoDeErro(x.query('INSERT INTO booking_poc (professional_id, scheduled_at) VALUES (?,?)', ['corrida', '2026-12-03 09:00:00']))));
  await Promise.all(conns.map((x) => x.end()));
  const ok = r.filter((e) => e === null).length;
  registrar('B2: 20 inserções simultâneas no mesmo horário → exatamente 1 vence', ok === 1, `${ok} aceita(s), ${r.filter((e) => e === 'ER_DUP_ENTRY').length} recusada(s)`);

  // Limite conhecido: sobreposição por duração NÃO é coberta (continua na aplicação).
  registrar('B2: limite — horário parcialmente sobreposto (08:15 vs 08:00) passa; segue sendo regra da aplicação',
    (await codigoDeErro(ins('p1', '2026-12-01 08:15:00'))) === null);
}

// ---- B3: índice cego (HMAC) para CPF cifrado ----
const CHAVE_CIFRA = crypto.randomBytes(32);
const CHAVE_HMAC = crypto.randomBytes(32);
const cifrar = (txt) => {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', CHAVE_CIFRA, iv);
  const enc = Buffer.concat([c.update(txt, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
};
const decifrar = (b64) => {
  const b = Buffer.from(b64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', CHAVE_CIFRA, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
};
const hmac = (cpf) => crypto.createHmac('sha256', CHAVE_HMAC).update(cpf.replace(/\D/g, '')).digest('hex');
const cpfFicticio = (n) => String(10000000000 + n).slice(0, 11); // só dígitos; não são CPFs reais

async function pocCpf(c, total = 50000) {
  await c.query(`CREATE TABLE users_poc (
    id INT AUTO_INCREMENT PRIMARY KEY,
    cpf TEXT NULL,
    cpf_hmac CHAR(64) NULL,
    UNIQUE KEY uq_cpf_hmac (cpf_hmac)
  )`);
  const lote = 1000;
  for (let i = 0; i < total; i += lote) {
    const linhas = [];
    for (let j = i; j < Math.min(i + lote, total); j++) linhas.push([cifrar(cpfFicticio(j)), hmac(cpfFicticio(j))]);
    await c.query('INSERT INTO users_poc (cpf, cpf_hmac) VALUES ?', [linhas]);
  }
  const alvo = cpfFicticio(total - 1); // pior caso para a varredura: o último

  let t0 = process.hrtime.bigint();
  const [todos] = await c.query('SELECT id, cpf FROM users_poc WHERE cpf IS NOT NULL');
  const achadoVarredura = todos.find((u) => decifrar(u.cpf) === alvo);
  const tVarredura = ms(t0);

  t0 = process.hrtime.bigint();
  const [[achadoIndice]] = await c.query('SELECT id FROM users_poc WHERE cpf_hmac = ?', [hmac(alvo)]);
  const tIndice = ms(t0);

  registrar('B3: varredura e índice cego encontram o mesmo usuário', !!achadoVarredura && achadoVarredura.id === achadoIndice.id);
  registrar(`B3: busca por índice cego é ordens de grandeza mais rápida (${total} usuários)`, tIndice * 20 < tVarredura,
    `varredura+decifra ${tVarredura.toFixed(1)} ms · índice ${tIndice.toFixed(2)} ms`);
  registrar('B3: o 2º cadastro com o mesmo CPF é recusado pelo banco',
    (await codigoDeErro(c.query('INSERT INTO users_poc (cpf, cpf_hmac) VALUES (?,?)', [cifrar(alvo), hmac(alvo)]))) === 'ER_DUP_ENTRY');
  registrar('B3: CPF com pontuação gera o mesmo HMAC (normalização)', hmac('000.000.000-01') === hmac('00000000001'));
  const cifra1 = cifrar(alvo);
  const cifra2 = cifrar(alvo);
  registrar('B3: a cifra continua não-determinística (mesmo CPF → textos diferentes)', cifra1 !== cifra2);

  // Backfill: preenche cpf_hmac de linhas antigas decifrando uma única vez.
  await c.query('INSERT INTO users_poc (cpf) VALUES (?), (?)', [cifrar('99999999901'), cifrar('99999999902')]);
  t0 = process.hrtime.bigint();
  const [pend] = await c.query('SELECT id, cpf FROM users_poc WHERE cpf_hmac IS NULL AND cpf IS NOT NULL');
  for (const u of pend) await c.query('UPDATE users_poc SET cpf_hmac = ? WHERE id = ?', [hmac(decifrar(u.cpf)), u.id]);
  registrar('B3: backfill preenche as linhas antigas', (await c.query('SELECT COUNT(*) n FROM users_poc WHERE cpf_hmac IS NULL AND cpf IS NOT NULL'))[0][0].n === 0,
    `${pend.length} linha(s) em ${ms(t0).toFixed(1)} ms`);
}

// ---- B1: FKs em tabela que já tem órfãos ----
async function pocFk(c) {
  await c.query(`CREATE TABLE units_poc (id CHAR(36) PRIMARY KEY, name VARCHAR(80))`);
  await c.query(`CREATE TABLE appt_poc (id INT AUTO_INCREMENT PRIMARY KEY, unit_id CHAR(36) NULL, scheduled_at DATETIME NOT NULL)`);
  await c.query("INSERT INTO units_poc VALUES ('u1','UBS A'),('u2','UBS B')");
  await c.query("INSERT INTO appt_poc (unit_id, scheduled_at) VALUES ('u1','2026-12-01 08:00:00'),('u2','2026-12-01 09:00:00'),('fantasma','2026-12-01 10:00:00'),(NULL,'2026-12-01 11:00:00')");

  const [orfaos] = await c.query('SELECT a.id FROM appt_poc a LEFT JOIN units_poc u ON u.id = a.unit_id WHERE a.unit_id IS NOT NULL AND u.id IS NULL');
  registrar('B1: a consulta de auditoria acha exatamente o órfão', orfaos.length === 1, `${orfaos.length} órfão(s)`);

  const fk = 'ALTER TABLE appt_poc ADD INDEX idx_unit_sched (unit_id, scheduled_at), ADD CONSTRAINT fk_appt_unit FOREIGN KEY (unit_id) REFERENCES units_poc (id) ON DELETE SET NULL';
  registrar('B1: adicionar a FK com órfão presente FALHA (por isso a auditoria vem antes)', (await codigoDeErro(c.query(fk))) !== null);

  await c.query('UPDATE appt_poc a LEFT JOIN units_poc u ON u.id = a.unit_id SET a.unit_id = NULL WHERE a.unit_id IS NOT NULL AND u.id IS NULL');
  registrar('B1: depois de zerar os órfãos a FK entra', (await codigoDeErro(c.query(fk))) === null);
  registrar('B1: id inexistente agora é recusado', (await codigoDeErro(c.query("INSERT INTO appt_poc (unit_id, scheduled_at) VALUES ('outro','2026-12-02 08:00:00')"))) !== null);
  await c.query("DELETE FROM units_poc WHERE id='u2'");
  const [[u2]] = await c.query("SELECT unit_id FROM appt_poc WHERE scheduled_at='2026-12-01 09:00:00'");
  registrar('B1: apagar a unidade preserva o agendamento e zera o vínculo (SET NULL)', u2.unit_id === null);
}

async function main() {
  const admin = await conectar(undefined);
  const [[{ v }]] = await admin.query('SELECT VERSION() v');
  console.log(`MySQL ${v}\n`);
  await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
  await admin.query(`CREATE DATABASE ${DB} CHARACTER SET utf8mb4`);
  const c = await conectar(DB);
  try {
    await pocHorarioUnico(c);
    await pocCpf(c);
    await pocFk(c);
  } finally {
    await c.end();
    await admin.query(`DROP DATABASE IF EXISTS ${DB}`);
    await admin.end();
    console.log(`\nbanco descartável ${DB} removido`);
  }
  const falhas = resultados.filter((r) => !r.ok).length;
  console.log(`${resultados.length - falhas}/${resultados.length} verificações passaram`);
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => { console.error('PoC falhou:', e); process.exit(1); });
