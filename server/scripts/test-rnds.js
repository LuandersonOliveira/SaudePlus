/* ==========================================================================
   Saúde+ — Teste offline da camada RNDS (Fase 2.5)
   Roda: node scripts/test-rnds.js   (sem rede, sem certificado)
   Valida builders FHIR + validador estrutural com fixtures.
   ========================================================================== */
const {
  buildRACBundle, validateBundle, buildPatient, rndsConfig,
} = require('../src/services/rnds');

let failures = 0;
function check(name, cond, extra) {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' -> ' + extra : ''));
  if (!cond) failures++;
}

const patient = {
  id: '11111111-1111-1111-1111-111111111111',
  full_name: 'Maria Teste', cns: '898001234567891', cpf: '52998224725',
  birth_date: '1990-05-01', gender: 'feminino',
};
const unit = { id: '22222222-2222-2222-2222-222222222222', name: 'UBS Centro', cnes_code: '2712555' };
const professional = { id: '33333333-3333-3333-3333-333333333333', name: 'Dra. Ana', registry: 'CRM-PE 12345' };
const appointment = {
  id: '44444444-4444-4444-4444-444444444444',
  specialty: 'Clínica geral', scheduled_at: '2026-11-01 09:00:00',
};

const bundle = buildRACBundle({ appointment, patient, professional, unit });
check('bundle RAC tem 4 entries', bundle.entry.length === 4, bundle.entry.length);
check('bundle passa na validação', validateBundle(bundle).ok, JSON.stringify(validateBundle(bundle).errors));

const minimal = buildRACBundle({ appointment, patient });
check('bundle mínimo (só Patient+Encounter) válido', validateBundle(minimal).ok);

let semCns = false;
try { buildPatient({ ...patient, cns: null }); } catch (e) { semCns = /CNS/.test(e.message); }
check('sem CNS bloqueia na origem', semCns);

const bad = validateBundle({ resourceType: 'Bundle', type: 'transaction', entry: [] });
check('bundle vazio é inválido', !bad.ok && bad.errors.length > 0);

const cfg = rndsConfig();
check('default homologação PE', cfg.base.includes('hmg') && cfg.env === 'homologacao', cfg.base);
check('sem cert => configured=false', cfg.configured === false);

console.log(failures === 0 ? 'RNDS offline: TUDO VERDE' : 'RNDS offline: ' + failures + ' FALHA(S)');
process.exit(failures === 0 ? 0 : 1);
