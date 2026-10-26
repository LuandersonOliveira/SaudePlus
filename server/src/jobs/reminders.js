/* ==========================================================================
   Saúde+ — Job de lembretes do dia seguinte.

   O bug que motivou este arquivo: a mensagem era montada como
   `${subject} em ${location}, às HH:MM.`, com subject vindo de specialty
   (VARCHAR 120) e location de VARCHAR 180 — ~315 caracteres, numa coluna
   `reminders.message` VARCHAR(255). O ER_DATA_TOO_LONG subia pelo `for` e
   abortava o LOTE INTEIRO: nenhuma consulta e nenhum exame daquele dia
   recebiam lembrete, com uma única linha no console.

   Duas defesas:
     1. a mensagem é truncada explicitamente (o fim da frase se perde, o
        lembrete não);
     2. cada linha do lote é isolada — uma que falha é contada em `failed`
        e não derruba as outras.

   Envio (Fase 7): o job gravava a linha e parava ali. Um lembrete que só
   aparece quando o paciente abre o painel não é lembrete. Agora ele também
   manda e-mail, com três regras que a ordem do código expresses:

     1. GRAVA ANTES DE ENVIAR. O `INSERT` vem primeiro e o envio depois.
        Se o SMTP estiver fora, o lembrete continua existindo no painel —
        perder o registro é pior que não enviar, e é o mesmo critério que
        já governava este arquivo;
     2. `sent_at` só é preenchido se o transporte ACEITOU a mensagem. Um
        envio recusado deixa `sent_at` NULL e grava o motivo em
        `send_error`, para que "não saiu" e "saiu" nunca se confundam;
     3. o envio é isolado por lembrete. Uma falha de SMTP em um paciente não
        toca no lote nem no lembrete dos outros.
   ========================================================================== */
const crypto = require('crypto');
const pool = require('../db');
const mailer = require('../services/mailer');

const DAY_MS = 24 * 60 * 60 * 1000;
// Limite de reminders.message. Espelha o VARCHAR(255) do schema.
const MESSAGE_MAX = 255;
// title é VARCHAR(255) no schema e recebe a string fixa "Lembrete: consulta
// amanhã" — specialty e exam_type vão na MENSAGEM, não no título. O teto
// existe só como rede de segurança; 120 dá folga de sobra.
const TITLE_MAX = 120;

function toSqlDate(date) {
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function nextDayWindow(now = new Date()) {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() + 1);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return { start, end };
}

/**
 * Tenta entregar o lembrete por e-mail e devolve o que foi registrado.
 *
 * `mailer.enviar()` nunca lança, mas o `UPDATE` pode: e se ele falhar, o
 * lembrete continua gravado (a parte que importa) e o job segue.
 */
async function entregarPorEmail(reminderId, userId, { title, message }) {
    let destino;
    try {
        const [[u]] = await pool.query('SELECT email FROM users WHERE id = ?', [userId]);
        destino = u ? u.email : null;
    } catch (err) {
        console.error(`Falha ao buscar e-mail do usuário ${userId}: ${err.message}`);
        return 'failed';
    }

    const resposta = await mailer.enviar({
        para: destino,
        assunto: title,
        texto: `${message}\n\nVocê pode ver seus agendamentos em Saúde+.\nSe não quiser receber lembretes por e-mail, fale com a unidade.`,
    });

    // `sent_at` só quando o transporte aceitou. Sem SMTP configurado, ou com
    // destinatário inválido, fica NULL + send_error — que é informação, não
    // falha silenciosa.
    const sentAt = resposta.enviado ? new Date() : null;
    const motivo = resposta.enviado ? null : String(resposta.motivo || resposta.erro || 'desconhecido').slice(0, 255);
    try {
        await pool.query(
            'UPDATE reminders SET sent_at = ?, send_channel = ?, send_error = ? WHERE id = ?',
            [sentAt, resposta.enviado ? 'email' : null, motivo, reminderId]
        );
    } catch (err) {
        console.error(`Falha ao registrar a entrega do lembrete ${reminderId}: ${err.message}`);
        return 'failed';
    }

    return resposta.enviado ? 'sent' : 'pending';
}

/**
 * Cria o lembrete de um agendamento.
 *
 * Nunca lança — o job chama isto em loop e um throw derrubaria o lote.
 * Devolve 'created' | 'exists' | 'failed' para que o chamador consiga
 * distinguir "já tinha lembrete" de "deu erro": num booleano os dois são
 * false, e um lote inteiro de lembretes já criados pareceria idêntico a um
 * lote que falhou por completo.
 */
