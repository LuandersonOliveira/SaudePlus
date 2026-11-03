/* ==========================================================================
   Saúde+ — gestão administrativa de usuários (A1 da Fase 6, passo 8b).

   Regras de listar, ver, criar, editar e excluir contas. A HIERARQUIA entre
   administradores está em utils/adminHierarchy.js; o SQL em repositories/usuarios.js
   e repositories/profissionais.js; a validação por campo em schemas/adminUsers.js.

   Nada aqui toca em `req`/`res`: cada função devolve `{ ok: true, ... }` ou
   `{ ok: false, status, error }`, e a rota responde e audita.

   ATOMICIDADE (mudança do 8b): editar e criar rodam numa TRANSAÇÃO, e o vínculo com o
   profissional é validado ANTES de qualquer escrita. Antes, o PATCH gravava o usuário e
   derrubava as sessões e só depois recusava um vínculo inválido (400): a conta ficava
   alterada, e a pessoa deslogada, por um pedido que o admin via como "falhou".
   ========================================================================== */
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const pool = require('../db');
const { emTransacao: emTransacaoCom } = require('../utils/transacao');
const H = require('../utils/adminHierarchy');
const usuarios = require('../repositories/usuarios');
const profissionais = require('../repositories/profissionais');
const { anonimizarNaTransacao, registrarEliminacao } = require('../utils/privacy');
const { exigeMfa } = require('./session');
const {
  erroDoNome, erroDaSenha, validarEmail, normalizarTelefone, erroDoTelefone,
} = require('../schemas/adminUsers');

const falha = (status, error) => ({ ok: false, status, error });
const NAO_ENCONTRADO = 'Usuário não encontrado.';
const PROFISSIONAL_INVALIDO = 'Profissional não encontrado ou inativo.';
const PROFISSIONAL_JA_VINCULADO = 'Profissional já vinculado a outro atendente.';

const emTransacao = (fn) => emTransacaoCom(pool, fn);

const ehEmailDuplicado = (err) => Boolean(err) && err.code === 'ER_DUP_ENTRY' && /email/i.test(String(err.message));

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

/** Listagem paginada (sem documentos). `query` vem de req.query. */
async function listarUsuarios(query) {
  const role = H.SAFE_ROLES.includes(query.role) ? query.role : undefined;
  const status = H.SAFE_STATUSES.includes(query.status) ? query.status : undefined;
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const pageSize = Math.min(Math.max(parseInt(query.pageSize, 10) || 50, 1), 100);
  const busca = query.q !== undefined ? query.q : query.email;
  const search = busca ? String(busca).toLowerCase().trim() : null;

  const { rows, total } = await usuarios.listar(pool, { role, status, search, pageSize, offset: (page - 1) * pageSize });
  return { data: rows, page, pageSize, total };
}

/**
 * Perfil completo com CPF/RG/CNS decifrados (só admin; a leitura é auditada pela rota).
 * Documento ilegível (chave ausente) vira um aviso, não um 500.
 */
async function obterUsuario(id, { decrypt }) {
  const user = await usuarios.detalhe(pool, id);
  if (!user) return falha(404, NAO_ENCONTRADO);
  for (const col of ['cpf', 'rg', 'cns']) {
    try { user[col] = decrypt(user[col]); } catch { user[col] = '[ilegível: chave ausente]'; }
  }
  return { ok: true, user };
}

// ---------------------------------------------------------------------------
// Vínculo atendente ↔ profissional
// ---------------------------------------------------------------------------

/** O profissional informado pode ser vinculado a `userId`? Trava a linha dentro da transação. */
async function conferirVinculo(conn, professionalId, userId) {
  const p = await profissionais.ativoParaVinculo(conn, professionalId, { travar: true });
  if (!p) return falha(400, PROFISSIONAL_INVALIDO);
  if (p.user_id && p.user_id !== userId) return falha(400, PROFISSIONAL_JA_VINCULADO);
  return null;
}

/**
 * Mantém o vínculo coerente com o papel final do usuário (o pedido já foi conferido).
 * Atendente tem profissional (o informado, o que já tinha ou um criado agora); quem
 * deixa de ser atendente, ou pede para desvincular, fica sem.
 */
async function sincronizarVinculo(conn, { userId, papelFinal, papelAnterior, professionalId, desvincular, jobRole }) {
  if (papelAnterior === 'atendente' && papelFinal !== 'atendente') {
    await profissionais.desvincularUsuario(conn, userId);
  }
  if (desvincular) {
    await profissionais.desvincularUsuario(conn, userId);
    return;
  }
  if (papelFinal !== 'atendente') {
    await profissionais.desvincularUsuario(conn, userId);
    return;
  }
  if (professionalId) {
    await profissionais.desvincularUsuario(conn, userId);
    await profissionais.vincular(conn, professionalId, userId);
  }
  const existente = await profissionais.doUsuario(conn, userId);
  if (!existente) {
    const u = await usuarios.nomeECargo(conn, userId);
    await profissionais.criarParaAtendente(conn, {
      name: u.full_name || u.job_role || 'Atendente',
      jobTitle: u.job_role || 'Atendente',
      userId,
    });
  } else if (jobRole) {
    await profissionais.acompanharCargo(conn, userId, jobRole);
  }
}

