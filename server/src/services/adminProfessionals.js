/* ==========================================================================
   Saúde+ — gestão administrativa de profissionais e agenda
   (TAREFAS V3, itens 4.4 e 4.6; A1 da Fase 6, passo 8c).

   Cadastro, vínculos com serviço (ofertas), horários de atendimento e bloqueios.
   Validação em schemas/adminProfessionals.js; SQL em repositories/profissionais.js.
   Cada função devolve `{ ok: true, ... }` ou `{ ok: false, status, error }` e NÃO toca em
   req/res: a rota responde e registra a auditoria com `entidade`, `id` e `auditoria`.

   Editar o cadastro e DESATIVAR o profissional (que move os atendimentos futuros para a
   fila de remarcação) rodam numa transação só; o aviso por e-mail sai depois do commit.
   ========================================================================== */
const pool = require('../db');
const profissionais = require('../repositories/profissionais');
const atendimentos = require('../repositories/atendimentos');
const avisos = require('./avisosAgenda');
const { registrarEvento } = require('./booking-events');
const { emTransacao } = require('../utils/transacao');
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
    auditoria: `profissional criado${V.sufixoMotivo(reason)}`,
  };
}

// ---------------------------------------------------------------------------
// Edição e desativação
// ---------------------------------------------------------------------------

const MOTIVO_INATIVADO = 'profissional_inativado';
const TIPOS_DE_ATENDIMENTO = [
  { tabela: 'appointments', kind: 'consulta' },
  { tabela: 'exams', kind: 'exame' },
];

/**
 * Move os atendimentos FUTUROS e ativos do profissional para "Para remarcar", registrando o
 * evento operacional de cada um. Devolve os registros afetados (id, user_id, scheduled_at).
 */
async function moverAtendimentosParaRemarcar(conn, professionalId, actorUserId) {
  const afetados = [];
  for (const { tabela, kind } of TIPOS_DE_ATENDIMENTO) {
    const futuros = await atendimentos.futurosAtivosDoProfissional(conn, tabela, professionalId);
    for (const rec of futuros) {
      await atendimentos.moverParaRemarcar(conn, tabela, rec.id, MOTIVO_INATIVADO);
      await registrarEvento(conn, {
        kind,
        bookingId: rec.id,
        eventType: 'professional_deactivated',
        fromScheduledAt: rec.scheduled_at,
        toScheduledAt: rec.scheduled_at,
        fromProfessionalId: professionalId,
        toProfessionalId: professionalId,
        reason: MOTIVO_INATIVADO,
        actorUserId,
      });
    }
    afetados.push(...futuros);
  }
  return afetados;
}

/**
 * Edita nome, cargo, registro e/ou ativo. Desativar (1 → 0) manda para a fila de remarcação
 * todo atendimento futuro ativo do profissional. TUDO na mesma transação: ou o cadastro muda e
 * os atendimentos são movidos juntos, ou nada muda.
 *
 * @param {{id: string, body: object, reason: string, actorId: string}} p
 * @returns {Promise<{ok: true, moved: number, userIds: string[], auditoria: string} | {ok: false, status: number, error: string}>}
 *   `userIds`: pacientes a avisar depois do commit (`avisarPacientes`).
 */
async function atualizarProfissional({ id, body, reason, actorId }) {
  const { name, job_title: jobTitle, registry, active } = body || {};

  return emTransacao(pool, async (conn) => {
    const atual = await profissionais.paraEdicao(conn, id, { travar: true });
    if (!atual) return falha(404, PROFISSIONAL_NAO_ENCONTRADO);

    const sets = [];
    const params = [];
    const detalhes = [];

    if (name !== undefined) {
      const v = String(name).trim();
      if (!v) return falha(400, 'Nome do profissional é obrigatório.');
      if (v !== atual.name) { sets.push('name=?'); params.push(v); detalhes.push('nome alterado'); }
    }
    if (jobTitle !== undefined) {
      sets.push('job_title=?'); params.push(jobTitle || null);
      detalhes.push(`cargo -> ${jobTitle || 'não informado'}`);
    }
    if (registry !== undefined) {
      sets.push('registry=?'); params.push(registry || null);
      detalhes.push('registro alterado'); // o número do conselho identifica a pessoa (ADR-0012)
    }

    const desativando = active !== undefined && !Number(active) && Number(atual.active) === 1;
    if (active !== undefined) {
      const v = Number(active) ? 1 : 0;
      if (v !== Number(atual.active)) {
        sets.push('active=?'); params.push(v);
        detalhes.push(v ? 'profissional ativado' : 'profissional desativado');
      }
    }
    if (!sets.length) return falha(400, 'Nada para atualizar.');

    await profissionais.atualizar(conn, id, sets, params);

    let afetados = [];
    if (desativando) {
      afetados = await moverAtendimentosParaRemarcar(conn, id, actorId);
      detalhes.push(`${afetados.length} registro(s) movido(s) para remarcar`);
    }

    return {
      ok: true,
      moved: afetados.length,
      userIds: [...new Set(afetados.map((r) => r.user_id))],
      auditoria: `${detalhes.join('; ')}${V.sufixoMotivo(reason)}`,
    };
  });
}

/**
 * Avisa por e-mail os pacientes cujo atendimento foi para a fila de remarcação.
 * Melhor esforço: roda DEPOIS do commit, e uma falha de envio não desfaz nada nem
 * impede os demais avisos.
 */
async function avisarPacientes(userIds) {
  await avisos.avisarPacientes(userIds, {
    assunto: 'Profissional indisponível - reagendamento',
    texto: (nome) => `Olá ${nome}, seu atendimento foi movido para a fila de remarcação.`,
  });
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
  listar, criarProfissional, atualizarProfissional, avisarPacientes,
  adicionarVinculo, removerVinculo,
  adicionarHorario, removerHorario,
  adicionarBloqueio, removerBloqueio,
};
