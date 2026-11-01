// ==========================================================================
// Saúde+ — CNS WebService / Cadastro Nacional de Usuários do SUS (Fase 2.4)
// Valida o CNS do paciente contra a base oficial do DATASUS e ajuda a
// deduplicar cadastro, seguindo a regra de INTEROPERABILIDADE.md §3.2:
// casar por CNS, senão por CPF+nascimento, senão cadastro manual assistido —
// divergência NUNCA é resolvida por sobrescrita automática.
//
// Protocolo e endpoint reais: definidos no pacote técnico entregue no
// credenciamento DATASUS (servicos-datasus.saude.gov.br, gate G3 de
// INTEROPERABILIDADE.md). Não assumimos contrato antes disso — CNS_WS_BASE_URL
// e CNS_WS_LOOKUP_PATH ficam vazios até a credencial chegar. Sem eles,
// lookupByCns() falha com CNS_WS_NAO_CONFIGURADO (501) e o fluxo local segue
// normal, no mesmo padrão já usado em services/rnds.js e services/govbr.js.
//
// Autenticação: DATASUS costuma exigir certificado ICP-Brasil (mesmo modelo
// do RNDS) — ver cnsConfig() para as variáveis de certificado.
// ==========================================================================
const fs = require('fs');
const https = require('https');
const { isValidCNS, digitsOnly } = require('../utils/validators');

function cnsConfig() {
  return {
    base: process.env.CNS_WS_BASE_URL || null,
    lookupPath: process.env.CNS_WS_LOOKUP_PATH || null,
    pfxPath: process.env.CNS_WS_CERT_PFX_PATH || null,
    pfxPass: process.env.CNS_WS_CERT_PASS || null,
    configured: !!(
      process.env.CNS_WS_BASE_URL
      && process.env.CNS_WS_LOOKUP_PATH
      && process.env.CNS_WS_CERT_PFX_PATH
      && process.env.CNS_WS_CERT_PASS
    ),
  };
}

function notConfigured() {
  const err = new Error(
    'CNS WebService não configurado: defina CNS_WS_BASE_URL, CNS_WS_LOOKUP_PATH, '
    + 'CNS_WS_CERT_PFX_PATH e CNS_WS_CERT_PASS (credenciamento DATASUS).'
  );
  err.code = 'CNS_WS_NAO_CONFIGURADO';
  err.status = 501;
  return err;
}

// Normaliza a resposta do DATASUS (formato ainda não definido antes do
// credenciamento) para o contrato interno mínimo que o restante do app usa.
function normalizeRecord(raw) {
  if (!raw) return null;
  return {
    cns: raw.cns ? digitsOnly(raw.cns) : null,
    cpf: raw.cpf ? digitsOnly(raw.cpf) : null,
    fullName: raw.nome || raw.full_name || null,
    birthDate: raw.data_nascimento || raw.birth_date || null,
    motherName: raw.nome_mae || raw.mother_name || null,
    active: raw.situacao !== 'INATIVO',
  };
}

// Consulta o CNS na base oficial. Valida o formato localmente primeiro
// (checksum DEF-CNS já existente em validators.js) para nunca gastar uma
// chamada de rede com dado obviamente inválido.
async function lookupByCns(cnsValue, { cfg = cnsConfig() } = {}) {
  const cns = digitsOnly(cnsValue);
  if (!isValidCNS(cns)) {
    const err = new Error('CNS com formato ou dígito verificador inválido.');
    err.code = 'CNS_FORMATO_INVALIDO';
    err.status = 400;
    throw err;
  }
  if (!cfg.configured) throw notConfigured();

  const agent = new https.Agent({ pfx: fs.readFileSync(cfg.pfxPath), passphrase: cfg.pfxPass });
  const url = cfg.base.replace(/\/+$/, '') + cfg.lookupPath;
  const res = await fetch(url, {
    method: 'POST',
    agent,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ cns }),
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`CNS WebService retornou ${res.status}: ${text.slice(0, 300)}`);
  }
  const body = await res.json();
  return normalizeRecord(body);
}

// Deduplicação de paciente (INTEROPERABILIDADE.md §3.2):
// 1) casa por CNS se existir;
// 2) senão por CPF + data de nascimento;
// 3) senão null => cadastro manual assistido.
// Mais de um candidato compatível é SEMPRE conflict=true: a função nunca
// escolhe por conta própria, só a fila de revisão humana resolve.
function matchPatient({ cns, cpf, birthDate } = {}, candidates = []) {
  const cnsDigits = cns ? digitsOnly(cns) : null;
  const cpfDigits = cpf ? digitsOnly(cpf) : null;

  if (cnsDigits) {
    const byCns = candidates.filter((c) => c.cns && digitsOnly(c.cns) === cnsDigits);
    if (byCns.length === 1) return { matchedBy: 'cns', user: byCns[0], conflict: false };
    if (byCns.length > 1) return { matchedBy: 'cns', user: null, conflict: true };
  }

  if (cpfDigits && birthDate) {
    const byCpfBirth = candidates.filter(
      (c) => c.cpf && digitsOnly(c.cpf) === cpfDigits
        && String(c.birth_date).slice(0, 10) === String(birthDate).slice(0, 10)
    );
    if (byCpfBirth.length === 1) return { matchedBy: 'cpf_birthdate', user: byCpfBirth[0], conflict: false };
    if (byCpfBirth.length > 1) return { matchedBy: 'cpf_birthdate', user: null, conflict: true };
  }

  return { matchedBy: null, user: null, conflict: false };
}

module.exports = { cnsConfig, notConfigured, normalizeRecord, lookupByCns, matchPatient };
