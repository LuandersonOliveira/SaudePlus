/* ==========================================================================
   Saúde+ — Criptografia de documentos isolada em middleware (Fase 3, item 2)

   Os controladores NÃO importam mais utils/crypto. req.encryptDoc /
   req.decryptDoc escondem AES-256-GCM + chave (DATA_ENCRYPTION_KEY).
   ========================================================================== */
const { encryptField, decryptField } = require('../utils/crypto');

function attachDocs(req, res, next) {
  req.encryptDoc = (value) => encryptField(value);
  req.decryptDoc = (value) => decryptField(value);
  next();
}

module.exports = { attachDocs };