async function createReminderFor(row, kind) {
    const ehConsulta = kind === 'appointment';
    const title = `Lembrete: ${ehConsulta ? 'consulta' : 'exame'} amanhã`.slice(0, TITLE_MAX);
    const subject = ehConsulta ? row.specialty : row.exam_type;
    const hora = new Date(row.scheduled_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    // specialty(120) + location(180) + conectores passariam de 255. Cortamos
    // aqui em vez de deixar o MySQL estourar (ou truncar em silêncio).
    const message = `${subject || ''} em ${row.location || ''}, às ${hora}.`.slice(0, MESSAGE_MAX);
    const remindAt = new Date(row.scheduled_at);
    remindAt.setDate(remindAt.getDate() - 1);

    try {
        const [existing] = await pool.query(
            'SELECT id FROM reminders WHERE user_id = ? AND title = ? AND remind_at = ? LIMIT 1',
            [row.user_id, title, toSqlDate(remindAt)]
        );
        if (existing.length) return 'exists';

        // Grava PRIMEIRO. Se o envio falhar, o lembrete continua no painel.
        const reminderId = crypto.randomUUID();
        await pool.query(
            'INSERT INTO reminders (id, user_id, title, message, remind_at) VALUES (?,?,?,?,?)',
            [reminderId, row.user_id, title, message, toSqlDate(remindAt)]
        );

        await entregarPorEmail(reminderId, row.user_id, { title, message });
        return 'created';
    } catch (err) {
        console.error(
            `Falha ao criar lembrete para o usuário ${row.user_id}: ${err.code || ''} ${err.message}`
        );
        return 'failed';
    }
}

async function runReminderJob(now = new Date()) {
    const { start, end } = nextDayWindow(now);
    const startSql = toSqlDate(start);
    const endSql = toSqlDate(end);
    let created = 0;
    let failed = 0;
    // Quantos ficaram registrados sem envio aceito: SMTP não configurado ou
    // destinatário inválido. Não é "failed" — o lembrete existe e está no
    // painel — mas também não é enviado, e o operador precisa ver a diferença
    // no resumo em vez de ler a tabela. É contado depois do lote, em uma
    // consulta só.

    const processar = async (rows, kind) => {
        for (const row of rows) {
            try {
                const r = await createReminderFor(row, kind);
                if (r === 'created') created += 1;
                else if (r === 'failed') failed += 1;
            } catch (err) {
                // Rede de segurança: createReminderFor já engole o próprio
                // erro, mas um throw aqui (ex.: pool fora do ar) não pode
                // interromper o restante do lote.
                failed += 1;
                console.error(`Falha ao processar lembrete (${kind}): ${err.message}`);
            }
        }
    };

    const [appointments] = await pool.query(
        `SELECT user_id, specialty, location, scheduled_at
     FROM appointments
     WHERE status IN ('pendente', 'confirmado')
       AND scheduled_at >= ? AND scheduled_at < ?`,
        [startSql, endSql]
    );
    await processar(appointments, 'appointment');

    const [exams] = await pool.query(
        `SELECT user_id, exam_type, location, scheduled_at
     FROM exams
     WHERE status IN ('pendente', 'confirmado')
       AND scheduled_at >= ? AND scheduled_at < ?`,
        [startSql, endSql]
    );
    await processar(exams, 'exam');

    // Quantos dos lembretes deste dia ficaram sem entrega aceita. Não é
    // "failed": a linha existe e está no painel. Mas também não saiu, e o
    // operador precisa ver essa diferença no resumo em vez de ir ler a
    // tabela.
    //
    // A janela é a de HOJE, não a de amanhã: o lembrete da consulta de
    // amanhã é gravado com `remind_at = scheduled_at - 1 dia`, que é o dia
    // corrente. Filtrar pela janela do agendamento não encontra nada.
    // Só os usuários deste lote: contar a janela inteira somava lembretes de
    // outras execuções/testes e o resumo deixava de descrever o trabalho feito.
    const usuariosDoLote = [...new Set([...appointments, ...exams].map((r) => r.user_id))];
    let pendentes = 0;
    try {
        const hoje = new Date(start);
        hoje.setDate(hoje.getDate() - 1);
        if (usuariosDoLote.length) {
            const [[conta]] = await pool.query(
                `SELECT COUNT(*) AS n FROM reminders
         WHERE remind_at >= ? AND remind_at < ? AND sent_at IS NULL AND send_error IS NOT NULL
           AND user_id IN (?)`,
                [toSqlDate(hoje), startSql, usuariosDoLote]
            );
            pendentes = Number(conta.n) || 0;
        }
    } catch (err) {
        // A contagem é informativo: falhar nela não invalida o lote.
        console.error(`Falha ao contar lembretes pendentes: ${err.message}`);
    }

    return { created, failed, pendentes, appointments: appointments.length, exams: exams.length };
}

function startReminderJob() {
    const execute = () => runReminderJob()
        .then((result) => console.log(
            `Job de lembretes: ${result.created} criado(s), ${result.failed} falha(s), ${result.pendentes} sem envio aceito.`
        ))
        .catch((err) => console.error('Falha no job de lembretes:', err));

    execute();
    return setInterval(execute, DAY_MS);
}

module.exports = { nextDayWindow, runReminderJob, startReminderJob, createReminderFor, entregarPorEmail };