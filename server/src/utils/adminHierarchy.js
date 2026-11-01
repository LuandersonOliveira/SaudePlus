/* ==========================================================================
   Saúde+ — hierarquia de privilégio entre administradores
   (P0.4; A1 da Fase 6, passo 8a): funções PURAS.

   Antes, cada rota de /admin/users repetia estas comparações no meio do SQL. Aqui
   ficam as DECISÕES, uma por situação, todas com o mesmo formato de retorno:
       null                     → permitido
       { status, error }        → recusado, com o código HTTP e a mensagem da API
   Quem chama aplica a recusa; nada aqui conhece req/res ou banco.

   Regras (as de sempre):
   - Um admin nunca altera, rebaixa nem exclui uma conta administrativa de nível
     IGUAL ou SUPERIOR ao seu (escalonamento lateral).
   - Credenciais de admin (e-mail de login, senha) e níveis só mudam com a
     capability 'admins' (só o superadmin a tem): e-mail novo + "esqueci a senha"
     equivale a assumir a conta.
   - Promover a admin, e definir nível, também exigem 'admins'; ninguém define um
     nível ACIMA do próprio (escalonamento). Definir um nível igual ou abaixo é
     permitido: o superadmin consegue atribuir gestor, atendimento ou alertas.
   - `podeAdmins` é o resultado de `pode('admins', actor)`, passado de fora para
     manter estas funções sem dependência.
   ========================================================================== */

const LEVEL_RANK = { superadmin: 4, gestor: 3, atendimento: 2, alertas: 1 };

const SAFE_ROLES = ['paciente', 'atendente', 'admin'];
const SAFE_STATUSES = ['ativo', 'inativo', 'pendente'];
const SAFE_ADMIN_LEVELS = ['superadmin', 'gestor', 'atendimento', 'alertas'];

// Sem `?? LEVEL_RANK.gestor`: nível ausente não pode virar gestor no cálculo
// de rank — era o mesmo fail-open do middleware, aqui numa segunda forma.
// Um alvo admin sem nível explícito simplesmente não é rebaixável por esta via.
function rankDe(adminLevel) {
  const r = LEVEL_RANK[adminLevel];
  return typeof r === 'number' ? r : 0;
}

function actorRank(user) {
  return rankDe(user && user.admin_level);
}

const recusa = (status, error) => ({ status, error });

/** O ator está acima do alvo? Só importa quando o alvo é admin. */
function atorSuperaAlvo(actor, alvo) {
  return !(alvo && alvo.role === 'admin') || actorRank(actor) > rankDe(alvo.admin_level);
}

/** Alterar dados/status de uma conta: admin de nível igual ou superior é intocável. */
function bloqueioPorHierarquia(actor, alvo) {
  if (atorSuperaAlvo(actor, alvo)) return null;
  return recusa(403, 'Você não pode alterar uma conta de nível administrativo igual ou superior ao seu.');
}

/**
 * Trocar e-mail de login ou senha de um ADMIN exige 'admins'. Só vale quando o e-mail
 * REALMENTE muda: os formulários reenviam o e-mail atual a cada gravação, e isso não
 * pode bloquear a edição de outros campos (celular, cargo…).
 */
function emailMudou(emailInformado, emailAtual) {
  if (emailInformado === undefined) return false;
  return String(emailInformado ?? '').trim().toLowerCase() !== String(emailAtual || '').trim().toLowerCase();
}

function bloqueioDeCredenciais({ alvo, trocaEmail, trocaSenha, podeAdmins }) {
  if (alvo.role === 'admin' && (trocaEmail || trocaSenha) && !podeAdmins) {
    return recusa(403, 'Seu nível administrativo não permite alterar e-mail ou senha de administradores.');
  }
  return null;
}

/**
 * Mudança de papel (já validada como papel conhecido e que não é a própria conta).
 * Promover a admin exige 'admins'; rebaixar um admin exige estar acima dele.
 */
function bloqueioDePapel({ actor, alvo, novoPapel, podeAdmins }) {
  if (novoPapel === 'admin' && alvo.role !== 'admin' && !podeAdmins) {
    return recusa(403, 'Seu nível administrativo não permite criar administradores.');
  }
  if (alvo.role === 'admin' && novoPapel !== 'admin' && !atorSuperaAlvo(actor, alvo)) {
    return recusa(403, 'Você não pode rebaixar um administrador igual ou superior.');
  }
  return null;
}

/** Definir o nível de um admin: capability 'admins', nível conhecido e não ACIMA do próprio. */
function bloqueioDeNivel({ actor, novoNivel, podeAdmins }) {
  if (!podeAdmins) {
    return recusa(403, 'Seu nível administrativo não permite alterar níveis de outros administradores.');
  }
  if (!SAFE_ADMIN_LEVELS.includes(novoNivel)) return recusa(400, 'Nível administrativo inválido.');
  if ((LEVEL_RANK[novoNivel] ?? 0) > actorRank(actor)) {
    return recusa(403, 'Você não pode definir um nível acima do seu.');
  }
  return null;
}

/** Excluir uma conta: admin de nível igual ou superior é intocável. */
function bloqueioDeExclusao(actor, alvo) {
  if (atorSuperaAlvo(actor, alvo)) return null;
  return recusa(403, 'Você não pode excluir um administrador igual ou superior.');
}

/** Criar uma conta já como admin exige 'admins'. */
function bloqueioDeCriacaoDeAdmin(papel, podeAdmins) {
  if (papel === 'admin' && !podeAdmins) return recusa(403, 'Sem permissão para criar administradores.');
  return null;
}

module.exports = {
  LEVEL_RANK,
  SAFE_ROLES,
  SAFE_STATUSES,
  SAFE_ADMIN_LEVELS,
  rankDe,
  actorRank,
  atorSuperaAlvo,
  emailMudou,
  bloqueioPorHierarquia,
  bloqueioDeCredenciais,
  bloqueioDePapel,
  bloqueioDeNivel,
  bloqueioDeExclusao,
  bloqueioDeCriacaoDeAdmin,
};
