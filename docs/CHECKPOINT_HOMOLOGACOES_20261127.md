# Checkpoint funcional — Gestão da Família — 27/11/2026

> Registro incremental das decisões e homologações relatadas nesta conversa. Complementa `docs/DOCUMENTO_MESTRE.md` e `docs/PLANEJAMENTO_PDCA.md`; não substitui a auditoria do repositório ou dos dados no Supabase. Atualizar o estado conforme evidências posteriores.

## Continuidade e governança

- Projeto: **Gestão da Família**; branch de trabalho relatada: `codex/ux-review`.
- Último HEAD **informado em log** na conversa: `c36e9b8c90d6b99e623bde02acbe0fe14d51b2e9`. **Não assumir que seja o HEAD atual**: confirmar com `git rev-parse HEAD` ao aplicar este checkpoint.
- Há alterações locais e backups gerados durante as iterações; preservar arquivos staged/unstaged, arquivos não rastreados, migrações, dados de homologação e segredos. Não usar `git add .`, `git reset --hard`, `git clean -fd`, force-push nem publicar sem autorização.
- Fonte principal das regras mensais: **Plan > 4. Resultados**. `Fluxo de Caixa` e horizonte do `Dashboard` devem reutilizar o mesmo modelo de apuração em regime de **caixa** (função compartilhada `buildCashResultsModel` em `src/lib/cash-results-model.ts` na entrega de 27/11). Não restabelecer cálculo por competência naquelas telas.
- Os totais **Família** excluem valores de terceiros; a visão **Geral** no Fluxo de Caixa pode incluí-los. Recebimentos, pagamentos de faturas e transferências não devem gerar dupla contagem. Compras e parcelas têm regras de atribuição à fatura por vencimento; estimativas futuras devem ser identificadas.

## Frentes entregues e evidências de aceite

| Frente | Versão / arquivos principais | Regra e resultado | Evidência e status |
|---|---|---|---|
| Etapa 7A — Novo lançamento | `src/components/transaction-dialog.tsx`, `src/lib/transaction-budget-preview.ts`, teste dedicado | Saldo de categoria raiz informado conforme mês efetivo de caixa/fatura, registrado sem projeções. Quando período/fatura não é determinável, ocultar prévia insegura | 5 testes de preview aprovados em log; usuário confirmou os cenários conta/Dez/Jan em navegador. **Homologada no escopo testado** |
| Cartões — visual | `/cartoes`, `credit-card-detail-dashboard.tsx`, `card-brand-logo.tsx` | Até quatro cards na visão geral; logos de banco/bandeira, emissor separado do nome do cartão, últimos quatro dígitos; evolução de faturas, seleção do mês no próprio gráfico | Evolução V1.3.6 aprovada pelo usuário; cadastro de dígitos `2141` exibido. **Visual aprovado** |
| Cartões — edição | V1.3.7; `card-transaction-edit-dialog.tsx` e integração na rota/detalhe | Lápis abre edição direta. Fatura paga: somente categoria/classificação; não paga: edição permitida conforme regras. Bloquear alteração de **valor** de compra parcelada se alguma parcela já foi paga; revalidar no Supabase antes de salvar | Usuário respondeu “perfeito”. **Aceite funcional relatado**; testes automatizados abrangentes de todas as combinações de parcelas/faturas não foram apresentados |
| Contas | `/contas` V1.0.3 | Layout com cards, detalhe e instituições pesquisáveis; logos Ticket, Espécie/Cash e Gift Card; saldo inicial permanece no cálculo mas seção de tabela saiu da visão geral | Usuário declarou a parte visual encerrada. **Visual aprovado** |
| Planejamento 4. Resultados / Fluxo de Caixa | `plan-modelo-a.tsx`, `cash-results-model.ts`, `/fluxo-de-caixa` | Apuração mensal de caixa compartilhada, visões Família/Terceiros/Geral, faturas, saldo acumulado e projeções identificadas | Usuário declarou “Fluxo de caixa ok”. **Aceite funcional relatado** |
| Dashboard | `/dashboard` V1.2.3 | Situação → evolução → decisão. Caixa do horizonte vem do modelo compartilhado; aderência variável compara registrado vs planejado, distingue saldo de caixa positivo de limite de gastos excedido; link aponta ao `/planejamento` | Captura de dezembro apresentada e usuário declarou “fechamos”. **Visual/resultado aceito no exemplo** |
| Central de Qualidade | `/inconsistencias` V1.0.2.1 + `/lancamentos` | Removidos alertas de orçamento antigo (não são erro cadastral). Detecta problemas de registro; revisão abre lançamento pelo ID, inclusive compra em cartão, retornando à Central | Teste de despesa sem categoria de R$ 0,01 detectado; usuário confirmou funcionamento da edição direta. **Homologada no fluxo testado** |