// ---------------------------------------------------------------------------
// Edição
// ---------------------------------------------------------------------------

/**
 * Altera dados cadastrais, status, cargo, papel, nível, senha e vínculo.
 *
 * A ordem das recusas é contrato: 404 → hierarquia (403) → credenciais de admin (403) →
 * campo a campo (nome, e-mail, telefones, status, cargo, papel, nível, senha).
 * Papel (role) só muda por aqui com as regras de adminHierarchy.
 *
 * @param {{actor: object, id: string, body: object, podeAdmins: boolean}} p
 * @returns {Promise<{ok: true, auditoria: string} | {ok: false, status: number, error: string}>}
 */
async function atualizarUsuario({ actor, id, body, podeAdmins }) {
  const b = body || {};
  const {
    account_status: accountStatus, job_role: jobRole, admin_level: adminLevel, role, password,
    professional_id: professionalId, unlink_professional: desvincular,
    full_name: fullName, email, mobile, phone,
  } = b;
  // O motivo vai para a auditoria; o teto é o mesmo do sanitizeDetails.
  const reason = b.reason ? String(b.reason).slice(0, 1000) : '';
  const trocaSenha = password !== undefined && password !== '';

  return emTransacao(async (conn) => {
    const atual = await usuarios.paraEdicao(conn, id, { travar: true });
    if (!atual) return falha(404, NAO_ENCONTRADO);

    // Conta própria: ninguém muda o próprio status nem o próprio papel (evita se trancar para
    // fora ou se promover/rebaixar). Vem ANTES da hierarquia: admin editando a si mesmo tem nível
    // "igual", e o 403 genérico escondia a razão real.
    if (id === actor.id) {
      if (accountStatus !== undefined) return falha(400, 'Você não pode alterar o status da própria conta.');
      if (role !== undefined) return falha(400, 'Você não pode alterar o próprio papel.');
    }

    const porHierarquia = H.bloqueioPorHierarquia(actor, atual);
    if (porHierarquia) return falha(porHierarquia.status, porHierarquia.error);

    const porCredenciais = H.bloqueioDeCredenciais({
      alvo: atual, trocaEmail: H.emailMudou(email, atual.email), trocaSenha, podeAdmins,
    });
    if (porCredenciais) return falha(porCredenciais.status, porCredenciais.error);

    const sets = [];
    const params = [];
    let novoNome;
    let novoEmail;

    // Dados cadastrais: o painel edita nome, e-mail e telefones no mesmo formulário
    // que ativa a conta. Antes o PATCH ignorava esses campos em silêncio.
    if (fullName !== undefined) {
      const erro = erroDoNome(fullName);
      if (erro) return falha(400, erro);
      novoNome = String(fullName ?? '').trim();
      sets.push('full_name=?'); params.push(novoNome);
    }
    if (email !== undefined) {
      const v = validarEmail(email);
      if (!v.ok) return falha(400, v.error);
      novoEmail = v.email;
      if (await usuarios.emailEmUsoPorOutro(conn, novoEmail, id)) return falha(409, 'Este e-mail já está em uso por outra conta.');
      sets.push('email=?'); params.push(novoEmail);
    }
    for (const [campo, valor] of [['mobile', mobile], ['phone', phone]]) {
      if (valor === undefined) continue;
      const erro = erroDoTelefone(campo, valor);
      if (erro) return falha(400, erro);
      sets.push(`${campo}=?`); params.push(normalizarTelefone(valor));
    }

    if (accountStatus !== undefined) {
      if (!H.SAFE_STATUSES.includes(accountStatus)) return falha(400, 'Status inválido.');
      sets.push('account_status=?'); params.push(accountStatus);
    }
    if (jobRole !== undefined) { sets.push('job_role=?'); params.push(jobRole || null); }
    if (role !== undefined) {
      if (!H.SAFE_ROLES.includes(role)) return falha(400, 'Papel inválido.');
      const porPapel = H.bloqueioDePapel({ actor, alvo: atual, novoPapel: role, podeAdmins });
      if (porPapel) return falha(porPapel.status, porPapel.error);
      sets.push('role=?'); params.push(role);
    }
    if (adminLevel !== undefined) {
      const porNivel = H.bloqueioDeNivel({ actor, novoNivel: adminLevel, podeAdmins });
      if (porNivel) return falha(porNivel.status, porNivel.error);
      sets.push('admin_level=?'); params.push(adminLevel);
    }
    if (trocaSenha) {
      const erro = erroDaSenha(password);
      if (erro) return falha(400, erro);
      sets.push('password_hash=?'); params.push(await bcrypt.hash(String(password), 10));
    }

    // Vínculo conferido ANTES de escrever: um pedido inválido não altera nada.
    const papelFinal = role !== undefined ? role : atual.role;
    if (!desvincular && papelFinal === 'atendente' && professionalId) {
      const recusa = await conferirVinculo(conn, professionalId, id);
      if (recusa) return recusa;
    }

    if (sets.length) {
      let afetadas;
      try {
        afetadas = await usuarios.atualizar(conn, id, sets, params);
      } catch (err) {
        if (ehEmailDuplicado(err)) return falha(409, 'Este e-mail já está em uso por outra conta.');
        throw err;
      }
      if (afetadas === 0) return falha(400, 'Nenhuma alteração foi realizada.');
    }

    // Medidas que tiram poder do titular encerram a sessão: senha trocada, papel
    // rebaixado/trocado ou conta desativada. Trocar o e-mail muda a identidade de
    // login: a sessão antiga (emitida com o e-mail anterior) morre junto.
    const desativa = accountStatus !== undefined && accountStatus !== 'ativo';
    const mudaPapel = role !== undefined && role !== atual.role;
    const mudaEmail = novoEmail !== undefined && novoEmail !== atual.email;
    if (desativa || mudaPapel || trocaSenha || mudaEmail) await usuarios.revogarAcesso(conn, id);

    await sincronizarVinculo(conn, {
      userId: id, papelFinal, papelAnterior: atual.role,
      professionalId, desvincular: Boolean(desvincular), jobRole,
    });

    const mudancas = [];
    // Nome e e-mail identificam a pessoa e a trilha é imutável (ADR-0012): registra QUE mudou, não o valor.
    if (novoNome !== undefined && novoNome !== atual.full_name) mudancas.push('nome alterado');
    if (mudaEmail) mudancas.push('e-mail alterado');
    if (mobile !== undefined && normalizarTelefone(mobile) !== (atual.mobile || null)) mudancas.push('celular alterado');
    if (phone !== undefined && normalizarTelefone(phone) !== (atual.phone || null)) mudancas.push('telefone alterado');
    if (accountStatus !== undefined && accountStatus !== atual.account_status) mudancas.push(`status: ${atual.account_status}->${accountStatus}`);
    if (mudaPapel) mudancas.push(`role: ${atual.role}->${role}`);
    if (jobRole !== undefined && jobRole !== atual.job_role) mudancas.push(`cargo: ${atual.job_role || '-'}->${jobRole || '-'}`);
    if (adminLevel !== undefined && adminLevel !== atual.admin_level) mudancas.push(`admin_level: ${atual.admin_level || '-'}->${adminLevel}`);
    if (trocaSenha) mudancas.push('senha alterada');
    if (professionalId && papelFinal === 'atendente') mudancas.push(`profissional vinculado: ${professionalId}`);
    if (desvincular) mudancas.push('profissional desvinculado');
    if (reason) mudancas.push(`motivo: ${reason}`);
    return { ok: true, auditoria: mudancas.join('; ') || 'atualização' };
  });
}

