/* ==========================================================================
   Saúde+ — avisos por e-mail quando a agenda de alguém muda por decisão da administração
   (desativação de profissional, desativação de unidade).

   Melhor esforço, DEPOIS do commit: uma falha de envio não desfaz a mudança e não impede os demais
   avisos. O texto não leva dado de saúde além do que o paciente já sabe (que o atendimento foi movido).
   ========================================================================== */
const usuarios = require('../repositories/usuarios');
const mailer = require('./mailer');

/**
 * @param {string[]} userIds pacientes a avisar (repetidos e vazios são ignorados)
 * @param {{assunto: string, texto: (nome: string) => string}} mensagem
 */
async function avisarPacientes(userIds, { assunto, texto }) {
  const unicos = [...new Set((userIds || []).filter(Boolean))];
  if (!unicos.length) return;
  const pool = require('../db');
  const contatos = await usuarios.contatos(pool, unicos);
  for (const u of contatos) {
    if (!u.email) continue;
    try {
      await mailer.enviar({ para: u.email, assunto, texto: texto(u.full_name || '') });
    } catch (err) { /* melhor esforço */ }
  }
}

module.exports = { avisarPacientes };