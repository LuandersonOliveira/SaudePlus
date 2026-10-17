/* ==========================================================================
   Saúde+ — Permissões por nível administrativo (Fase 3, item 2)

   Mapa único nível -> capacidades. requireCapability é middleware puro:
   os controladores só declaram qual capacidade exigem.
   middleware/auth.js re-exporta para compatibilidade.

   Duas garantias que este arquivo precisa manter:

   1. FALHA FECHADA. Nível ausente ou desconhecido é NEGADO. Antes o código
      fazia `LEVEL_PERMISSIONS[level || 'gestor']`, então um admin com
      admin_level NULL — criado na mão, por um seed, ou anterior à migration
      que criou a coluna — recebia TODAS as capacidades, porque o pacote do
      gestor é completo. Não existe negação por padrão aqui.

   2. A HIERARQUIA PRECISA EXISTIR. 'admins' (alterar o nível de outro
      admin) é exclusiva do superadmin. Sem ela, superadmin e gestor são
      idênticos e o nível mais alto do sistema não concede nada.
   ========================================================================== */
const LEVEL_PERMISSIONS = {
  superadmin: ['users', 'appointments', 'diseases', 'units', 'audit', 'reports', 'admins'],
  gestor: ['users', 'appointments', 'diseases', 'units', 'audit', 'reports'],
  atendimento: ['appointments'],
  alertas: ['diseases'],
};

const NEGADO = 'Seu nível administrativo não permite esta operação.';

/**
 * O usuário tem esta capability?
 *
 * Fail-closed: sem sessão, papel errado, ou nível ausente/desconhecido, não.
 * Antes o middleware fazia `LEVEL_PERMISSIONS[level || 'gestor']`, então um
 * admin com admin_level NULL recebia TODAS as capabilities.
 */
function pode(capability, user) {
  if (!user || user.role !== 'admin') return false;
  const allowed = LEVEL_PERMISSIONS[user.admin_level];
  return Array.isArray(allowed) && allowed.includes(capability);
}

function requireCapability(capability) {
  return (req, res, next) => {
    // A mensagem é única de propósito — distinguir "não há sessão" de "nível
    // inválido" daria um mapa do modelo de permissões para quem está sondando.
    if (!pode(capability, req && req.user)) return res.status(403).json({ error: NEGADO });
    return next();
  };
}

module.exports = { LEVEL_PERMISSIONS, requireCapability, pode };