// ---------------------------------------------------------------------------
// Criação e exclusão
// ---------------------------------------------------------------------------

/**
 * Cria uma conta. O corpo já passou por validate(criarUsuarioBody).
 * Atendente ganha profissional: o informado (se livre) ou um criado com o nome dele.
 */
async function criarUsuario({ actor, body, podeAdmins }) {
  const {
    full_name: fullName, email, password, role, account_status: accountStatus,
    job_role: jobRole, admin_level: adminLevel, professional_id: professionalId, mobile, phone,
  } = body;
  const nome = String(fullName).trim();
  const normalizedEmail = validarEmail(email).email;
  const papel = role && H.SAFE_ROLES.includes(role) ? role : 'paciente';

  const porCriacao = H.bloqueioDeCriacaoDeAdmin(papel, podeAdmins);
  if (porCriacao) return falha(porCriacao.status, porCriacao.error);
  // O nível do novo admin (gestor, se não informado) segue a mesma regra do PATCH: conhecido
  // e nunca acima do de quem cria.
  if (papel === 'admin') {
    const porNivel = H.bloqueioDeNivel({ actor, novoNivel: adminLevel || 'gestor', podeAdmins });
    if (porNivel) return falha(porNivel.status, porNivel.error);
  }
  const status = accountStatus && H.SAFE_STATUSES.includes(accountStatus)
    ? accountStatus
    : (papel === 'atendente' ? 'pendente' : 'ativo');

  // A coluna `email` é UNIQUE global: e-mail de conta excluída continua reservado.
  // Filtrar `deleted_at` aqui deixava o INSERT estourar 500 em vez de responder 409.
  if (await usuarios.emailExiste(pool, normalizedEmail)) return falha(409, 'E-mail já cadastrado.');

  const passwordHash = await bcrypt.hash(String(password), 10);
  const id = crypto.randomUUID();

  const r = await emTransacao(async (conn) => {
    // Valida o vínculo ANTES de criar a conta: recusar depois deixaria um usuário órfão.
    if (papel === 'atendente' && professionalId) {
      const p = await profissionais.ativoParaVinculo(conn, professionalId, { travar: true });
      if (!p) return falha(400, PROFISSIONAL_INVALIDO);
      if (p.user_id) return falha(400, PROFISSIONAL_JA_VINCULADO);
    }
    try {
      await usuarios.inserir(conn, {
        id, nome, email: normalizedEmail, passwordHash, role: papel, status,
        jobRole: jobRole || null,
        adminLevel: papel === 'admin' ? (adminLevel || 'gestor') : null,
        mobile: normalizarTelefone(mobile), phone: normalizarTelefone(phone),
      });
    } catch (err) {
      if (ehEmailDuplicado(err)) return falha(409, 'E-mail já cadastrado.');
      throw err;
    }
    if (papel === 'atendente') {
      if (professionalId) await profissionais.vincular(conn, professionalId, id);
      else if (!(await profissionais.doUsuario(conn, id))) {
        await profissionais.criarParaAtendente(conn, { name: nome, jobTitle: jobRole || 'Atendente', userId: id });
      }
    }
    return { ok: true };
  });
  if (!r.ok) return r;
  return { ok: true, id, auditoria: `criado: role=${papel} status=${status}` };
}

