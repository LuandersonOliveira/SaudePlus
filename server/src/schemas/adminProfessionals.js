/* ==========================================================================
   Saúde+ — validação de entrada da gestão de profissionais e agenda
   (A1 passo 8c / A2 da Fase 6): funções PURAS.

   Cada `validar*` devolve `{ ok: false, error }` ou `{ ok: true, dados }` com os valores
   já normalizados, e checa na ordem de sempre — a primeira falha é a mensagem da API.
   Não consultam banco: existência de profissional/unidade (404) é do serviço.
   ========================================================================== */

const KINDS = ['consulta', 'exame'];
const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/;
const SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

const falha = (error) => ({ ok: false, error });

// Aceita "HH:MM" ou "HH:MM:SS" e normaliza para "HH:MM:SS" — mas só se hora e
// minuto existirem de verdade. O regex sozinho aceitou "99:99" e "12:99": o
// INSERT passava, o MySQL reclamava, e a rota devolvia **500** (não 400). Pior:
// um horário assim some de todos os filtros de disponibilidade, então o
// profissional desaparece do próprio dia de atendimento sem ninguém perceber.
function cleanTime(value) {
  if (typeof value !== 'string' || !TIME_RE.test(value)) return null;
  const [h, m] = value.split(':').map(Number);
  if (!Number.isInteger(h) || !Number.isInteger(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

function minutesOf(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

/** Motivo (corpo ou ?reason=) para a trilha de auditoria; teto de 1000, o mesmo do sanitizeDetails. */
function motivoDe(req) {
  const bruto = String((req.body && req.body.reason) || (req.query && req.query.reason) || '').trim();
  return bruto.slice(0, 1000);
}

/** Sufixo "; motivo: …" da linha de auditoria. */
const sufixoMotivo = (reason) => (reason ? `; motivo: ${reason}` : '');

function validarProfissional(body) {
  const { name, job_title: jobTitle, registry } = body || {};
  if (!name || !String(name).trim()) return falha('Nome do profissional é obrigatório.');
  return { ok: true, dados: { name: String(name).trim(), jobTitle: jobTitle || null, registry: registry || null } };
}

function validarVinculo(body) {
  const { unit_id: unitId, kind, name } = body || {};
  if (!unitId) return falha('Selecione a unidade.');
  if (!KINDS.includes(kind)) return falha('Tipo inválido (consulta ou exame).');
  const serviceName = String(name || '').trim();
  if (!serviceName) return falha('Informe a especialidade ou tipo de exame.');
  return { ok: true, dados: { unitId, kind, serviceName } };
}

function validarHorario(body) {
  const { unit_id: unitId, weekday, start_time: startTime, end_time: endTime } = body || {};
  const slot = Number(body && body.slot_minutes) || 30;
  const dia = Number(weekday);
  if (!unitId) return falha('Selecione a unidade.');
  if (!Number.isInteger(dia) || dia < 0 || dia > 6) return falha('Dia da semana inválido (0 = domingo a 6 = sábado).');
  const start = cleanTime(startTime);
  const end = cleanTime(endTime);
  if (!start || !end) return falha('Horários no formato HH:MM.');
  if (minutesOf(start) >= minutesOf(end)) return falha('O horário final deve ser depois do inicial.');
  if (slot < 5 || slot > 240) return falha('Duração do atendimento entre 5 e 240 minutos.');
  return { ok: true, dados: { unitId, weekday: dia, start, end, slot } };
}

function validarBloqueio(body) {
  const { unit_id: unitId, starts_at: startsAt, ends_at: endsAt } = body || {};
  if (!unitId) return falha('Selecione a unidade.');
  const start = String(startsAt || '').replace('T', ' ');
  const end = String(endsAt || '').replace('T', ' ');
  if (!DATETIME_RE.test(start) || !DATETIME_RE.test(end)) return falha('Informe início e fim do bloqueio.');
  if (new Date(start) >= new Date(end)) return falha('O fim do bloqueio deve ser depois do início.');
  return { ok: true, dados: { unitId, start, end } };
}

module.exports = {
  KINDS, SEMANA, cleanTime, minutesOf, motivoDe, sufixoMotivo,
  validarProfissional, validarVinculo, validarHorario, validarBloqueio,
};
