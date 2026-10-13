/* ==========================================================================
   Saúde+ — Auditoria isolada em middleware (Fase 3, item 2)

   Os controladores NÃO importam mais logAction nem montam actor_id.
   Duas formas de usar:

   1) req.audit(action, entityType, entityId, details, actorOverride?)
      Chamada direta no ponto onde os dados já existem. O ator sai de
      req.user.id; `actorOverride` existe só para fluxos de login público
      (MFA/Gov.br), onde ainda não há sessão.

   2) audit(action, entityType, getId, getDetails)
      Middleware declarativo: envolve res.json e grava SÓ em resposta 2xx.
      entityType/getId/getDetails aceitam valor fixo ou função
      (req, body) => ... . O id cai para body.id e depois req.params.id.
      Rotas com 204 (sem res.json) usam req.audit() direto.

   Garantias preservadas de utils/audit.js: sanitização, cadeia de hash
   encadeada e "nunca derruba a requisição".
   ========================================================================== */
const { logAction } = require('../utils/audit');

function attachAudit(req, res, next) {
  req.audit = (action, entityType, entityId, details, actorOverride) => {
    const actor = actorOverride != null ? actorOverride : (req.user ? req.user.id : null);
    return logAction(actor, action, entityType, entityId == null ? null : entityId, details);
  };
  next();
}

function resolveSpec(spec, req, body) {
  if (typeof spec === 'function') {
    try {
      return spec(req, body);
    } catch {
      return null;
    }
  }
  return spec;
}

function audit(action, entityType, getId, getDetails) {
  return (req, res, next) => {
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        let id = resolveSpec(getId, req, body);
        if ((id === undefined || id === null || id === '') && body && typeof body === 'object' && body.id) {
          id = body.id;
        }
        if ((id === undefined || id === null || id === '') && req.params && req.params.id != null) {
          id = req.params.id;
        }
        const details = resolveSpec(getDetails, req, body);
        Promise.resolve()
          .then(() => req.audit(action, resolveSpec(entityType, req, body), id, details))
          .catch(() => {});
      }
      return originalJson(body);
    };
    next();
  };
}

module.exports = { attachAudit, audit };
