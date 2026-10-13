// ==========================================================================
// Saúde+ — Camada RNDS/FHIR R4 (Fase 2.5)
// Envio de documentos clínicos ao barramento nacional (Conecte SUS).
// Referência: IG https://rnds-fhir.saude.gov.br/ (perfis fechados por modelo:
// RAC, REL, RIA...). Os builders abaixo geram o envelope mínimo válido;
// antes da homologação, validar cada Bundle no Validador Local de Profiles
// do DATASUS (JAR) e ajustar aos perfis oficiais.
//
// Transporte: EHR Auth (mTLS c/ certificado ICP-Brasil) -> access_token 15min
// -> POST {UF}-ehr-services/fhir/r4/Bundle. Sem certificado configurado,
// sendBundle() falha com RNDS_NAO_CONFIGURADO (fluxo local segue normal).
//
// Credenciamento (Secretaria): servicos-datasus.saude.gov.br (login Gov.br +
// e-CNPJ + CNES). Homologação: https://ehr-services.hmg.saude.gov.br/api/
// Produção PE: https://pe-ehr-services.saude.gov.br/api/
// ==========================================================================
const fs = require('fs');
const https = require('https');

const FHIR_VERSION = '4.0.1';
const SYS_CNS = 'http://www.saude.gov.br/fhir/r4/NamingSystem/CNS';
const SYS_CNES = 'http://www.saude.gov.br/fhir/r4/NamingSystem/CNES';
const SYS_CPF = 'http://www.saude.gov.br/fhir/r4/NamingSystem/CPF';

function rndsConfig() {
  const env = (process.env.RNDS_ENV || 'homologacao').toLowerCase();
  const uf = (process.env.RNDS_UF || 'pe').toLowerCase();
  const base = env === 'producao'
    ? `https://${uf}-ehr-services.saude.gov.br/api/`
    : 'https://ehr-services.hmg.saude.gov.br/api/';
  const authBase = env === 'producao'
    ? 'https://ehr-auth.saude.gov.br/api/'
    : 'https://ehr-auth-hmg.saude.gov.br/api/';
  return {
    env, uf, base, authBase,
    pfxPath: process.env.RNDS_CERT_PFX_PATH || null,
    pfxPass: process.env.RNDS_CERT_PASS || null,
    configured: !!(process.env.RNDS_CERT_PFX_PATH && process.env.RNDS_CERT_PASS),
  };
}

function toFhirDateTime(value) {
  const d = new Date(value);
  if (isNaN(d.getTime())) throw new Error('Data inválida para FHIR: ' + value);
  return d.toISOString();
}

// Patient mínimo RNDS: identifier CNS (obrigatório) + CPF + nome + nascimento.
function buildPatient(user) {
  if (!user.cns) throw new Error('RNDS exige CNS do paciente.');
  const identifiers = [
    { system: SYS_CNS, value: String(user.cns) },
  ];
  if (user.cpf) identifiers.push({ system: SYS_CPF, value: String(user.cpf) });
  return {
    resourceType: 'Patient',
    id: `saude-plus-${user.id}`,
    identifier: identifiers,
    name: [{ text: user.full_name }],
    birthDate: user.birth_date ? String(user.birth_date).slice(0, 10) : undefined,
    gender: user.gender === 'masculino' ? 'male' : user.gender === 'feminino' ? 'female' : 'unknown',
  };
}

function buildOrganization(unit) {
  return {
    resourceType: 'Organization',
    id: `saude-plus-${unit.id}`,
    identifier: unit.cnes_code ? [{ system: SYS_CNES, value: String(unit.cnes_code) }] : [],
    name: unit.name,
  };
}

function buildPractitioner(professional) {
  return {
    resourceType: 'Practitioner',
    id: `saude-plus-${professional.id}`,
    name: [{ text: professional.name }],
    qualification: professional.registry ? [{ code: { text: professional.registry } }] : [],
  };
}

// RAC simplificado: Encounter (atendimento) + Condition (motivo/especialidade).
function buildEncounter({ appointment, patientRef, orgRef, practRef }) {
  return {
    resourceType: 'Encounter',
    status: 'planned',
    class: { code: 'AMB', display: 'ambulatory' },
    subject: { reference: patientRef },
    participant: practRef ? [{ individual: { reference: practRef } }] : [],
    serviceProvider: orgRef ? { reference: orgRef } : undefined,
    appointmentRef: appointment.id,
    period: { start: toFhirDateTime(appointment.scheduled_at) },
    reasonCode: [{ text: appointment.specialty || appointment.exam_type || 'Atendimento' }],
  };
}

