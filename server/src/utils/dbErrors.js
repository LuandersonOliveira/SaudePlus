/**
 * Erros de banco que viram resposta HTTP previsível.
 *
 * B2 (RFC-0001): `UNIQUE (professional_id, active_slot)` é a segunda barreira
 * contra dois atendimentos ativos do mesmo profissional no mesmo instante. A
 * primeira (SELECT … FOR UPDATE + validação em utils/booking.js) responde 409
 * "horário ocupado"; esta cobre qualquer caminho de escrita que a esqueça e
 * devolve a MESMA resposta.
 */
const MENSAGEM_HORARIO_OCUPADO = 'Horário já ocupado. Escolha outro horário.';

/** O erro é a violação do UNIQUE de horário (consulta ou exame)? */
function ehHorarioOcupado(err) {
  return Boolean(err)
    && (err.code === 'ER_DUP_ENTRY' || err.errno === 1062)
    && /uq_(appointments|exams)_prof_active_slot/.test(String(err.message));
}

module.exports = { ehHorarioOcupado, MENSAGEM_HORARIO_OCUPADO };
