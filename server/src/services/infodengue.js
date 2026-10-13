// ==========================================================================
// Saúde+ — Alertas InfoDengue (Fase 2.2)
// Fonte: InfoDengue/Fiocruz (pública, sem credenciamento).
//   GET https://info.dengue.mat.br/api/alertcity
//       ?geocode=2608503&disease=dengue|zika|chikungunya&format=json
//       &ew_start=1&ew_end=52&ey_start=AAAA&ey_end=AAAA
// Nível InfoDengue (1=verde,2=amarelo,3=laranja,4=vermelho) -> alert_level:
//   1-2 => baixo, 3 => medio, 4 => alto.
// Upsert por (source='infodengue', external_ref='dengue:2608503'): o CRUD
// manual do admin continua valendo para source='manual' (não é sobrescrito).
// ==========================================================================
const crypto = require('crypto');

const INFODENGUE_BASE = process.env.INFODENGUE_API_BASE || 'https://info.dengue.mat.br';
const GEOCODE = process.env.INFODENGUE_GEOCODE || '2608503'; // Lagoa de Itaenga/PE
const DISEASES = ['dengue', 'zika', 'chikungunya'];
const NAMES = { dengue: 'Dengue', zika: 'Zika', chikungunya: 'Chikungunya' };

function nivelToAlert(nivel) {
  if (nivel >= 4) return 'alto';
  if (nivel === 3) return 'medio';
  return 'baixo';
}

async function fetchSeries(disease, geocode = GEOCODE, years = 1) {
  const now = new Date();
  const eyEnd = now.getFullYear();
  const eyStart = eyEnd - (years - 1);
  const url = `${INFODENGUE_BASE}/api/alertcity?geocode=${geocode}&disease=${disease}` +
    `&format=json&ew_start=1&ew_end=53&ey_start=${eyStart}&ey_end=${eyEnd}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`InfoDengue retornou ${res.status} para ${disease}`);
  const body = await res.json();
  return Array.isArray(body) ? body : [];
}

// Resume as últimas `weeks` semanas epidemiológicas com dados.
// A API nem sempre devolve em ordem cronológica: ordena por SE (AAAASS).
function summarize(series, weeks = 4) {
  const withCases = series.filter((w) => w != null && w.SE != null);
  withCases.sort((a, b) => Number(a.SE) - Number(b.SE));
  const recent = withCases.slice(-weeks);
  if (!recent.length) return null;
  const maxNivel = Math.max(...recent.map((w) => Number(w.nivel) || 0));
  const totalCasos = recent.reduce((a, w) => a + (Number(w.casos) || 0), 0);
  const firstSE = recent[0].SE;
  const lastSE = recent[recent.length - 1].SE;
  return { maxNivel, totalCasos, firstSE, lastSE, weeks: recent.length };
}

async function sync(pool, { apply = false, geocode = GEOCODE, weeks = 4 } = {}) {
  const plan = [];
  for (const disease of DISEASES) {
    const series = await fetchSeries(disease, geocode);
    const sum = summarize(series, weeks);
    if (!sum) {
      plan.push({ disease, status: 'sem-dados' });
      continue;
    }
    const level = nivelToAlert(sum.maxNivel);
    const description =
      `Fonte: InfoDengue/Fiocruz. SE ${sum.firstSE}–${sum.lastSE} (${sum.weeks} sem): ` +
      `nível máximo ${sum.maxNivel}/4, ${sum.totalCasos} caso(s) prováveis.`;
    const externalRef = `${disease}:${geocode}`;
    const [existing] = await pool.query(
      "SELECT id, alert_level, active FROM diseases WHERE source = 'infodengue' AND external_ref = ?",
      [externalRef]
    );
    const entry = {
      disease, name: NAMES[disease], level, description, externalRef,
      action: existing.length ? (existing[0].alert_level === level ? 'igual' : 'atualizar') : 'criar',
    };
    plan.push(entry);

    if (apply && entry.action !== 'igual') {
      if (!existing.length) {
        await pool.query(
          `INSERT INTO diseases (id, name, region, alert_level, description, active, source, external_ref)
           VALUES (?,?,?,?,?,1,'infodengue',?)`,
          [crypto.randomUUID(), NAMES[disease], 'Lagoa de Itaenga', level, description, externalRef]
        );
      } else {
        await pool.query(
          'UPDATE diseases SET alert_level = ?, description = ?, active = 1 WHERE id = ?',
          [level, description, existing[0].id]
        );
      }
    }
  }
  return { geocode, weeks, plan, applied: apply };
}

module.exports = { fetchSeries, summarize, sync, nivelToAlert, DISEASES, GEOCODE };