// Bundle de Registro de Atendimento Clínico (consulta ou exame agendado).
function buildRACBundle({ appointment, patient, professional = null, unit = null }) {
  const patientRes = buildPatient(patient);
  const entries = [{ resource: patientRes }];
  let orgRef; let practRef;
  if (unit) {
    const org = buildOrganization(unit);
    entries.push({ resource: org });
    orgRef = `Organization/${org.id}`;
  }
  if (professional) {
    const pract = buildPractitioner(professional);
    entries.push({ resource: pract });
    practRef = `Practitioner/${pract.id}`;
  }
  entries.push({
    resource: buildEncounter({
      appointment, patientRef: `Patient/${patientRes.id}`, orgRef, practRef,
    }),
  });
  return {
    resourceType: 'Bundle',
    type: 'transaction',
    timestamp: new Date().toISOString(),
    entry: entries.map((e) => ({ resource: e.resource, request: { method: 'POST', url: e.resource.resourceType } })),
  };
}

// Validação estrutural offline (não substitui o validador DATASUS).
function validateBundle(bundle) {
  const errors = [];
  if (!bundle || bundle.resourceType !== 'Bundle') errors.push('root deve ser Bundle');
  if (bundle && bundle.type !== 'transaction' && bundle.type !== 'document') errors.push('Bundle.type deve ser transaction/document');
  const entries = (bundle && bundle.entry) || [];
  if (!entries.length) errors.push('Bundle sem entries');
  const types = entries.map((e) => e.resource && e.resource.resourceType);
  if (!types.includes('Patient')) errors.push('falta Patient');
  entries.forEach((e, i) => {
    if (!e.resource || !e.resource.resourceType) errors.push(`entry[${i}] sem resourceType`);
    if (!e.request || e.request.method !== 'POST') errors.push(`entry[${i}] sem request POST`);
  });
  const patient = entries.map((e) => e.resource).find((r) => r && r.resourceType === 'Patient');
  if (patient) {
    const ids = patient.identifier || [];
    if (!ids.some((id) => id.system === SYS_CNS && id.value)) errors.push('Patient sem identifier CNS');
    if (!patient.name || !patient.name[0] || !patient.name[0].text) errors.push('Patient sem nome');
  }
  return { ok: errors.length === 0, errors };
}

async function fetchAccessToken(cfg = rndsConfig()) {
  if (!cfg.configured) {
    const err = new Error('RNDS não configurado: defina RNDS_CERT_PFX_PATH e RNDS_CERT_PASS.');
    err.code = 'RNDS_NAO_CONFIGURADO';
    err.status = 501;
    throw err;
  }
  const agent = new https.Agent({
    pfx: fs.readFileSync(cfg.pfxPath),
    passphrase: cfg.pfxPass,
  });
  const res = await fetch(cfg.authBase + 'token', { method: 'POST', agent, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`EHR Auth retornou ${res.status}`);
  const body = await res.json();
  if (!body.access_token) throw new Error('EHR Auth sem access_token.');
  return body.access_token;
}

async function sendBundle(bundle, { token = null, cfg = rndsConfig() } = {}) {
  const check = validateBundle(bundle);
  if (!check.ok) {
    const err = new Error('Bundle inválido: ' + check.errors.join('; '));
    err.code = 'RNDS_BUNDLE_INVALIDO';
    throw err;
  }
  const accessToken = token || await fetchAccessToken(cfg);
  const agent = cfg.configured
    ? new https.Agent({ pfx: fs.readFileSync(cfg.pfxPath), passphrase: cfg.pfxPass })
    : undefined;
  const res = await fetch(cfg.base + 'fhir/r4/Bundle', {
    method: 'POST', agent,
    headers: { 'Content-Type': 'application/fhir+json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(bundle),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`RNDS retornou ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json().catch(() => ({ ok: true }));
}

module.exports = {
  FHIR_VERSION, SYS_CNS, SYS_CNES, SYS_CPF,
  rndsConfig, buildPatient, buildOrganization, buildPractitioner,
  buildEncounter, buildRACBundle, validateBundle, fetchAccessToken, sendBundle,
};
