# Prós e contras das decisões e propostas

Complementa `ANALISE_ESTRUTURA_ARQUITETURA_BANCO.md`, os ADRs (`adr/`), a RFC-0001 e a PoC-001. Cada tabela compara as opções reais consideradas; **✔ recomendada** indica a escolha registrada (ou proposta) e o ADR correspondente.

## 1. Como garantir horário único por profissional (ADR-0007)

| Opção | Prós | Contras |
|---|---|---|
| A. Só aplicação (`FOR UPDATE`) — **hoje** | Cobre sobreposição por duração; já testada (`test/race`) | Nenhuma barreira se um caminho novo esquecer o padrão |
| B. `UNIQUE (professional_id, scheduled_at)` simples | Trivial | Cancelados/remarcados bloqueiam o horário para sempre |
| **C. Coluna gerada `active_slot` + `UNIQUE` ✔ (+ A)** | Barra duplicata exata e corrida (1 de 20 na PoC); cancelado libera | `ALTER` reescreve a tabela; não cobre `professional_id` NULL nem sobreposição parcial |
| D. Trava de aplicação com `GET_LOCK` | Serializa por profissional | Mais código; trava presa se a conexão cair; não é garantia persistida |

## 2. Como identificar o paciente por CPF (ADR-0006)

| Opção | Prós | Contras |
|---|---|---|
| A. Status quo (decifrar e comparar) | Zero mudança | 8,4 s com 50 mil usuários; duplicidade possível |
| B. Cifra determinística | `UNIQUE` direto | Expõe igualdade em toda a coluna; enfraquece a cifra |
| C. SHA-256 simples | Sem chave nova | Invertível por força bruta (10⁹ CPFs possíveis) |
| **D. HMAC-SHA256 com chave separada ✔** | 11 ms; `UNIQUE`; não invertível sem a chave | Chave nova a proteger e a rotacionar; dado derivado a registrar no ROPA |

## 3. Integridade referencial de `unit_id`/`professional_id` (ADR-0007)

| Opção | Prós | Contras |
|---|---|---|
| A. Sem FK — **hoje** | Nada a migrar | Órfãos possíveis; consultas por unidade sem índice |
| B. FK `RESTRICT` | Máxima proteção | Impede limpar unidades/profissionais com histórico |
| C. FK `CASCADE` | Sem órfãos | Apagaria histórico clínico — inaceitável |
| **D. FK `SET NULL` ✔** | Preserva o atendimento; sem órfãos | Registro antigo pode ficar sem unidade (mitigado pelo texto `location`); exige limpar órfãos antes |

## 4. Controle de versão do banco (ADR-0008)

| Opção | Prós | Contras |
|---|---|---|
| A. Scripts idempotentes sem controle — **hoje** | Simples; já funciona com `schema-parity` | Sem versão nem rollback |
| **B. Migrations numeradas + runner próprio ✔** | Controle total, ~50 linhas, sem dependência | Código próprio a manter; conversão dos 14 scripts |
| C. Ferramenta pronta (umzug, Flyway) | Recursos prontos | Dependência e convenções externas |
| D. ORM com migrations | Integrado ao acesso a dados | Reescreveria a camada de dados inteira |

## 5. Estrutura do código do servidor (A1/A2 da análise)

| Opção | Prós | Contras |
|---|---|---|
| A. Manter rotas com SQL — **hoje** | Nada a fazer; fácil de ler uma rota isolada | Regra só testável via HTTP + banco; duplicação entre rotas |
| **B. Extrair serviços por domínio, gradualmente** | Regra reutilizável e testável sem HTTP; suíte atual protege | Esforço grande (L); risco de refatoração parcial se feita de uma vez |
| C. Reescrever em TypeScript/framework novo | Tipos de ponta a ponta | Custo e risco desproporcionais; só se o servidor virar produto maior |

Recomendação: B, **junto de cada mudança funcional**, não como projeto à parte.

## 6. Entrega do front em produção (ADR-0002)

| Opção | Prós | Contras |
|---|---|---|
| **A. Express serve `web/dist` (origem única) ✔** | Um processo e um deploy; sem CORS | Node serve estáticos (ok nesta escala) |
| B. Nginx/CDN para estáticos + API separada | Melhor em escala e cache | Infra que o projeto ainda não tem; CORS |
| C. Dois serviços independentes | Escala separada | Mais peças e superfície |

## 7. Front legado (ADR-0003)

| Opção | Prós | Contras |
|---|---|---|
| **A. Aposentar ✔ (feito)** | Menos código; uma implementação por tela | Testes de XSS do legado perderam o objeto |
| B. Manter como fallback | Plano B se o React falhar | Duas implementações divergem (já havia divergências) |

## 8. Como validar uma proposta antes de implementar

| Instrumento | Quando usar | Esforço | Neste projeto |
|---|---|---|---|
| **RFC** | Mudança com impacto em dados, segurança ou várias áreas; pede opinião | Médio | RFC-0001 |
| **ADR** | Registrar uma decisão já tomada (ou proposta) e o porquê | Baixo | ADR-0001…0008 |
| **Especificação técnica** | Depois de aprovada: o "como" detalhado para implementar e testar | Médio/alto | ESPEC-001 |
| **PoC** | Quando há dúvida técnica verificável (o banco faz isso? quanto custa?) | Baixo/médio | POC-001 (18/18) |
| **Prós e contras** | Comparar opções de forma curta, para apoiar o ADR | Baixo | este documento |

Fluxo usado aqui: análise (Fase 6) → PoC (reduz a incerteza) → RFC (pede comentários) → ADR (registra a decisão) → especificação (detalha a implementação).