/**
 * Exclusão de conta pelo admin = ANONIMIZAÇÃO (ADR-0009): o mesmo caminho do titular.
 * Numa transação só: solta o profissional, anonimiza (zera os identificadores, cancela o
 * futuro, revoga sessões e links de redefinição) e derruba o acesso. A linha na trilha
 * (`lgpd_delete`, em nome do admin) sai depois do commit.
 *
 * A auditoria devolvida NÃO leva nome nem e-mail (ADR-0012): quem foi está no id da entidade.
 */
async function excluirUsuario({ actor, id }) {
  if (id === actor.id) return falha(400, 'Você não pode excluir a própria conta.');
  const r = await emTransacao(async (conn) => {
    const alvo = await usuarios.paraExclusao(conn, id);
    if (!alvo) return falha(404, NAO_ENCONTRADO);
    const bloqueio = H.bloqueioDeExclusao(actor, alvo);
    if (bloqueio) return falha(bloqueio.status, bloqueio.error);

    await profissionais.desvincularUsuario(conn, id);
    await anonimizarNaTransacao(conn, id);
    await usuarios.revogarAcesso(conn, id);
    return { ok: true, auditoria: `excluído (anonimização): role=${alvo.role}` };
  });
  if (r.ok) await registrarEliminacao(id, { reason: 'exclusão administrativa', actorId: actor.id });
  return r;
}

/**
 * Redefine o segundo fator de um atendente ou admin que perdeu o aparelho (ADR-0010). Só superadmin
 * (capability `admins`, decidida na rota) e com a SENHA DELE: um token roubado não basta. Zera o MFA e derruba as
 * sessões e os links de redefinição; no próximo login a conta volta a configurar o MFA. Conta própria não
 * (outro superadmin ou o terminal resolve): quem redefine não pode ser quem perdeu o acesso.
 */
async function redefinirMfa({ actor, id, password }) {
  if (id === actor.id) {
    return falha(400, 'Para a sua própria conta, peça a outro superadmin ou use o procedimento de terminal.');
  }
  return emTransacao(async (conn) => {
    const ator = await usuarios.paraRedefinirMfa(conn, actor.id);
    const senhaConfere = ator && (await bcrypt.compare(String(password), ator.password_hash || '').catch(() => false));
    if (!senhaConfere) return falha(401, 'Senha incorreta.');

    const alvo = await usuarios.paraRedefinirMfa(conn, id);
    if (!alvo) return falha(404, NAO_ENCONTRADO);
    if (!exigeMfa(alvo)) return falha(400, 'Só atendente e admin têm o segundo fator obrigatório.');

    await usuarios.zerarSegundoFator(conn, id);
    await usuarios.revogarAcesso(conn, id);
    return { ok: true, auditoria: `segundo fator redefinido (role=${alvo.role})` };
  });
}

module.exports = { listarUsuarios, obterUsuario, atualizarUsuario, criarUsuario, excluirUsuario, redefinirMfa };
