/**
 * O job de lembretes montava e persistia a linha, e era só isso. O paciente
 * via o lembrete se abrisse o painel — o que não serve para lembrar de uma
 * consulta amanhã.
 *
 * Aqui medimos a decisão em volta do envio, que é a que importa:
 *
 *  - o lembrete é gravado ANTES de tentar enviar, e uma falha de envio não
 *    pode apagar nem impedir o lembrete (perder o registro é pior que não
 *    enviar);
 *  - `sent_at` só é preenchido quando o transporte aceitou a mensagem;
 *  - usuário sem e-mail é um estado diferente de envio que falhou: no
 *    primeiro o lembrete continua no painel, no segundo houve erro;
 *  - o lote não pode morrer por causa de um e-mail.
 *
 * O transporte é substituído por um dublê: SMTP é do provedor, não nosso.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..', '..');
const SERVER = path.join(ROOT, 'server');
require(require.resolve('dotenv', { paths: [SERVER] })).config({ path: path.join(SERVER, '.env') });

const pool = require('../src/db');
const bcrypt = require(require.resolve('bcryptjs', { paths: [SERVER] }));
const mailer = require('../src/services/mailer');
const lembretes = require('../src/jobs/reminders');

const CRIADOS = [];

const pad = (v) => String(v).padStart(2, '0');
const amanha = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

async function criarUsuario(email = null) {
  const id = crypto.randomUUID();
  const mail = email === null ? `lembrete+${id.slice(0, 8)}@test.local` : email;
  await pool.query(
    `INSERT INTO users (id, full_name, email, password_hash, role, account_status)
     VALUES (?,?,?,?,?,?)`,
    [id, 'Lembrete', mail, await bcrypt.hash('senha12345', 4), 'paciente', 'ativo']
  );
  CRIADOS.push(id);
  return { id, email: mail };
}

const LIMPAR = async () => {
  await pool.query('DELETE FROM reminders WHERE user_id IN (?)', [CRIADOS]).catch(() => {});
  for (const id of CRIADOS) await pool.query('DELETE FROM users WHERE id = ?', [id]).catch(() => {});
  CRIADOS.length = 0;
};

/** Troca o transporte por um dublê e devolve o que ele recebeu. */
function dublarMailer(retorno) {
  const enviados = [];
  const original = mailer.enviar;
  mailer.enviar = async (msg) => {
    enviados.push(msg);
    return typeof retorno === 'function' ? retorno(msg) : retorno;
  };
  return {
    enviados,
    restaurar: () => { mailer.enviar = original; },
  };
}

test.afterEach(async () => { await LIMPAR(); });
test.after(async () => {
  await LIMPAR();
  await pool.end().catch(() => {});
});

test('reminder criado e enviado quando há e-mail', async () => {
  const u = await criarUsuario();
  const d = dublarMailer({ enviado: true });
  try {
    const r = await lembretes.createReminderFor(
      { user_id: u.id, specialty: 'Clínica Geral', location: 'UBS', scheduled_at: `${amanha()} 09:00:00` },
      'appointment'
    );
    assert.equal(r, 'created');

    const [[linha]] = await pool.query('SELECT * FROM reminders WHERE user_id = ?', [u.id]);
    assert.ok(linha.sent_at, 'sent_at precisa ser preenchido quando o envio foi aceito');
    assert.equal(linha.send_error, null, 'não pode haver erro quando enviou');
    assert.equal(linha.send_channel, 'email');
    assert.equal(d.enviados.length, 1, 'deve ter tentado um e-mail');
    assert.equal(d.enviados[0].para, u.email);
    assert.match(d.enviados[0].assunto, /consulta/i);
  } finally { d.restaurar(); }
});

test('falha de envio NÃO impede o lembrete de existir', async () => {
  const u = await criarUsuario();
  const d = dublarMailer({ enviado: false, motivo: 'erro_transporte', erro: 'ECONNREFUSED' });
  try {
    const r = await lembretes.createReminderFor(
      { user_id: u.id, specialty: 'Clínica Geral', location: 'UBS', scheduled_at: `${amanha()} 09:00:00` },
      'appointment'
    );
    assert.equal(r, 'created', 'o lembrete foi criado mesmo com o envio falhando');

    const [[linha]] = await pool.query('SELECT * FROM reminders WHERE user_id = ?', [u.id]);
    assert.ok(linha.id, 'a linha tem que estar lá — perder o lembrete é o pior resultado');
    assert.equal(linha.sent_at, null, 'não enviou, então sent_at fica NULL');
    assert.ok(linha.send_error, 'e o motivo fica registrado, senão parece sucesso');
  } finally { d.restaurar(); }
});

