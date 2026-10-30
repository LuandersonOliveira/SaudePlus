/* ==========================================================================
   Datas locais da agenda.

   `toISOString()` converte para UTC. No Brasil (UTC-3), às 21h de hoje isso
   já é "amanhã" no calendário UTC. A agenda, os relatórios e o filtro
   administrativo precisam falar o dia local do serviço, não o dia UTC.
   ========================================================================== */

function pad2(n) {
  return String(n).padStart(2, '0');
}

function isValidDateOnly(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const [ano, mes, dia] = String(value).split('-').map(Number);
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

function localDateStr(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function localDateTimeStr(date = new Date()) {
  return `${localDateStr(date)}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function addDaysLocal(date, days) {
  const d = new Date(date.getTime());
  d.setDate(d.getDate() + Number(days || 0));
  return d;
}

function localDateRange(startDate, days) {
  const total = Math.max(Number.parseInt(days, 10) || 1, 1);
  return Array.from({ length: total }, (_, i) => localDateStr(addDaysLocal(startDate, i)));
}

module.exports = {
  isValidDateOnly,
  localDateStr,
  localDateTimeStr,
  addDaysLocal,
  localDateRange,
};
