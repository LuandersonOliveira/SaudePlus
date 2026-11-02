/**
 * ADR-0012 (E-15): o `details` do audit_log não leva nome, e-mail, CPF nem telefone.
 *
 * A trilha é imutável (triggers) e a anonimização a preserva. Um nome gravado ali
 * sobrevive ao pedido de eliminação do titular. Daqui para frente a trilha guarda
 * identificadores (id do usuário, do atendimento) e dados operacionais.
 *
 * Três camadas de prova:
 *   1. `sanitizeDetails` mascara e-mail e CPF que escaparem (defesa adicional);
 *   2. os serviços, chamados com nomes e e-mails conhecidos, devolvem texto sem eles;
 *   3. uma varredura do código-fonte barra o texto de auditoria que volte a citar
 *      campo de pessoa (mesmo estilo dos testes estáticos de admin-user-safety).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SERVER = path.resolve(__dirname, '..');
require(require.resolve('dotenv', { paths: [SERVER] })).config({ path: path.join(SERVER, '.env') });

const pool = require('../src/db');
const bcrypt = require(require.resolve('bcryptjs', { paths: [SERVER] }));
const { sanitizeDetails } = require('../src/utils/audit');
const adminUsers = require('../src/services/adminUsers');
const adminProfessionals = require('../src/services/adminProfessionals');

const USUARIOS = [];
const PROFISSIONAIS = [];

test.after(async () => {
  for (const id of PROFISSIONAIS) await pool.query('DELETE FROM professionals WHERE id = ?', [id]).catch(() => {});
  await pool.query('DELETE FROM professionals WHERE user_id IN (?)', [USUARIOS.length ? USUARIOS : ['x']]).catch(() => {});
  for (const id of USUARIOS) await pool.query('DELETE FROM users WHERE id = ?', [id]).catch(() => {});
  await pool.end().catch(() => {});
});

// ---------------------------------------------------------------------------
// 1. sanitizeDetails
// ---------------------------------------------------------------------------

test('sanitizeDetails mascara e-mail, sem perder o resto do texto', () => {
  const txt = sanitizeDetails('contato maria.silva+x@exemplo.com.br confirmado por joao@x.org; ok');
  assert.ok(!/@/.test(txt), `sobrou e-mail: ${txt}`);
  assert.match(txt, /\[e-mail\]/);
  assert.match(txt, /confirmado por/);
  assert.match(txt, /; ok$/);
});

test('sanitizeDetails continua mascarando CPF formatado e só com dígitos', () => {
  assert.ok(!/52998224725/.test(sanitizeDetails('cpf 52998224725')));
  assert.ok(!/529\.982\.247-25/.test(sanitizeDetails('cpf 529.982.247-25')));
});

// ---------------------------------------------------------------------------
// 2. serviços de administração
// ---------------------------------------------------------------------------

const NOME = 'Zuleica Quintanilha Bezerra';
const NOME_NOVO = 'Zuleica Bezerra Quintanilha';
const REGISTRO = 'CRM-PE-998877';

async function conta({ role = 'paciente', nivel = null, nome = 'Conta Teste' } = {}) {
  const id = crypto.randomUUID();
  const email = `pii-${id}@test.local`;
  await pool.query(
    'INSERT INTO users (id, full_name, email, password_hash, role, admin_level, account_status) VALUES (?,?,?,?,?,?,?)',
    [id, nome, email, await bcrypt.hash('senha-de-teste-123', 4), role, nivel, 'ativo']
  );
  USUARIOS.push(id);
  return { id, email, role, admin_level: nivel };
}

function semDadoPessoal(texto, ...proibidos) {
  for (const p of proibidos) {
    assert.ok(!String(texto).includes(p), `a auditoria cita "${p}": ${texto}`);
  }
}

test('adminUsers: criar, atualizar e excluir não citam nome nem e-mail', async () => {
  const ator = await conta({ role: 'admin', nivel: 'superadmin' });
  const emailNovo = `criado-${crypto.randomUUID()}@test.local`;

  const criado = await adminUsers.criarUsuario({
    actor: ator, podeAdmins: true,
    body: { full_name: NOME, email: emailNovo, password: 'senha-forte-123', role: 'paciente' },
  });
  assert.equal(criado.ok, true, JSON.stringify(criado));
  USUARIOS.push(criado.id);
  assert.match(criado.auditoria, /^criado: role=paciente status=ativo$/);
  semDadoPessoal(criado.auditoria, NOME, emailNovo, 'Zuleica');

  const outroEmail = `trocado-${crypto.randomUUID()}@test.local`;
  const atualizado = await adminUsers.atualizarUsuario({
    actor: ator, id: criado.id, podeAdmins: true,
    body: { full_name: NOME_NOVO, email: outroEmail },
  });
  assert.equal(atualizado.ok, true, JSON.stringify(atualizado));
  assert.match(atualizado.auditoria, /^nome alterado; e-mail alterado$/);
  semDadoPessoal(atualizado.auditoria, NOME, NOME_NOVO, emailNovo, outroEmail);

  const excluido = await adminUsers.excluirUsuario({ actor: ator, id: criado.id });
  assert.equal(excluido.ok, true, JSON.stringify(excluido));
  assert.match(excluido.auditoria, /^excluído \(anonimização\): role=paciente$/);
  semDadoPessoal(excluido.auditoria, NOME_NOVO, outroEmail, 'removido_');
});

test('adminProfessionals: criar e editar não citam nome nem registro profissional', async () => {
  const criado = await adminProfessionals.criarProfissional({ name: NOME, job_title: 'Clínico', registry: REGISTRO }, 'cadastro');
  assert.equal(criado.ok, true, JSON.stringify(criado));
  PROFISSIONAIS.push(criado.id);
  assert.equal(criado.auditoria, 'profissional criado; motivo: cadastro');
  semDadoPessoal(criado.auditoria, NOME, 'Zuleica');

  const editado = await adminProfessionals.atualizarProfissional({
    id: criado.id, reason: 'correção', actorId: USUARIOS[0] || null,
    body: { name: NOME_NOVO, registry: 'CRM-PE-112233' },
  });
  assert.equal(editado.ok, true, JSON.stringify(editado));
  assert.equal(editado.auditoria, 'nome alterado; registro alterado; motivo: correção');
  semDadoPessoal(editado.auditoria, NOME, NOME_NOVO, REGISTRO, '112233');
});

// ---------------------------------------------------------------------------
// 3. varredura do código-fonte
// ---------------------------------------------------------------------------

const SRC = path.join(SERVER, 'src');
const ARQUIVOS = ['routes', 'services'].flatMap((d) =>
  fs.readdirSync(path.join(SRC, d)).filter((f) => f.endsWith('.js')).map((f) => path.join(SRC, d, f))
);

// Trechos que viram `details`: o texto de `auditoria:`, as chamadas `req.audit(...)` e as
// listas de mudanças (`mudancas.push`, `detalhes.push`) que alimentam a auditoria.
const TRECHOS = /(auditoria:\s*`[^`]*`|req\.audit\([\s\S]*?\);|(?:mudancas|detalhes)\.push\(`[^`]*`\))/g;

// Campos de pessoa que não podem entrar no texto da trilha.
const PROIBIDOS = [
  /\.full_name\b/, /\bfull_name\b/, /\.email\b/, /normalizedEmail/, /novoEmail/, /novoNome/,
  /\.phone\b/, /\.mobile\b/, /\bcpf\b/i, /\$\{\s*registry/, /patient\./, /dados\.name/,
];

test('nenhum texto de auditoria em rotas e serviços cita campo de pessoa', () => {
  const achados = [];
  for (const arq of ARQUIVOS) {
    const codigo = fs.readFileSync(arq, 'utf8');
    for (const [trecho] of codigo.matchAll(TRECHOS)) {
      for (const re of PROIBIDOS) {
        if (re.test(trecho)) achados.push(`${path.relative(SERVER, arq)}: ${re} em ${trecho.replace(/\s+/g, ' ').slice(0, 110)}`);
      }
    }
  }
  assert.deepEqual(achados, [], `a trilha é imutável; tire o dado pessoal destes textos:\n${achados.join('\n')}`);
});

test('a varredura enxerga os pontos de auditoria que existem (não passa por estar vazia)', () => {
  let total = 0;
  for (const arq of ARQUIVOS) total += [...fs.readFileSync(arq, 'utf8').matchAll(TRECHOS)].length;
  assert.ok(total >= 20, `esperava achar ao menos 20 trechos de auditoria, achou ${total}`);
});
