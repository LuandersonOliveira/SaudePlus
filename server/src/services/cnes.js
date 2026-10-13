// ==========================================================================
// Saúde+ — Sync CNES (Fase 2.1)
// Fonte: API pública de Dados Abertos do DATASUS (sem credenciamento).
//   GET https://apidadosabertos.saude.gov.br/cnes/estabelecimentos
//       ?codigo_municipio=260850&limit=20&offset=N
// Regras:
// - Só estabelecimentos SEM motivo de desabilitação (ativos).
// - Só com atendimento ambulatorial SUS (filtra consultório privado).
// - Tipo mapeado por nome fantasia/razao (fallback: 'outro').
// - Idempotente: casa por cnes_code; seeds antigas sem código casam por nome.
// ==========================================================================
const crypto = require('crypto');

const CNES_BASE = process.env.CNES_API_BASE || 'https://apidadosabertos.saude.gov.br';
const MUNICIPIO = process.env.CNES_MUNICIPIO_CODE || '260850'; // Lagoa de Itaenga/PE

function norm(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function mapType(fantasia, razao) {
  const name = norm(fantasia) + ' ' + norm(razao);
  if (/\bCAPS\b/.test(name)) return 'caps';
  if (/\bHOSPITAL\b|\bMATERNIDADE\b|\bCASA DE SAUDE\b|\bMISTA\b/.test(name)) return 'hospital';
  if (/\bPOSTO\b|\bUBS\b|\bUNIDADE BASICA\b|\bSAUDE DA FAMILIA\b|\bPSF\b|\bESF\b|\bCENTRO DE SAUDE\b/.test(name)) return 'ubs';
  if (/\bPOLICLINICA\b|\bCLINICA\b|\bUPA\b|\bCEO\b|\bCENTRO DE ESPECIALIDADES\b|\bLABORATORIO\b/.test(name)) return 'clinica';
  return 'outro';
}

function isActive(est) {
  return !est.codigo_motivo_desabilitacao_estabelecimento;
}

function isSusRelevant(est) {
  return est.estabelecimento_faz_atendimento_ambulatorial_sus === 'SIM';
}

function toUnit(est) {
  const address = [est.endereco_estabelecimento, est.numero_estabelecimento, est.bairro_estabelecimento]
    .filter(Boolean).join(', ');
  return {
    cnesCode: String(est.codigo_cnes),
    name: est.nome_fantasia || est.nome_razao_social,
    type: mapType(est.nome_fantasia, est.nome_razao_social),
    neighborhood: est.bairro_estabelecimento || null,
    phone: est.numero_telefone_estabelecimento || null,
    address: address || null,
  };
}

async function fetchAll(municipio = MUNICIPIO) {
  const all = [];
  let offset = 0;
  for (;;) {
    const url = `${CNES_BASE}/cnes/estabelecimentos?codigo_municipio=${municipio}&limit=20&offset=${offset}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`CNES retornou ${res.status} em ${url}`);
    const body = await res.json();
    const list = body.estabelecimentos || [];
    if (!list.length) break;
    all.push(...list);
    offset += 20;
    if (offset > 1000) break; // trava de segurança
  }
  return all;
}

// Sincroniza com o banco. apply=false => dry-run (só relata).
async function sync(pool, { apply = false, municipio = MUNICIPIO } = {}) {
  const all = await fetchAll(municipio);
  const relevant = all.filter((e) => isActive(e) && isSusRelevant(e)).map(toUnit);
  const skipped = all.length - relevant.length;

  const [existing] = await pool.query('SELECT id, name, type, neighborhood, phone, address, cnes_code FROM health_units');
  const byCnes = new Map(existing.filter((u) => u.cnes_code).map((u) => [String(u.cnes_code), u]));
  const byName = new Map(existing.map((u) => [norm(u.name), u]));

  const plan = { insert: [], update: [], unchanged: [], skipped };
  for (const unit of relevant) {
    const known = byCnes.get(unit.cnesCode) || byName.get(norm(unit.name));
    if (!known) {
      plan.insert.push(unit);
    } else {
      const diff = ['name', 'type', 'neighborhood', 'phone', 'address'].some((k) => (known[k] || null) !== (unit[k] || null))
        || known.cnes_code !== unit.cnesCode;
      (diff ? plan.update : plan.unchanged).push({ unit, id: known.id });
    }
  }

  if (apply) {
    for (const unit of plan.insert) {
      await pool.query(
        'INSERT INTO health_units (id, name, type, neighborhood, active, cnes_code, phone, address) VALUES (?,?,?,?,1,?,?,?)',
        [crypto.randomUUID(), unit.name, unit.type, unit.neighborhood, unit.cnesCode, unit.phone, unit.address]
      );
    }
    for (const { unit, id } of plan.update) {
      await pool.query(
        'UPDATE health_units SET name = ?, type = ?, neighborhood = ?, phone = ?, address = ?, cnes_code = ? WHERE id = ?',
        [unit.name, unit.type, unit.neighborhood, unit.phone, unit.address, unit.cnesCode, id]
      );
    }
  }

  return { municipio, fetched: all.length, ...plan, applied: apply };
}

module.exports = { fetchAll, sync, mapType, isActive, isSusRelevant, toUnit, norm, MUNICIPIO };