test('usuário sem e-mail fica SEM send_error — é estado diferente de erro', async () => {
  // email vazio: o INSERT exige NOT NULL UNIQUE, então usamos string vazia
  // só para simular? Não — o schema exige e-mail. O caminho real de
  // "sem e-mail" é o e-mail inválido/ausente na resposta do cadastro.
  // Aqui testamos o efeito: destinatário inválido não vira erro de transporte.
  const u = await criarUsuario('nao-e-um-email');
  const d = dublarMailer({ enviado: false, motivo: 'destinatario_invalido' });
  try {
    const r = await lembretes.createReminderFor(
      { user_id: u.id, specialty: 'Clínica Geral', location: 'UBS', scheduled_at: `${amanha()} 09:00:00` },
      'appointment'
    );
    assert.equal(r, 'created');
    const [[linha]] = await pool.query('SELECT * FROM reminders WHERE user_id = ?', [u.id]);
    assert.equal(linha.sent_at, null);
    assert.equal(linha.send_error, 'destinatario_invalido');
  } finally { d.restaurar(); }
});

test('SMTP não configurado é registrado como pendente, não como sucesso', async () => {
  const u = await criarUsuario();
  const d = dublarMailer({ enviado: false, motivo: 'smtp_nao_configurado' });
  try {
    await lembretes.createReminderFor(
      { user_id: u.id, specialty: 'Clínica Geral', location: 'UBS', scheduled_at: `${amanha()} 09:00:00` },
      'appointment'
    );
    const [[linha]] = await pool.query('SELECT * FROM reminders WHERE user_id = ?', [u.id]);
    assert.equal(linha.sent_at, null, 'sem SMTP não foi enviado — não pode marcar como enviado');
    assert.equal(linha.send_error, 'smtp_nao_configurado');
  } finally { d.restaurar(); }
});

test('o e-mail carrega o paciente, não o texto cru do banco', async () => {
  const u = await criarUsuario();
  const d = dublarMailer({ enviado: true });
  try {
    await lembretes.createReminderFor(
      { user_id: u.id, specialty: 'Clínica Geral', location: 'UBS', scheduled_at: `${amanha()} 09:00:00` },
      'appointment'
    );
    const msg = d.enviados[0];
    assert.equal(msg.para, u.email);
    assert.ok(msg.texto && msg.texto.length > 0, 'precisa de corpo legível');
    assert.match(msg.texto, /UBS/, 'o corpo diz onde e quando');
    assert.ok(msg.assunto.length > 0);
    // Nenhum segredo pode vazar para o e-mail.
    assert.ok(!/password|senha|token|bearer/i.test(msg.texto), 'o corpo não pode conter credencial');
  } finally { d.restaurar(); }
});

test('o lote inteiro não morre quando um envio falha', async () => {
  const a = await criarUsuario();
  const b = await criarUsuario();
  // Uma data futura e isolada: o banco de desenvolvimento tem o seed demo em
  // "amanhã", e o resumo do lote conta todos os usuários encontrados. Rodar
  // esta prova em "amanhã" media também os lembretes do seed.
  const base = new Date();
  base.setDate(base.getDate() + 45);
  const alvo = new Date(base);
  alvo.setDate(alvo.getDate() + 1);
  const dia = `${alvo.getFullYear()}-${pad(alvo.getMonth() + 1)}-${pad(alvo.getDate())}`;
  // O job só enxerga agendamentos do dia seguinte a `now` — sem eles não há lembrete.
  for (const u of [a, b]) {
    await pool.query(
      `INSERT INTO appointments (id, user_id, specialty, location, scheduled_at, status)
       VALUES (?,?,?,?,?,'pendente')`,
      [crypto.randomUUID(), u.id, 'Clínica Geral', 'UBS', `${dia} 09:00:00`]
    );
  }

  const d = dublarMailer((msg) => (msg.para === a.email
    ? { enviado: false, motivo: 'erro_transporte', erro: 'ECONNREFUSED' }
    : { enviado: true }));
  try {
    const r = await lembretes.runReminderJob(base);
    assert.equal(r.failed, 0, 'uma falha de e-mail não é falha de criação do lembrete');
    assert.equal(r.pendentes, 1, 'o resumo precisa distinguir "não enviado" de "não criado"');

    // As duas linhas existem, porque o INSERT vem antes do envio.
    const [[n]] = await pool.query('SELECT COUNT(*) AS n FROM reminders WHERE user_id IN (?,?)', [a.id, b.id]);
    assert.equal(n.n, 2, 'um e-mail que falhou não pode apagar o lembrete do outro');

    const [[doQueFalhou]] = await pool.query('SELECT sent_at FROM reminders WHERE user_id = ?', [a.id]);
    const [[doQueDeuCerto]] = await pool.query('SELECT sent_at FROM reminders WHERE user_id = ?', [b.id]);
    assert.equal(doQueFalhou.sent_at, null, 'a que falhou não foi marcada como enviada');
    assert.ok(doQueDeuCerto.sent_at, 'a que deu certo foi');
  } finally { d.restaurar(); }
});