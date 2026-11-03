/* ==========================================================================
   Saúde+ — origens aceitas pela API (CORS e defesa de CSRF do cookie de refresh).

   O navegador manda o cabeçalho `Origin` em toda requisição que muda estado
   (POST, PUT, PATCH, DELETE), inclusive quando o front e a API são a MESMA origem
   (Express servindo `web/dist`, ADR-0002). Uma origem é aceita quando:

     - não há `Origin` (curl, scripts, sondas de saúde: não são navegador); ou
     - está na lista `CORS_ORIGIN` (vírgula separa várias; padrão `http://localhost:8080`); ou
     - tem o MESMO host da requisição: é a origem única, sem precisar listá-la.

   Antes só valiam as duas primeiras, e em produção com origem única todo POST do
   navegador voltava 403 a menos que `CORS_ORIGIN` repetisse o endereço do próprio site.

   Esta checagem vale para a API inteira (é o `cors` do app), então `POST /auth/refresh` e
   `POST /auth/logout` já recusam `Origin` de outro site: com o cookie `SameSite=Lax`, é a
   defesa de CSRF do refresh (ADR-0011).
   ========================================================================== */

const MENSAGEM_ORIGEM = 'Origem não permitida pelo CORS.';

function origensPermitidas() {
  const raw = (process.env.CORS_ORIGIN || 'http://localhost:8080').trim();
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

/** @param {string|undefined} origin cabeçalho Origin  @param {string|undefined} host cabeçalho Host da requisição */
function origemPermitida(origin, host) {
  if (!origin) return true;
  if (origensPermitidas().includes(origin)) return true;
  try {
    return Boolean(host) && new URL(origin).host === host;
  } catch {
    return false; // "null" e valores malformados
  }
}

/** Opções por requisição para o pacote `cors`: precisam do Host, que só a requisição tem. */
function corsPorRequisicao(req, callback) {
  if (origemPermitida(req.get('origin'), req.get('host'))) return callback(null, { origin: true });
  return callback(new Error(MENSAGEM_ORIGEM));
}

module.exports = { MENSAGEM_ORIGEM, origensPermitidas, origemPermitida, corsPorRequisicao };
