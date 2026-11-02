# ADR-0012: Auditoria sem dado pessoal em texto e lembrete com "marcar como lido"

**Status:** Aceita (não implementada) · **Data:** 2026-11-01 · **Decisor:** responsável pelo projeto · **Achados:** E-15, R-06

## Contexto
1. O `audit_log` é imutável (triggers) e a anonimização o preserva. Mas o campo `details` recebe texto livre com dado pessoal: `staff_create` grava o nome do paciente (`routes/staff.routes.js:291`). Depois da anonimização, o nome do titular continua na trilha, o que contraria o pedido de eliminação.
2. A coluna `reminders.read` existe no schema, mas nenhum código do servidor a lê ou grava, e não há rota para o paciente marcar um lembrete como lido.

## Decisão
1. `details` da auditoria **não leva nome, e-mail, CPF nem telefone**. Leva identificadores (id do usuário, do atendimento) e dados operacionais (horário, duração, status, motivo). Quem precisa do nome cruza o id com `users`, que a anonimização já trata. `sanitizeDetails` ganha uma verificação que recusa padrões de CPF e e-mail, como defesa adicional, e um teste percorre as ações existentes.
2. Criar `PATCH /me/reminders/:id/read`, que marca `read = 1` apenas para lembretes do próprio usuário, e o front passa a usá-la.

## Alternativas
- **Manter o nome e registrar o risco no RIPD:** deixa dado pessoal de titular eliminado numa trilha que não pode ser editada.
- **Remover a coluna `read`:** descarta uma função útil ao paciente (saber o que já viu) por falta de rota.

## Consequências
- (+) A trilha continua imutável e passa a não conter identificação direta; a eliminação do titular é completa.
- (+) O lembrete ganha estado de leitura de fato.
- (−) Linhas **já gravadas** com nome continuam na trilha: não podem ser editadas. O RIPD registra esse resíduo e a data de corte; a mudança vale daqui para frente.
- (−) Quem audita perde a leitura direta do nome no `details`; precisa de um `JOIN` com `users`.
