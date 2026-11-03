/* ==========================================================================
   Saúde+ — lembretes do paciente (leitura e "marcar como lido").

   O que cria os lembretes é o job (jobs/reminders.js). Nada aqui toca em
   `req`/`res`: cada função devolve `{ ok: true, ... }` ou `{ ok: false, status, error }`.
   ========================================================================== */
const pool = require('../db');
const lembretes = require('../repositories/lembretes');

const NAO_ENCONTRADO = 'Lembrete não encontrado.';

const listar = (userId) => lembretes.doUsuario(pool, userId);

/** Idempotente: marcar um lembrete já lido continua sendo sucesso. Lembrete de outro paciente é "não encontrado". */
async function marcarComoLido(userId, id) {
  if (!(await lembretes.existeDoUsuario(pool, userId, id))) {
    return { ok: false, status: 404, error: NAO_ENCONTRADO };
  }
  await lembretes.marcarComoLido(pool, userId, id);
  return { ok: true };
}

module.exports = { listar, marcarComoLido };
