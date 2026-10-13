/* ==========================================================================
   Saúde+ — Permissões de nível administrativo (Fase 3, item 2)

   Mapa único nível -> capacidades. requireCapability é middleware puro:
   os controladores só declaram qual capacidade exigem.
   middleware/auth.js re-exporta para compatibilidade.
   ========================================================================== */
const LEVEL_PERMISSIONS = {
  superadmin: ['users', 'appointments', 'diseases', 'units', 'audit', 'reports'],
  gestor: ['users', 'appointments', 'diseases', 'units', 'audit', 'reports'],
  atendimento: ['appointments'],
  alertas: ['diseases'],
};

function requireCapability(capability) {
  return (req, res, next) => {
    const level = req.user && req.user.admin_level;
    const allowed = LEVEL_PERMISSIONS[level || 'gestor'] || [];
    if (req.user && req.user.role === 'admin' && allowed.includes(capability)) return next();
    return res.status(403).json({ error: 'Seu nível administrativo não permite esta operação.' });
  };
}

module.exports = { LEVEL_PERMISSIONS, requireCapability };
