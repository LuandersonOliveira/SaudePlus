/* ==========================================================================
   Saúde+ — gestão administrativa de profissionais e agenda
   (TAREFAS V3, itens 4.4 e 4.6; A1 da Fase 6, passo 8c).

   Cadastro, vínculos com serviço (ofertas), horários de atendimento e bloqueios.
   Validação em schemas/adminProfessionals.js; SQL em repositories/profissionais.js.
   Cada função devolve `{ ok: true, ... }` ou `{ ok: false, status, error }` e NÃO toca em
   req/res: a rota responde e registra a auditoria com `entidade`, `id` e `auditoria`.

   (A desativação do profissional — que move atendimentos para a fila de remarcação — é
   o passo 8d.)
   ========================================================================== */
const pool = require('../db');
const profissionais = require('../repositories/profissionais');
const V = require('../schemas/adminProfessionals');

const falha = (status, error) => ({ ok: false, status, error });
const PROFISSIONAL_NAO_ENCONTRADO = 'Profissional não encontrado.';

const listar = () => profissionais.listarTudo(pool);

async function criarProfissional(body, reason) {
  const v = V.validarProfissional(body);
  if (!v.ok) return falha(400, v.error);
  const id = await profissionais.inserir(pool, v.dados);
  return {
    ok: true, id, entidade: 'professional',
    auditoria: `profissional "${v.dados.name}"${V.sufixoMotivo(reason)}`,
  };
}

// ---------------------------------------------------------------------------
// Vínculo profissional ↔ unidade ↔ serviço
// ---------------------------------------------------------------------------

async function adicionarVinculo(professionalId, body, reason) {
  const v = V.validarVinculo(body);
  if (!v.ok) return falha(400, v.error);
  const { unitId, kind, serviceName } = v.dados;

  if (!(await profissionais.existe(pool, professionalId))) return falha(404, PROFISSIONAL_NAO_ENCONTRADO);
  const unidade = await profissionais.unidade(pool, unitId);
  if (!unidade) return falha(404, 'Unidade não encontrada.');

  // Sem IGNORE: a duplicata precisa ser VISÍVEL.
  //
  // `INSERT IGNORE` engolia o ER_DUP_ENTRY e a rota respondia 201 com o id
  // recém-gerado — que nunca existiu. O front mostrava o vínculo na lista e
  // a auditoria registrava "criou vínculo" para nada. Agora a duplicata é um
  // 409 honesto e nada é auditado, porque nada mudou.
  let id;
  try {
    id = await profissionais.inserirOferta(pool, { professionalId, unitId, kind, serviceName });
  } catch (erro) {
    if (erro && erro.code === 'ER_DUP_ENTRY') {
      return falha(409, 'Este vínculo já existe para este profissional nesta unidade.');
    }
    throw erro;
  }
  return {
    ok: true, id, entidade: 'professional_offer',
    auditoria: `vínculo: ${serviceName} (${kind}) em ${unidade.name}${V.sufixoMotivo(reason)}`,
  };
}

async function removerVinculo(professionalId, offerId, reason) {
  const oferta = await profissionais.ofertaDoProfissional(pool, offerId, professionalId);
  if (!oferta) return falha(404, 'Vínculo não encontrado.');
  await profissionais.removerOferta(pool, offerId);
  return {
    ok: true, id: offerId, entidade: 'professional_offer',
    auditoria: `vínculo removido: ${oferta.name} (${oferta.kind}) em ${oferta.unit_name}${V.sufixoMotivo(reason)}`,
  };
}

// ---------------------------------------------------------------------------
// Horários de atendimento
// ---------------------------------------------------------------------------

async function adicionarHorario(professionalId, body, reason) {
  const v = V.validarHorario(body);
  if (!v.ok) return falha(400, v.error);
  const { unitId, weekday, start, end, slot } = v.dados;

  if (!(await profissionais.existe(pool, professionalId))) return falha(404, PROFISSIONAL_NAO_ENCONTRADO);
  const rotulo = await profissionais.rotuloDaUnidade(pool, unitId);

  let id;
  try {
    id = await profissionais.inserirHorario(pool, { professionalId, unitId, weekday, start, end, slot });
  } catch (err) {
    if (err && err.code === 'ER_DUP_ENTRY') return falha(409, 'Este horário já está cadastrado para o profissional.');
    throw err;
  }
  return {
    ok: true, id, entidade: 'work_schedule',
    auditoria: `${V.SEMANA[weekday]} ${start.slice(0, 5)}-${end.slice(0, 5)} (${slot} min) em ${rotulo}${V.sufixoMotivo(reason)}`,
  };
}

async function removerHorario(professionalId, scheduleId, reason) {
  if (!(await profissionais.horarioDoProfissional(pool, scheduleId, professionalId))) {
    return falha(404, 'Horário não encontrado.');
  }
  await profissionais.removerHorario(pool, scheduleId);
  return {
    ok: true, id: scheduleId, entidade: 'work_schedule',
    auditoria: `horário de atendimento removido${V.sufixoMotivo(reason)}`,
  };
}

// ---------------------------------------------------------------------------
// Bloqueios de agenda (folgas, intervalos)
// ---------------------------------------------------------------------------

async function adicionarBloqueio(professionalId, body, reason) {
  const v = V.validarBloqueio(body);
  if (!v.ok) return falha(400, v.error);
  const { unitId, start, end } = v.dados;

  if (!(await profissionais.existe(pool, professionalId))) return falha(404, PROFISSIONAL_NAO_ENCONTRADO);
  const rotulo = await profissionais.rotuloDaUnidade(pool, unitId);

  const id = await profissionais.inserirBloqueio(pool, { professionalId, unitId, start, end, reason });
  return {
    ok: true, id, entidade: 'schedule_block',
    auditoria: `bloqueio de ${start} a ${end} em ${rotulo}${V.sufixoMotivo(reason)}`,
  };
}

async function removerBloqueio(professionalId, blockId, reason) {
  if (!(await profissionais.bloqueioDoProfissional(pool, blockId, professionalId))) {
    return falha(404, 'Bloqueio não encontrado.');
  }
  await profissionais.removerBloqueio(pool, blockId);
  return {
    ok: true, id: blockId, entidade: 'schedule_block',
    auditoria: `bloqueio removido${V.sufixoMotivo(reason)}`,
  };
}

module.exports = {
  listar, criarProfissional,
  adicionarVinculo, removerVinculo,
  adicionarHorario, removerHorario,
  adicionarBloqueio, removerBloqueio,
};
