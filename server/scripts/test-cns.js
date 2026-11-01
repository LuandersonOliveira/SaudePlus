/* ==========================================================================
   Saúde+ — Teste offline da camada CNS WebService (Fase 2.4)
   Roda: node scripts/test-cns.js   (sem rede, sem certificado)
   Valida normalização, dedup e o gate de configuração com fixtures.
   ========================================================================== */
const {
  cnsConfig, normalizeRecord, matchPatient, lookupByCns,
} = require('../src/services/cns');

let failures = 0;
function check(name, cond, extra) {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra ? ' -> ' + extra : ''));
  if (!cond) failures++;
}

const cfg = cnsConfig();
check('sem credencial => configured=false', cfg.configured === false);

const raw = {
  cns: '898 001 234567891', cpf: '529.982.247-25', nome: 'Maria Teste',
  data_nascimento: '1990-05-01', situacao: 'ATIVO',
};
const norm = normalizeRecord(raw);
check('normaliza CNS só com dígitos', norm.cns === '898001234567891', norm.cns);
check('normaliza CPF só com dígitos', norm.cpf === '52998224725', norm.cpf);
check('situação ATIVO => active=true', norm.active === true);
check('normalizeRecord(null) => null', normalizeRecord(null) === null);

const candidates = [
  { id: 'u1', cns: '898001234567891', cpf: '52998224725', birth_date: '1990-05-01' },
  { id: 'u2', cns: null, cpf: '11144477735', birth_date: '1985-01-01' },
];

const byCns = matchPatient({ cns: '898001234567891' }, candidates);
check('casa por CNS', byCns.matchedBy === 'cns' && byCns.user.id === 'u1');

const byCpfBirth = matchPatient({ cpf: '11144477735', birthDate: '1985-01-01' }, candidates);
check('casa por CPF+nascimento quando não há CNS', byCpfBirth.matchedBy === 'cpf_birthdate' && byCpfBirth.user.id === 'u2');

const noMatch = matchPatient({ cns: '000000000000000', cpf: '00000000000', birthDate: '2000-01-01' }, candidates);
check('sem candidato compatível => cadastro manual assistido', noMatch.matchedBy === null && noMatch.user === null && !noMatch.conflict);

const duped = [...candidates, { id: 'u3', cns: '898001234567891', cpf: null, birth_date: null }];
const dup = matchPatient({ cns: '898001234567891' }, duped);
check('CNS em 2 cadastros => conflict=true, nunca resolve sozinho', dup.conflict === true && dup.user === null);

lookupByCns('898001234567891')
  .then(() => { check('lookupByCns sem config deveria ter lançado', false); })
  .catch((e) => { check('lookupByCns sem config => CNS_WS_NAO_CONFIGURADO (501)', e.code === 'CNS_WS_NAO_CONFIGURADO' && e.status === 501, e.code); })
  .finally(() => {
    console.log(failures === 0 ? 'CNS offline: TUDO VERDE' : 'CNS offline: ' + failures + ' FALHA(S)');
    process.exit(failures === 0 ? 0 : 1);
  });