## Decisões e fronteiras que não podem ser perdidas

1. Aderência de **despesas variáveis** não equivale ao saldo do caixa. Em nov/2026, captura histórica mostrou limite R$ 4.992,26 e registrado R$ 5.765,41 (excesso de R$ 773,15), apesar de resultado de caixa positivo; valores são **evidência daquele momento**, não constantes de código.
2. **Faturas pagas:** o usuário pode alterar categoria e classificação, sem modificar valor, datas, conta/cartão, situação ou excluir a compra pelo editor de cartões. A proteção precisa existir também na gravação, não somente na UI.
3. **Parcelas:** quando qualquer parcela do grupo estiver paga, bloquear edição de valor da compra. A evidência disponível confirma implementação preparada e aceite visual/funcional relatado; ampliar testes reais de grupo parcelado.
4. O campo `credit_cards.last_four_digits` é opcional (`text`, formato de quatro algarismos). Existência da coluna foi confirmada em consulta Supabase; não armazenar número completo.
5. A Central de Qualidade não corrige registros automaticamente. Suspeita de duplicidade é sinal para revisão, não prova de erro. Desvios de orçamento pertencem a Planejamento/Saúde Financeira.
6. A auditoria atual da Central foi descrita com limite técnico de **5.000 lançamentos** por consulta. Zero ocorrências neste conjunto **não certifica a base inteira**.
7. Logos e identidade visual: usar catálogo/fallback por iniciais, preservar nome livre de emissor/instituição. Revisar licença e condições de uso dos SVGs antes de distribuir ativos de terceiros.
8. O editor completo de cartão foi inicialmente implementado como cópia isolada do editor de Lançamentos: considerar extração compartilhada com testes, sem alterar de imediato uma funcionalidade homologada.

## Evidências faltantes / dívida técnica

- Não foi entregue nesta conversa um **log final de build, lint, TypeScript e testes de integração** para cada última versão visual. Evitar afirmar aprovação automatizada global por conta do aceite em navegador.
- A contagem histórica de diagnósticos TypeScript varia com o estado local e o momento; houve logs com 91 e com 89 erros. Comparar as **mensagens** com uma baseline capturada no HEAD atual, nunca apenas o número total.
- Confirmar com testes reais: parcelas parcialmente pagas; troca de data/cartão e reatribuição de fatura; permissões de edição em fatura paga por caminhos alternativos; reconciliação do Fluxo/Planejamento e Dashboard em meses de referência.
- Central de Qualidade: paginação completa além do limite técnico, testes individualizados de duplicidade e fatura e histórico de resolução, **somente se priorizados**.
- Identificar migrations já aplicadas remotamente e as ainda locais antes de preparar qualquer deploy. Não inferir estado da produção por arquivo em `supabase/migrations`.
- Se houver futura modernização visual, preservar tema escuro aprovado; configurações de tema ficaram para frente posterior.

## Próxima sessão — protocolo curto

1. Ler este checkpoint, `docs/DOCUMENTO_MESTRE.md` e o histórico técnico/PDCA mais recente.
2. Capturar `git branch --show-current`, `git rev-parse HEAD`, `git status --short` e a baseline de TypeScript; preservar o que já está staged.
3. Confirmar a frente seguinte com o usuário; não reabrir homologações encerradas sem defeito reproduzível.
4. Trabalhar em uma etapa por vez. Entregar script PowerShell completo, criar backup fora do projeto quando aplicável, executar verificações e documentar evidências.
5. Versionar seletivamente após revisão; nenhum push/deploy automático. Registrar hash **real** após commit.

## Origem da evidência

Síntese do diálogo de implementação e aceites do usuário entre 25 e 27/11/2026, dos logs de PowerShell informados e dos pacotes de código encaminhados. Não substitui consulta ao repositório atualizado.


<!-- CHECKPOINT_ENCERRAMENTO_GIT_20261127 -->
## Encerramento documental do Git - 27/11/2026

Registro atualizado em [Documento Mestre](DOCUMENTO_MESTRE.md#encerramento-documental-do-git---27112026): commits ec217c3, ac6cf35 e 71297af versionados; duas migracoes anonimas arquivadas fora do repositorio com manifesto SHA-256 verificado; Git limpo antes do acrescimo. Os 3 commits pendentes de push pertencem ao relato do Chat - 03; a comparacao atual consta no Documento Mestre. Auditoria das permissoes remotas e validacoes tecnicas continuam pendentes. Sem push, deploy ou SQL remoto nesta entrega.
