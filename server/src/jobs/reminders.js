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
   ========================================================================== */
const crypto = require('crypto');
const pool = require('../db');

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

        await pool.query(
            'INSERT INTO reminders (id, user_id, title, message, remind_at) VALUES (?,?,?,?,?)',
            [crypto.randomUUID(), row.user_id, title, message, toSqlDate(remindAt)]
        );
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

    return { created, failed, appointments: appointments.length, exams: exams.length };
}

function startReminderJob() {
    const execute = () => runReminderJob()
        .then((result) => console.log(
            `Job de lembretes: ${result.created} criado(s), ${result.failed} falha(s).`
        ))
        .catch((err) => console.error('Falha no job de lembretes:', err));

    execute();
    return setInterval(execute, DAY_MS);
}

module.exports = { nextDayWindow, runReminderJob, startReminderJob, createReminderFor };