// ==========================================================================
// Saúde+ — Criptografia em coluna (Fase 1, LGPD art. 46)
// CPF/RG/CNS são dados sensíveis (art. 11) e NÃO ficam em texto puro no MySQL.
// AES-256-GCM com chave de 32 bytes em DATA_ENCRYPTION_KEY (hex, 64 chars).
// Formato: enc:v1:<iv-b64>:<ct-b64>:<tag-b64>  (idempotente e detectável)
// Em produção a chave deve vir de KMS/Vault, nunca commitada.
// ==========================================================================
const crypto = require('crypto');

const PREFIX = 'enc:v1:';
let warnedMissingKey = false;

function getKey() {
  const hex = (process.env.DATA_ENCRYPTION_KEY || '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    if (!warnedMissingKey) {
      warnedMissingKey = true;
      console.warn(
        'DATA_ENCRYPTION_KEY ausente/inválida: documentos serão gravados EM TEXTO PURO. ' +
        'Gere com: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
      );
    }
    return null;
  }
  return Buffer.from(hex, 'hex');
}

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

// Cifra um campo; null/vazio -> null; já cifrado -> devolve como está.
function encryptField(value) {
  if (value === null || value === undefined || String(value) === '') return null;
  const text = String(value);
  if (isEncrypted(text)) return text;
  const key = getKey();
  if (!key) return text; // dev sem chave: plaintext + warn (nunca em produção)
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}:${ct.toString('base64')}:${tag.toString('base64')}`;
}

// Decifra; valor legado sem prefixo -> devolve como está (janela de migração).
function decryptField(value) {
  if (value === null || value === undefined) return null;
  const text = String(value);
  if (!isEncrypted(text)) return text;
  const key = getKey();
  if (!key) throw new Error('DATA_ENCRYPTION_KEY necessária para ler documentos cifrados.');
  const [ivB64, ctB64, tagB64] = text.slice(PREFIX.length).split(':');
  if (!ivB64 || !ctB64 || !tagB64) throw new Error('Payload cifrado malformado.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]).toString('utf8');
}

module.exports = { encryptField, decryptField, isEncrypted };
