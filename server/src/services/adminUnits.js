/* ==========================================================================
   Saúde+ — gestão administrativa de unidades de saúde (item 2.6 da Fase 8, E-17).

   Hoje cobre a EDIÇÃO (`PATCH /health-units/:id`); o resto das rotas de unidade sai da rota na onda 3.

   DESATIVAR uma unidade (active 1 -> 0) faz, numa transação só e como a desativação de profissional:
     - atendimentos FUTUROS e ATIVOS (pendente/confirmado) da unidade vão para "para remarcar", com o
       motivo `unidade_inativada` e um evento `status_changed` por atendimento (autor = quem desativou);
     - entradas ATIVAS da fila presas à unidade viram `cancelado` (entrada "qualquer unidade" não é tocada).
   O vínculo `unit_id` dos atendimentos fica (histórico). Reativar não desfaz nada: a decisão de remarcar
   é de quem atende. Os avisos por e-mail saem depois do commit (`avisarAfetados`).

   Nada aqui toca em `req`/`res`: devolve `{ ok: true, ... }` ou `{ ok: false, status, error }`.
   ========================================================================== */
const pool = require('../db');
const unidades = require('../repositories/unidades');
const atendimentos = require('../repositories/atendimentos');
const fila = require('../repositories/fila');
const { registrarEvento } = require('./booking-events');
const { avisarPacientes } = require('./avisosAgenda');
const { emTransacao } = require('../utils/transacao');

const VALID_TYPES = ['ubs', 'hospital', 'clinica', 'caps', 'outro'];
const MOTIVO_INATIVADA = 'unidade_inativada';
const TIPOS_DE_ATENDIMENTO = [
  { tabela: 'appointments', kind: 'consulta' },
  { tabela: 'exams', kind: 'exame' },
];

const falha = (status, error) => ({ ok: false, status, error });

/** Move os atendimentos futuros e ativos da unidade para "para remarcar", com o evento de cada um. */
async function moverAtendimentosParaRemarcar(conn, unitId, actorUserId) {
  const afetados = [];
  for (const { tabela, kind } of TIPOS_DE_ATENDIMENTO) {
    const futuros = await atendimentos.futurosAtivosDaUnidade(conn, tabela, unitId);
    for (const rec of futuros) {
      await atendimentos.moverParaRemarcar(conn, tabela, rec.id, MOTIVO_INATIVADA);
      await registrarEvento(conn, {
        kind,
        bookingId: rec.id,
        eventType: 'status_changed',
        fromScheduledAt: rec.scheduled_at,
        toScheduledAt: rec.scheduled_at,
        fromProfessionalId: rec.professional_id,
        toProfessionalId: rec.professional_id,
        reason: MOTIVO_INATIVADA,
        actorUserId,
      });
    }
    afetados.push(...futuros);
  }
  return afetados;
}

/**
 * Edita nome, tipo, bairro e/ou `active`. Mensagens de validação e a ordem das checagens são as da rota
 * original.
 *
 * @param {{id: string, body: object, actorId: string}} p
 * @returns {Promise<{ok: true, moved: number, waitlistCanceled: number, avisar: {movidos: string[], fila: string[]}, auditoria: string}
 *   | {ok: false, status: number, error: string}>}
 */
async function atualizarUnidade({ id, body, actorId }) {
  const { name, type, neighborhood, active } = body || {};
  const sets = [];
  const params = [];
  const detalhes = [];

  if (name !== undefined) {
    if (!String(name).trim()) return falha(400, 'Nome da unidade é obrigatório.');
    sets.push('name=?'); params.push(String(name).trim()); detalhes.push(`nome -> ${String(name).trim()}`);
  }
  if (type !== undefined) {
    if (!VALID_TYPES.includes(type)) return falha(400, 'Tipo de unidade inválido.');
    sets.push('type=?'); params.push(type); detalhes.push(`tipo -> ${type}`);
  }
  if (neighborhood !== undefined) {
    sets.push('neighborhood=?'); params.push(neighborhood || null); detalhes.push(`bairro -> ${neighborhood || 'não informado'}`);
  }
  let valorAtivo;
  if (active !== undefined) {
    valorAtivo = Number(active) ? 1 : 0;
    sets.push('active=?'); params.push(valorAtivo); detalhes.push(valorAtivo ? 'unidade ativada' : 'unidade desativada');
  }
  if (!sets.length) return falha(400, 'Nada para atualizar.');

  return emTransacao(pool, async (conn) => {
    const atual = await unidades.paraEdicao(conn, id, { travar: true });
    if (!atual) return falha(404, 'Unidade não encontrada.');

    await unidades.atualizar(conn, id, sets, params);

    // Só a transição ativa -> inativa move gente: desativar uma unidade que já estava inativa não faz nada.
    const desativando = valorAtivo === 0 && Number(atual.active) === 1;
    let movidos = [];
    let canceladas = [];
    if (desativando) {
      movidos = await moverAtendimentosParaRemarcar(conn, id, actorId);
      canceladas = await fila.cancelarDaUnidade(conn, id);
      detalhes.push(`${movidos.length} atendimento(s) movido(s) para remarcar`);
      detalhes.push(`${canceladas.length} entrada(s) da fila cancelada(s)`);
    }

    return {
      ok: true,
      moved: movidos.length,
      waitlistCanceled: canceladas.length,
      avisar: { movidos: movidos.map((r) => r.user_id), fila: canceladas.map((r) => r.user_id) },
      auditoria: detalhes.join('; '),
    };
  });
}

/** Avisa por e-mail quem teve atendimento movido ou entrada da fila cancelada. Melhor esforço, depois do commit. */
async function avisarAfetados({ movidos, fila: naFila }) {
  await avisarPacientes(movidos, {
    assunto: 'Unidade indisponível - reagendamento',
    texto: (nome) => `Olá ${nome}, a unidade onde seu atendimento estava marcado deixou de atender e o atendimento foi movido para a fila de remarcação. Entre no Saúde+ para escolher um novo horário.`,
  });
  // Quem já recebeu o aviso de remarcação não precisa de um segundo e-mail pela fila.
  const soNaFila = naFila.filter((uid) => !movidos.includes(uid));
  await avisarPacientes(soNaFila, {
    assunto: 'Unidade indisponível - lista de espera',
    texto: (nome) => `Olá ${nome}, a unidade da sua lista de espera deixou de atender e sua entrada foi cancelada. Entre no Saúde+ para entrar na lista de outra unidade.`,
  });
}

module.exports = { atualizarUnidade, avisarAfetados, VALID_TYPES, MOTIVO_INATIVADA };