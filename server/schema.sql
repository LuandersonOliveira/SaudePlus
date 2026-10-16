-- ==========================================================================
-- Saúde+ — schema MySQL
-- Rode: mysql -u root -p < schema.sql
-- (ou copie/cole no MySQL Workbench / DBeaver)
-- ==========================================================================

CREATE DATABASE IF NOT EXISTS saude CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE saude;

-- Garante charset correto na sessão do cliente MySQL (evita dados corrompidos
-- quando o terminal/cliente está configurado com latin1 em vez de UTF-8)
SET NAMES utf8mb4;

SET CHARACTER SET utf8mb4;

-- ---------------------------------------------------------------------
-- Usuários (paciente comum ou admin do posto/secretaria de saúde)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id CHAR(36) NOT NULL PRIMARY KEY,
    -- Autenticação
    full_name VARCHAR(150) NOT NULL,
    -- Nome social (Portaria nº 1.820/2009) — opcional
    social_name VARCHAR(150) NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM(
        'paciente',
        'atendente',
        'admin'
    ) NOT NULL DEFAULT 'paciente',
    admin_level ENUM(
        'superadmin',
        'gestor',
        'atendimento',
        'alertas'
    ) NULL,
    account_status ENUM(
        'ativo',
        'inativo',
        'pendente'
    ) NOT NULL DEFAULT 'ativo',
    -- Contato
    phone VARCHAR(30) NULL,
    mobile VARCHAR(30) NULL,
    -- Documentos (visíveis apenas para admin — nunca retornados em rotas de
    -- atendente). São TEXT, não VARCHAR: o app guarda o AES-256-GCM em
    -- formato "enc:v1:<iv>:<ct>:<tag>", ~70 caracteres. Com o VARCHAR(14)
    -- original, uma instalação limpa dava ERROR 1406 já no primeiro
    -- cadastro com CPF. Mesma conversão feita por migrate:privacy.
    cpf TEXT NULL,
    rg TEXT NULL,
    -- Cartão Nacional de Saúde — opcional, 15 dígitos (cifrado em repouso)
    cns TEXT NULL,
    -- Perfil pessoal
    birth_date DATE NULL,
    gender ENUM(
        'masculino',
        'feminino',
        'outro',
        'prefiro_nao_informar'
    ) NULL,
    -- Prioridade legal de atendimento (Lei 10.048/2000)
    priority ENUM(
        'nenhuma',
        'idoso',
        'gestante',
        'pcd',
        'lactante'
    ) NULL,
    -- Cor/raça por autodeclaração (IBGE / Ministério da Saúde)
    race ENUM(
        'branca',
        'preta',
        'parda',
        'amarela',
        'indigena',
        'nao_informar'
    ) NULL,
    blood_type ENUM(
        'A+',
        'A-',
        'B+',
        'B-',
        'AB+',
        'AB-',
        'O+',
        'O-'
    ) NULL,
    mother_name VARCHAR(150) NULL,
    father_name VARCHAR(150) NULL,
    -- Responsável legal — obrigatório para menores de 18 anos
    guardian_name VARCHAR(150) NULL,
    -- Endereço
    cep VARCHAR(9) NULL,
    street VARCHAR(180) NULL,
    address_number VARCHAR(10) NULL,
    neighborhood VARCHAR(100) NULL,
    city VARCHAR(100) NULL,
    state CHAR(2) NULL,
    zone ENUM('urbana', 'rural') NULL,
    reference_point VARCHAR(255) NULL,
    -- Atendente apenas
    job_role VARCHAR(100) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_login_at DATETIME NULL,
    -- Fase 1 (LGPD): consentimento e apagamento. Criadas por migrate-privacy,
    -- replicadas aqui para que a instalação limpa não quebre no primeiro
    -- signup com "Unknown column 'privacy_version'".
    privacy_version VARCHAR(20) NULL,
    consent_at DATETIME NULL,
    consent_ip VARCHAR(45) NULL,
    deleted_at DATETIME NULL,
    -- Fase 2: vínculo com o Login Único Gov.br (migrate-interop).
    govbr_sub VARCHAR(64) NULL,
    -- Aulas 1/6: segundo fator TOTP (migrate-audit).
    -- totp_enabled ausente = `if (user.totp_enabled)` lê undefined e o login
    -- NUNCA pede o segundo fator, sem erro em lugar nenhum. É o motivo de
    -- migrate:interop estar na sequência do README.
    totp_secret TEXT NULL,
    totp_enabled TINYINT(1) NOT NULL DEFAULT 0
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------
-- Refresh tokens rotativos (Fase 0, item 0.3) — guarda-se só o SHA-256.
-- Detecta roubo por reuso: apresentar um token já rotacionado revoga a
-- família inteira. Criada por migrate-security.
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
-- Consultas médicas agendadas pelo usuário
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appointments (
    id CHAR(36) NOT NULL PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    specialty VARCHAR(120) NOT NULL,
    doctor VARCHAR(120) NULL,
    location VARCHAR(180) NOT NULL,
    unit_id CHAR(36) NULL,
    professional_id CHAR(36) NULL,
    scheduled_at DATETIME NOT NULL,
    notes TEXT NULL,
    status ENUM(
        'pendente',
        'confirmado',
        'cancelado',
        'concluido'
    ) NOT NULL DEFAULT 'pendente',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_appointments_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    INDEX idx_appointments_user (user_id),
    INDEX idx_appointments_scheduled (scheduled_at)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------
-- Lembretes do usuário (consultas, exames, avisos, etc.)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reminders (
    id CHAR(36) NOT NULL PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    title VARCHAR(150) NOT NULL,
    message VARCHAR(255) NULL,
    remind_at DATETIME NOT NULL,
    `read` TINYINT(1) NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_reminders_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    INDEX idx_reminders_user (user_id)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------
-- Alertas de doenças por região (gerenciado pelo admin)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS diseases (
    id CHAR(36) NOT NULL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    region VARCHAR(150) NULL,
    alert_level ENUM('baixo', 'medio', 'alto') NOT NULL DEFAULT 'baixo',
    description TEXT NULL,
    -- Fase 2 (migrate-interop): distingue alerta digitado pelo gestor de um
    -- importado do InfoDengue. O sync só atualiza linhas source='infodengue',
    -- então a coluna é o que impede sobrescrever o que a unidade cadastrou.
    source VARCHAR(20) NOT NULL DEFAULT 'manual',
    external_ref VARCHAR(120) NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_diseases_source (source)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------
-- Exames (laboratoriais, imagem, etc.) — separado de consultas
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exams (
    id CHAR(36) NOT NULL PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    exam_type VARCHAR(60) NOT NULL,
    location VARCHAR(180) NOT NULL,
    unit_id CHAR(36) NULL,
    professional_id CHAR(36) NULL,
    scheduled_at DATETIME NOT NULL,
    notes TEXT NULL,
    status ENUM(
        'pendente',
        'confirmado',
        'cancelado',
        'concluido'
    ) NOT NULL DEFAULT 'pendente',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_exams_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    INDEX idx_exams_user (user_id),
    INDEX idx_exams_scheduled (scheduled_at)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------
-- Unidades de saúde — catálogo real (fonte: CNES, via ubs.med.br) usado
-- para popular o seletor de "Local" em consultas/exames. Telefones e
-- horários não foram confirmados na fonte pública; valide antes de
-- divulgar oficialmente.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS health_units (
    id CHAR(36) NOT NULL PRIMARY KEY,
    name VARCHAR(180) NOT NULL,
    type ENUM(
        'ubs',
        'hospital',
        'clinica',
        'caps',
        'outro'
    ) NOT NULL DEFAULT 'ubs',
    neighborhood VARCHAR(120) NULL,
    -- Fase 2 (migrate-interop): cnes_code é a chave do sync com o CNES e
    -- precisa ser único; sem ele, `npm run sync:cnes` aborta e a rede não
    -- sincroniza. phone e address vêm da mesma origem.
    cnes_code VARCHAR(10) NULL,
    phone VARCHAR(30) NULL,
    address VARCHAR(255) NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_health_units_cnes UNIQUE (cnes_code)
) ENGINE = InnoDB;

-- Seed das 10 unidades de saúde de Lagoa de Itaenga.
-- Os ids são FIXOS de propósito: com UUID() a PRIMARY KEY nunca colidia e o
-- INSERT IGNORE inseria as 10 unidades de novo a cada execução — três
-- rodadas de `npm run db:setup` deixavam 30 unidades com nome repetido.
-- Com id estável, o IGNORE colide e o seed é idempotente.
INSERT IGNORE INTO
    health_units (id, name, type, neighborhood)
VALUES (
        '5a0e1b12-0001-4a10-9c01-000000000001',
        'Posto de Saúde da Família José Cavalcanti de Petribu',
        'ubs',
        'Zona Rural'
    ),
    (
        '5a0e1b12-0002-4a10-9c01-000000000002',
        'Posto de Saúde da Família Progresso',
        'ubs',
        'Centro'
    ),
    (
        '5a0e1b12-0003-4a10-9c01-000000000003',
        'Posto de Saúde da Família Manoel Hermínio',
        'ubs',
        'Saudade'
    ),
    (
        '5a0e1b12-0004-4a10-9c01-000000000004',
        'Posto de Saúde da Família Boa Esperança',
        'ubs',
        'Vila Boa Esperança'
    ),
    (
        '5a0e1b12-0005-4a10-9c01-000000000005',
        'Posto de Saúde da Família Nova Itaenga',
        'ubs',
        'Nova Itaenga'
    ),
    (
        '5a0e1b12-0006-4a10-9c01-000000000006',
        'Posto de Saúde da Família Salinas',
        'ubs',
        'Salinas'
    ),
    (
        '5a0e1b12-0007-4a10-9c01-000000000007',
        'Posto de Saúde da Família Moinho',
        'ubs',
        'Moinho'
    ),
    (
        '5a0e1b12-0008-4a10-9c01-000000000008',
        'Casa de Saúde e Maternidade Josefa Cavalcanti de Petribu',
        'hospital',
        'Centro'
    ),
    (
        '5a0e1b12-0009-4a10-9c01-000000000009',
        'Policlínica Saúde São Sebastião',
        'clinica',
        'Centro'
    ),
    (
        '5a0e1b12-000a-4a10-9c01-00000000000a',
        'CAPS Flor da Pedra',
        'caps',
        'Vila Boa Esperança'
    );

-- ---------------------------------------------------------------------
-- Log de auditoria — registra ações administrativas (confirmar, cancelar,
-- reagendar, gerenciar alertas) para rastreabilidade.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
    id CHAR(36) NOT NULL PRIMARY KEY,
    actor_id CHAR(36) NOT NULL,
    action VARCHAR(50) NOT NULL,
    entity_type VARCHAR(30) NOT NULL,
    entity_id CHAR(36) NOT NULL,
    -- details é TEXT, não VARCHAR(255): o sanitizeDetails() (utils/audit.js)
-- aceita até 1000 caracteres e os motivos de status/justificativas são
-- concatenados sem teto pelas rotas de admin. Com a coluna curta, uma
-- justificativa longa produzia ER_DATA_TOO_LONG, o erro era engolido e a
-- ação acontecia SEM registro — o oposto do que a auditoria deve garantir.
-- Migration equivalente para bancos já existentes: migrate:audit:details.
    details TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Aulas 1/6: trilha encadeada à prova de adulteração. prev_hash aponta
    -- para a linha anterior e entry_hash cobre o conteúdo junto com ela;
    -- qualquer alteração ou remoção quebra a cadeia, verificável em
    -- GET /admin/audit-log/verify. Criadas por migrate-audit.
    prev_hash CHAR(64) NULL,
    entry_hash CHAR(64) NULL,
    seq BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    CONSTRAINT fk_audit_actor FOREIGN KEY (actor_id) REFERENCES users (id) ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT uq_audit_seq UNIQUE (seq),
    INDEX idx_audit_entity (entity_type, entity_id),
    INDEX idx_audit_created (created_at)
) ENGINE = InnoDB;

-- ---------------------------------------------------------------------
-- Agenda inteligente (V3) — profissionais vinculados às unidades,
-- especialidades/tipos de exame oferecidos, horários de atendimento e
-- bloqueios de agenda. Alimenta os seletores dependentes do paciente e
-- as regras de disponibilidade validadas no servidor.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS professionals (
    id CHAR(36) NOT NULL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    job_title VARCHAR(100) NULL,
    registry VARCHAR(40) NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE = InnoDB;

-- O que cada UNIDADE oferece (especialidade de consulta ou tipo de exame)
CREATE TABLE IF NOT EXISTS unit_offers (
    id CHAR(36) NOT NULL PRIMARY KEY,
    unit_id CHAR(36) NOT NULL,
    kind ENUM('consulta', 'exame') NOT NULL,
    name VARCHAR(120) NOT NULL,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_unit_offers_unit FOREIGN KEY (unit_id) REFERENCES health_units (id) ON DELETE CASCADE,
    UNIQUE KEY uq_unit_offer (unit_id, kind, name)
) ENGINE = InnoDB;

-- O que cada PROFISSIONAL atende, por unidade e tipo
CREATE TABLE IF NOT EXISTS professional_offers (
    id CHAR(36) NOT NULL PRIMARY KEY,
    professional_id CHAR(36) NOT NULL,
    unit_id CHAR(36) NOT NULL,
    kind ENUM('consulta', 'exame') NOT NULL,
    name VARCHAR(120) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_prof_offers_prof FOREIGN KEY (professional_id) REFERENCES professionals (id) ON DELETE CASCADE,
    CONSTRAINT fk_prof_offers_unit FOREIGN KEY (unit_id) REFERENCES health_units (id) ON DELETE CASCADE,
    UNIQUE KEY uq_prof_offer (professional_id, unit_id, kind, name)
) ENGINE = InnoDB;

-- Dias/horários de atendimento do profissional na unidade
-- weekday: 0 = domingo ... 6 = sábado
CREATE TABLE IF NOT EXISTS work_schedules (
    id CHAR(36) NOT NULL PRIMARY KEY,
    professional_id CHAR(36) NOT NULL,
    unit_id CHAR(36) NOT NULL,
    weekday TINYINT NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    slot_minutes INT NOT NULL DEFAULT 30,
    active TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_sched_prof FOREIGN KEY (professional_id) REFERENCES professionals (id) ON DELETE CASCADE,
    CONSTRAINT fk_sched_unit FOREIGN KEY (unit_id) REFERENCES health_units (id) ON DELETE CASCADE,
    UNIQUE KEY uq_sched (professional_id, unit_id, weekday, start_time)
) ENGINE = InnoDB;

-- Folgas, intervalos e bloqueios pontuais de agenda
CREATE TABLE IF NOT EXISTS schedule_blocks (
    id CHAR(36) NOT NULL PRIMARY KEY,
    professional_id CHAR(36) NOT NULL,
    unit_id CHAR(36) NOT NULL,
    starts_at DATETIME NOT NULL,
    ends_at DATETIME NOT NULL,
    reason VARCHAR(255) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_block_prof FOREIGN KEY (professional_id) REFERENCES professionals (id) ON DELETE CASCADE,
    CONSTRAINT fk_block_unit FOREIGN KEY (unit_id) REFERENCES health_units (id) ON DELETE CASCADE,
    INDEX idx_block_prof (professional_id, starts_at, ends_at)
) ENGINE = InnoDB;