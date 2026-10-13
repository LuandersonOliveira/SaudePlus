-- ==========================================================================
-- Saúde+ — Migração 002: Fase 0 (refresh tokens + audit append-only)
-- Instalação do zero: este arquivo será incorporado ao schema.sql na Fase 1.
-- Por enquanto, rode via: npm run migrate:security
-- Uso:
--   mysql --default-character-set=utf8mb4 -u root -p saude < server/migration_002_security.sql
-- ==========================================================================

SET NAMES utf8mb4;
USE saude;

-- ---------------------------------------------------------------------
-- Refresh tokens com rotação (Fase 0, item 0.3)
-- Guarda apenas o HASH do token (nunca o valor). Cadeia por família:
-- reuso de token já rotacionado => indício de roubo => revoga a família.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id CHAR(36) NOT NULL PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    token_hash CHAR(64) NOT NULL,
    family CHAR(36) NOT NULL,
    expires_at DATETIME NOT NULL,
    revoked TINYINT(1) NOT NULL DEFAULT 0,
    replaced_by CHAR(36) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_refresh_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    INDEX idx_refresh_hash (token_hash),
    INDEX idx_refresh_family (family),
    INDEX idx_refresh_user (user_id)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------
-- audit_log append-only (Fase 0, item 0.6): bloqueia UPDATE e DELETE.
-- Operador/admin da aplicação NÃO deve ter DROP TRIGGER em produção.
-- ---------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_audit_no_update;
DROP TRIGGER IF EXISTS trg_audit_no_delete;

CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_log
FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log é append-only: UPDATE bloqueado.';

CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit_log
FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit_log é append-only: DELETE bloqueado.';
