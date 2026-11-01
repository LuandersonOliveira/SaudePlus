/* ==========================================================================
   Saúde+ — validação de entrada por esquema Zod (A2 da Fase 6).

   Uso:  router.post('/rota', validate(meuSchema), handler)

   - Valida `req.body` (ou `req.query`/`req.params` com { source }).
   - Falhou: responde com o MESMO formato de erro da API, `{ error: "<primeira
     mensagem>" }`, status 400 (ou o de `{ status }`). A mensagem é a do próprio
     esquema, em português — nunca o texto padrão do Zod em inglês.
   - Passou: guarda o dado já normalizado em `req.valid[source]` e segue. `req.body`
     NÃO é substituído: campos extras e rotas ainda não migradas continuam lendo
     de lá sem surpresa.
   ========================================================================== */
const MENSAGEM_PADRAO = 'Dados inválidos.';

/**
 * @param {import('zod').ZodTypeAny} schema
 * @param {{ source?: 'body'|'query'|'params', status?: number }} [opts]
 */
function validate(schema, { source = 'body', status = 400 } = {}) {
  return function validar(req, res, next) {
    const resultado = schema.safeParse(req[source] === undefined || req[source] === null ? {} : req[source]);
    if (!resultado.success) {
      const primeira = resultado.error.issues[0];
      return res.status(status).json({ error: (primeira && primeira.message) || MENSAGEM_PADRAO });
    }
    req.valid = Object.assign(req.valid || {}, { [source]: resultado.data });
    return next();
  };
}

module.exports = { validate, MENSAGEM_PADRAO };
