/**
 * `server/schema.sql` é o caminho de instalação limpa: `mysql < schema.sql`
 * cria o banco do zero. Mas ele tinha ficado para trás — as colunas e tabelas
 * que as migrations JS e SQL criavam NÃO estavam nele.
 *
 * A consequência é silenciosa, e é o que importa aqui:
 *   - sem `users.totp_enabled`, `if (user.totp_enabled)` lê `undefined` e o
 *     login nunca pede o segundo fator. Nenhum erro, nenhum aviso;
 *   - sem `users.govbr_sub`, GET /auth/govbr/callback dá 500;
 *   - sem `refresh_tokens`, POST /auth/refresh dá 500;
 *   - sem `health_units.cnes_code`, npm run sync:cnes aborta.
 *
 * O README ainda listava a sequência de migrations sem `migrate:interop`.
 *
 * Este teste cria um banco descartável aplicando SÓ o schema.sql e confere
 * que existe tudo que o código toca.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const { rewriteSchemaForDb } = require('../../scripts/db-setup');

require(require.resolve('dotenv', { paths: [path.join(ROOT, 'server')] })).config({
  path: path.join(ROOT, 'server', '.env'),
});
const mysql = require(
  require.resolve('mysql2/promise', { paths: [path.join(ROOT, 'server')] })
);

const DB = `saude_parity_${process.pid}`;

// Tudo que server/src consulta. Se um item aqui faltar do schema.sql, a
// instalação limpa quebra na primeira tela que o tocar.
const COLUNAS = [
  ['users', 'full_name'],
  ['users', 'email'],
  ['users', 'password_hash'],
  ['users', 'role'],
  ['users', 'admin_level'],
  ['users', 'account_status'],
  ['users', 'job_role'],
  ['users', 'social_name'],
  ['users', 'cns'],
  ['users', 'priority'],
  ['users', 'race'],
  ['users', 'gender'],
  ['users', 'blood_type'],
  ['users', 'zone'],
  ['users', 'mother_name'],
  ['users', 'father_name'],
  ['users', 'guardian_name'],
  ['users', 'birth_date'],
  ['users', 'mobile'],
  ['users', 'phone'],
  ['users', 'cep'],
  ['users', 'street'],
  ['users', 'address_number'],
  ['users', 'neighborhood'],
  ['users', 'city'],
  ['users', 'state'],
  ['users', 'reference_point'],
  ['users', 'last_login_at'],
  // Fase 0 — refresh tokens
  ['users', 'consent_at'],
  ['users', 'consent_ip'],
  ['users', 'privacy_version'],
  ['users', 'deleted_at'],
  // Fase 2 — Gov.br
  ['users', 'govbr_sub'],
  // Aulas 1/6 — MFA
  ['users', 'totp_secret'],
  ['users', 'totp_enabled'],
  // Fase 2 — interop
  ['health_units', 'cnes_code'],
  ['health_units', 'phone'],
  ['health_units', 'address'],
  ['health_units', 'neighborhood'],
  ['health_units', 'active'],
  // Interop
  ['diseases', 'source'],
  ['diseases', 'external_ref'],
  // V3 — agenda inteligente
  ['professionals', 'name'],
  ['professionals', 'job_title'],
  ['professionals', 'registry'],
  ['work_schedules', 'professional_id'],
  ['work_schedules', 'unit_id'],
  ['work_schedules', 'weekday'],
  ['work_schedules', 'start_time'],
  ['work_schedules', 'end_time'],
  ['work_schedules', 'slot_minutes'],
  ['professional_offers', 'professional_id'],
  ['professional_offers', 'unit_id'],
  ['schedule_blocks', 'professional_id'],
  ['schedule_blocks', 'unit_id'],
  // V3 — vínculos de agendamento
  ['appointments', 'unit_id'],
  ['appointments', 'professional_id'],
  ['exams', 'unit_id'],
  ['exams', 'professional_id'],
  // Auditoria encadeada
  ['audit_log', 'details'],
  ['audit_log', 'prev_hash'],
  ['audit_log', 'entry_hash'],
  ['audit_log', 'seq'],
];

const TABELAS = [
  'users',
  'appointments',
  'exams',
  'reminders',
  'diseases',
  'health_units',
  'audit_log',
  'refresh_tokens',
  'professionals',
  'unit_offers',
  'professional_offers',
  'work_schedules',
  'schedule_blocks',
];

let conn;

test.before(async () => {
  const admin = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
    charset: 'utf8mb4',
  });
  await admin.query('DROP DATABASE IF EXISTS `' + DB + '`');
  await admin.query('CREATE DATABASE `' + DB + '` CHARACTER SET utf8mb4');
  await admin.end();

  conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: DB,
    multipleStatements: true,
    charset: 'utf8mb4',
  });
  // Só o schema.sql. As migrations NÃO são aplicadas aqui — é exatamente o
  // cenário "instalação limpa" que precisa funcionar sozinho.
  await conn.query(
    rewriteSchemaForDb(fs.readFileSync(path.join(ROOT, 'server', 'schema.sql'), 'utf8'), DB)
  );
});

test.after(async () => {
  if (conn) await conn.end().catch(() => {});
  const admin = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
  });
  await admin.query('DROP DATABASE IF EXISTS `' + DB + '`').catch(() => {});
  await admin.end().catch(() => {});
});

test('schema.sql sozinho cria todas as tabelas que o código usa', async () => {
  const [rows] = await conn.query(
    'SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ?',
    [DB]
  );
  const tem = new Set(rows.map((r) => r.t));
  const faltando = TABELAS.filter((t) => !tem.has(t));
  assert.deepEqual(faltando, [], `faltam tabelas: ${faltando.join(', ')}`);
});

test('schema.sql sozinho cria todas as colunas que o código usa', async () => {
  const [rows] = await conn.query(
    'SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = ?',
    [DB]
  );
  const tem = new Set(rows.map((r) => `${r.t}.${r.c}`));
  const faltando = COLUNAS.filter(([t, c]) => !tem.has(`${t}.${c}`));
  assert.deepEqual(
    faltando,
    [],
    `faltam colunas:\n  - ${faltando.map(([t, c]) => `${t}.${c}`).join('\n  - ')}`
  );
});

test('sem migrate:interop o MFA ficaria silenciosamente desligado', async () => {
  // Este é o teste que documenta o modo de falha. Se totp_enabled sumir do
  // schema.sql, `if (user.totp_enabled)` lê undefined e o segundo fator
  // nunca é pedido — sem erro em lugar nenhum.
  const [rows] = await conn.query(
    "SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = ? AND table_name = 'users' AND column_name = 'totp_enabled'",
    [DB]
  );
  assert.equal(Number(rows[0].n), 1, 'users.totp_enabled precisa existir no schema.sql');
});

test('cpf/rg/cns aceitam o ciphertext (VARCHAR curto quebra o cadastro)', async () => {
  // migrate-privacy converte as três para TEXT porque o app guarda
  // "enc:v1:<iv>:<ct>:<tag>", ~70 caracteres. Com o VARCHAR(14) original,
  // uma instalação limpa dava ERROR 1406 já no primeiro cadastro com CPF —
  // e só depois de o usuário ter digitado tudo.
  const [cols] = await conn.query(
    `SELECT column_name AS c, data_type AS t FROM information_schema.columns
      WHERE table_schema = ? AND table_name = 'users'
        AND column_name IN ('cpf', 'rg', 'cns')`,
    [DB]
  );
  const curtos = cols.filter((c) => c.t !== 'text' && c.t !== 'mediumtext' && c.t !== 'longtext');
  assert.deepEqual(
    curtos.map((c) => `${c.c}:${c.t}`),
    [],
    'cpf/rg/cns precisam ser TEXT — o ciphertext enc:v1: não cabe em VARCHAR'
  );

  // E o pior: gravar de fato um documento cifrado, que é o que o app faz.
  const id = crypto.randomUUID();
  await conn.query(
    `INSERT INTO users (id, full_name, email, password_hash, role, cpf, rg, cns)
     VALUES (?,?,?,?,?,?,?,?)`,
    [
      id, 'Teste Cifrado', 'cifrado@test.local', 'x'.repeat(60), 'paciente',
      'enc:v1:AAAAAAAAAAAAAAAAAAAAAAAA:BBBBBBBBBBBBBBBBBBBB:CCCCCCCCCCCCCCCC',
      'enc:v1:AAAAAAAAAAAAAAAAAAAAAAAA:BBBBBBBBBBBBBBBBBBBB:CCCCCCCCCCCCCCCC',
      'enc:v1:AAAAAAAAAAAAAAAAAAAAAAAA:BBBBBBBBBBBBBBBBBBBB:CCCCCCCCCCCCCCCC',
    ]
  );
  const [[row]] = await conn.query('SELECT CHAR_LENGTH(cpf) AS n FROM users WHERE id = ?', [id]);
  assert.ok(Number(row.n) > 20, 'o ciphertext tem que caber inteiro');
});

test('o seed de unidades sai do schema.sql já populado', async () => {
  const [[row]] = await conn.query('SELECT COUNT(*) AS n FROM health_units');
  assert.equal(Number(row.n), 10, 'o schema.sql traz as 10 unidades de Lagoa de Itaenga');
});

test('o README documenta a ordem real das migrations', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');

  // O caminho principal é `npm run setup`, e o manual usa `migrate:all` —
  // não a lista migration-por-migration, que era o que o README mostrava
  // antes e que ninguém devia copiar na mão.
  assert.match(readme, /npm run setup/, 'o README precisa oferecer o setup por comando');
  assert.match(readme, /npm run migrate:all/, 'o caminho manual precisa usar migrate:all');

  // A ordem autoritativa é a linha da tabela que descreve o `migrate:all`.
  // Não dá para varrer o README inteiro: o texto de aviso menciona
  // `migrate:privacy` antes da tabela, e "primeira ocorrência" mede prosa,
  // não ordem. A nota "Ordem importa" também quebra em várias linhas.
  const linha = readme
    .split('\n')
    .find((l) => /^\s*\|\s*`migrate:all`/.test(l));
  assert.ok(linha, 'o README precisa ter uma linha de tabela para migrate:all');

  const ordem = ['v3', 'security', 'privacy', 'interop', 'audit'];
  let pos = -1;
  for (const passo of ordem) {
    const i = linha.indexOf(passo);
    assert.ok(i > -1, `a linha do migrate:all não menciona ${passo}`);
    assert.ok(i > pos, `a linha do migrate:all lista ${passo} fora de ordem`);
    pos = i;
  }

  // E a linha precisa bater com o que o script realmente executa.
  const pkg = require('../package.json');
  const executadas = (pkg.scripts['migrate:all'].match(/migrate:[\w:]+/g) || [])
    .map((m) => m.replace('migrate:', ''));
  assert.ok(executadas.length >= 6, `migrate:all só encadeia ${executadas.length} migrations`);
  let anterior = -1;
  for (const passo of executadas) {
    const i = linha.indexOf(passo);
    assert.ok(i > -1, `o README não documenta migrate:${passo}, que o migrate:all executa`);
    assert.ok(i > anterior, `o README documenta migrate:${passo} fora de ordem`);
    anterior = i;
  }
});

test('o README avisa que pular migrate:interop desliga o MFA', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const bloco = readme.slice(readme.indexOf('migrate:interop'));
  assert.match(
    bloco.slice(0, 1200),
    /mfa|segundo fator/i,
    'o README deveria avisar que pular migrate:interop desliga o MFA silenciosamente'
  );
});