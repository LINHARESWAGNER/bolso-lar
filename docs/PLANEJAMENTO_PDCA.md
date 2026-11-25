# Planejamento PDCA — checkpoint 5A–5H

Data: 24/11/2026. Branch: `codex/ux-review`. Base inspecionada: `7b51d97`.
Checkpoint do trabalho local, sem push, deploy ou execução de SQL. O código local é a fonte desta entrega; nenhuma versão remota foi usada para substituir arquivos.

## Etapas e evidências

| Etapa | Decisão / comportamento presente no código | Evidência e situação |
|---|---|---|
| 5A | Gestão anual de receitas e despesas fixas, com meses, registros e estimativas diferenciados | Componentes locais inspecionados; conclusão relatada no Chat - 02 |
| 5B–5C | Exclusão individual para lixeira; cartões, parcelas e transferências protegidos. Exclusão de regra consulta lançamentos ativos e continuações, exige confirmação e avisa sobre perda do vínculo dos excluídos | Inspeção de `plan-management-annual.tsx`; fluxos destrutivos não executados nesta revisão |
| 5D | Vinculação explícita de previsão pontual não paga; cadeias por `predecessor_recurrence_id`, nunca por semelhança de descrição | Unimed e financiamento validados no relato anterior; não revalidados no banco nesta sessão |
| 5E | Nome de apresentação do compromisso agrupado e organização visual anual | Implementação presente; validação visual relatada anteriormente |
| 5F | Nome na recorrência raiz, persistido no Supabase; leitura de nomes antigos do navegador apenas para importação explícita | Em homologação; migração incluída, não executada nesta sessão; aplicação remota não confirmada |
| 5G | Modelo A simplificado, meses sempre visíveis, atalhos de gerenciamento e dois desdobramentos de recebimentos/pagamentos | Diff local confirma mudança de apresentação; homologação relatada no chat |
| 5H | Saldo inicial, saldo final e evolução mensal, mantendo detalhes de contas e pendências | Fórmula confirmada no código; capturas validadas no chat anterior, sem nova inspeção visual |

## Rotas e regras

- `/planejamento` mantém Modelo A como padrão. `?gerenciar=receitas`, `fixas` e `variaveis` abrem as respectivas gestões; `?modelo=anual` e `?modelo=legado` continuam disponíveis.
- Família e terceiros permanecem separados. Compras do cartão e pagamento da fatura não devem duplicar despesas; parcelas variáveis já compõem o limite variável.
- Evolução: `(saldoFinal - saldoInicial) / abs(saldoInicial) * 100`, com uma casa decimal. Saldo inicial zero mostra “Sem base percentual”. O saldo final já considera a reserva variável.
- Referência histórica de interface: dezembro/2026, inicial R$ 2.633,33 e final R$ 10.395,42 (+294,8%); janeiro/2027, inicial R$ 10.395,42 e final R$ 9.074,58 (−12,7%). São valores do relato, não uma consulta atual nem auditoria dos lançamentos.
- O editor variável salva/aprova o mês por `save_budget_plan_version`; aplicar para 12 meses prepara o rascunho e não salva/aprova todos os meses. Meses existentes ficam protegidos; revisões seguem Action.
- As consultas de segurança antes de excluir/vincular não constituem uma transação atômica. Concorrência e isolamento entre famílias ainda precisam de homologação específica.

## Migração 5F

`supabase/migrations/20261124220000_recurring_group_display_name.sql` adiciona coluna nullable `group_display_name`, restringe o texto aparado a 1–100 caracteres e conserva as políticas/permissões existentes. Não modifica valores financeiros. Revisão estática somente; não houve execução SQL local ou remota.

Antes de publicar, confirmar aplicação em homologação, histórico/schema de produção e políticas RLS. Aplicar em produção apenas em tarefa de publicação autorizada. Atualizar tipos gerados: o componente atualmente usa coerção de tipo para a coluna nova. Não misturar as duas migrações locais de acesso anônimo no procedimento de publicação.

## Validações deste checkpoint

- Testes: 53 aprovados, zero falhas, usando Node e o resolvedor local já preparado no índice. Comando: `node --experimental-strip-types --loader ./scripts/test-resolver.mjs --test` seguido dos arquivos `src/lib/*.test.ts` enumerados pelo PowerShell.
- TypeScript: `tsc --noEmit --pretty false --incremental false`, saída 2, 90 diagnósticos. As linhas completas de diagnóstico são idênticas à captura `typescript-baseline.txt` da entrega de auditoria; não apenas a contagem.
- `git diff --check`: aprovado para alterações rastreadas na inspeção inicial.
- Build: `vite build` (comando do script `pnpm build`) aprovado, saída 0. A primeira tentativa falhou por permissão de escrita no temporário do Vite; a repetição com acesso local adequado passou. Não houve deploy.
- Lint: `eslint .` (comando do script `pnpm lint`) falhou, saída 1: 17.429 erros e 25 avisos, sendo 17.425 erros potencialmente corrigíveis automaticamente. Predominam questões de formatação; há também escapes desnecessários. Não foi usado `--fix`. A configuração global não ignora todas as cópias de backup, portanto esse total não é uma medida isolada dos arquivos deste checkpoint nem prova de regressão.
- Busca heurística de chaves secretas, JWT, chaves privadas e URLs PostgreSQL com senha: nenhuma ocorrência nos seis arquivos de código/SQL selecionados. Backups, ambientes e temporários não foram selecionados.
- Logs locais de testes, TypeScript, lint e build ficam na pasta de entrega, fora do Git, com prefixo `checkpoint-5A-5H-`.
- Testes usam as alterações preexistentes de `scripts/test-resolver.mjs` e `src/lib/planning.test.ts`, preservadas no índice e fora deste commit. Portanto, esse resultado não certifica um checkout isolado do commit sem essas alterações.

## Pendências para retomada

1. Confirmar migração 5F em homologação e testar renomeação, retorno ao padrão, importação explícita e sincronização em outro dispositivo.
2. Validar responsividade no celular, exclusões/restauração, vínculos, continuidade entre anos e concorrência com usuários de famílias distintas.
3. Revisar os 90 diagnósticos TypeScript e o resultado de lint/build; checkpoint não equivale a release homologada.
4. Concluir homologação do editor variável, aprovação mensal, revisão Action e integração Do/Check. Revisar aviso da visão anual que diz não gravar alterações: a aprovação mensal variável já chama RPC.
5. Revisar os dois arquivos de testes já preparados em commit separado. Manter configuração Supabase, `LEIA-ME.txt`, migrações anônimas, backups e segredos fora desta seleção.

## Escopo do commit

README, este documento, os três componentes `plan-modelo-a`, `plan-management-annual`, `plan-anual-editor`, as rotas `planejamento` e `recorrencias` e a migração 5F. Preservar o README original por adição de seção. Não alterar o código funcional neste checkpoint.

O hash real deve ser consultado no Git e informado na entrega após o commit; não registrar hash inventado ou reescrever histórico para colocá-lo no próprio commit.
