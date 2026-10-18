/**
 * Normalização das linhas de agregação do painel admin.
 *
 * No MySQL, `SUM()` sobre zero linhas devolve NULL — não 0. Isso não é
 * detalhe: `/admin/stats` mandava `pending: null` para o painel, e o front
 * renderizava "null" (ou "NaN", dependendo da conta) no lugar de um
 * contador. Nenhum teste quebrava porque, com dados no banco, SUM() nunca
 * era NULL — o bug só aparecia em instalação nova, que é justamente onde o
 * painel é observado com mais atenção.
 *
 * Duas defesas: COALESCE no SQL (fonte da verdade) e isto aqui, porque um
 * número quebrado na tela do admin custa mais caro que uma linha a mais.
 */

/**
 * Converte null/undefined em 0 e garante que o resultado é número finito.
 * @param {object} row linha vinda de COUNT/SUM
 * @returns {object} mesma forma, só com números
 */
function normalizeCounts(row) {
  const out = {};
  for (const [chave, valor] of Object.entries(row || {})) {
    out[chave] = Number.isFinite(Number(valor)) ? Number(valor) : 0;
  }
  return out;
}

/**
 * Soma as chaves de várias linhas normalizadas (útil quando a query já vem
 * agregada com GROUP BY).
 */
function somarCounts(linhas) {
  const total = {};
  for (const linha of linhas || []) {
    const normalizada = normalizeCounts(linha);
    for (const [chave, valor] of Object.entries(normalizada)) {
      total[chave] = (total[chave] || 0) + valor;
    }
  }
  return total;
}

module.exports = { normalizeCounts, somarCounts };
