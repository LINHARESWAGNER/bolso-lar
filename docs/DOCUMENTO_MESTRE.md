# Documento mestre — Gestor Financeiro

Atualizado em 24/11/2026. Fonte de continuidade, com evidências separadas de relatos anteriores.

## Versão e último passo concluído

HEAD de origem da consolidação: `abdd940cefe2f776cf47fb5cccfc3e6bb2b813de`; branch `codex/ux-review`. Documentação incorporada por autorização do usuário, preservando byte a byte o README original e acrescentando a seção de continuidade. Backups e temporários continuam no disco e agora estão ignorados. Os hashes dos checkpoints serão registrados em `HISTORICO_IMPLEMENTACOES.md`; consultar também `git log` para o HEAD corrente.

## Estado funcional relatado no Chat - 02

- Modelo A é o planejamento oficial em `/planejamento`.
- Projeção usa saldos conciliados e reservas acumuladas; gráfico distingue Família/Terceiros/Geral.
- Aprovação 2A/2B foi relatada como aplicada; confirmar no banco de homologação antes de tratar como evidência atual.
- Versionamento contempla principalmente despesas variáveis.
- Orçamento anual com 12 meses e categorias expansíveis foi definido, mas sua implementação integral e a integração Do/Check/Action continuam pendentes.

Esses itens são continuidade do relato anterior; não houve homologação em navegador nesta auditoria.

## Validações

Baseline histórica exigida: **90 erros TypeScript**. Não reduzir artificialmente com exclusões, mudanças de tsconfig, `any`, `ts-ignore` ou retirada de testes. Comparar arquivo, código e mensagem, além da quantidade; erro novo com compensação numérica continua sendo regressão.

Medição atual confirmada: `tsc --noEmit --pretty false --incremental false`, saída 2, **90 diagnósticos**, preservados em `typescript-baseline.txt` na entrega. A contagem coincide com o relato; não havia lista histórica de diagnósticos para comprovar identidade erro a erro. Esta captura passa a permitir essa comparação futura.

Diagnóstico inicial com Node v24.21.0 sem resolvedor: 15 resultados, 10 aprovados e 5 falhas. A revisão identificou quatro erros de resolução de módulos e uma expectativa desatualizada que descontava parcelas variáveis duas vezes. Com `scripts/test-resolver.mjs` e a expectativa corrigida, **53 testes aprovados, zero falhas**. O cálculo financeiro foi preservado. Comando e justificativa em `REVISAO_PRE_PUSH.md`.

Após incorporação, TypeScript novamente retornou saída 2 e **90 diagnósticos**; comparação do log integral com a captura anterior: **zero diferenças**. Nenhuma configuração TypeScript foi alterada. Build, lint, navegador e banco não foram validados nesta consolidação.

## Próxima tarefa

Concluir os checkpoints locais seletivos e registrar seus hashes. Depois resolver o isolamento de homologação e validar build/lint/navegador antes de propor push ou retomar o orçamento anual. A migração de aprovação anônima foi revisada e não aprovada para publicação; permanece local e intacta, junto da outra migração anônima, da alteração de `supabase/config.toml` e do `LEIA-ME.txt` legado. Nenhum SQL remoto foi executado.

Uma cópia privada verificada por SHA-256 preservou as 188 entradas originais mais README, .gitignore e package.json antes da incorporação. Ela está na pasta de entrega deste chat, fora do repositório. Não é um backup integral do banco, dos ignorados ou do histórico Git; esses itens não foram modificados. Não versionar essa cópia.

## Registro de cada entrega

Registrar data, problema, arquivos, decisões, comando e resultado de cada validação, pendências, responsável pela homologação e hash real do commit. Não inserir hash fictício. Após commit, obter `git rev-parse HEAD` e registrar o hash em uma entrega documental subsequente, sem reescrever história compartilhada.

## Roadmap PDCA

1. Consolidação: snapshot, segredos, baseline e checkpoint seletivo.
2. Plan: orçamento integral de 12 meses; comprovar receitas, fixas, variáveis, parcelas e expansão de categorias.
3. Do/Check: execução e comparação com versão aprovada, sem duplicação de transferências/faturas.
4. Action: revisão justificada, concorrência, autor e histórico verificáveis.

Para novo chat: ler este documento, conferir branch/HEAD/status e evidências atuais; distinguir o que foi apenas proposto do que foi aplicado. Manter backups, dados privados e temporários fora dos commits.


## Consolidação final do Chat - 03 — 27/11/2026

Esta seção atualiza o estado da entrega; os registros anteriores são históricos.
Base inspecionada: d9285be5b9401f725300b672170cda08b2999fba, branch codex/ux-review.
Fonte: arquivos locais e Chat - 03 (6b082731-d1c8-83e8-94c1-7ca75f00e92c). Não foi necessário reaplicar ZIP.

### Histórico e homologação visual

- Etapa 7A: prévia do orçamento variável no lançamento, usando o snapshot da Saúde Financeira, categoria raiz e valores registrados. Mostra saldo antes e depois da compra; cartão considera vencimento da fatura. Oculta prévia para parcelamentos, recorrências, fatura não aberta, ausência de orçamento e dados indisponíveis. Cinco testes específicos aprovados.
- Cartões V1.3.6: visão geral com instituições e bandeiras, identificação pelos quatro últimos dígitos, limites e faturas; detalhamento com evolução mensal clicável, pesquisa e ações existentes de pagamento, estorno e edição. Logos bancárias/bandeiras usam fontes externas com fallback textual; dependem de disponibilidade da rede.
- Contas V1: indicadores, cards, detalhamento, gráfico dos últimos oito meses e movimentações mensais. Tabela de saldos iniciais retirada apenas da interface; valor/data continuam no cadastro e no cálculo.
- Contas V1.0.1: correção da propriedade opcional tone após rollback do instalador V1 por TS2375, conforme histórico.
- Contas V1.0.2: sugestões livres de instituição e logos compartilhadas com Cartões, no formulário, cards e detalhe.
- Contas V1.0.3: Ticket, Espécie/Cash e Gift Card no catálogo local de Contas, com três imagens WebP. Não são novos registros inseridos no banco.
- Homologação visual: declarada pelo usuário no Chat - 03 ("a parte visual está fechada"). Responsável: usuário. Esta consolidação inspecionou código e executou verificações locais; não repetiu homologação em navegador nem validou operações no banco.

### Verificações executadas nesta consolidação

- Ambiente real: Node v24.21.0, pnpm disponível 11.25.0; package.json declara pnpm 11.19.0. Nenhuma dependência instalada ou lockfile alterado. Ferramentas locais de node_modules usadas diretamente.
- Testes: node --experimental-strip-types --loader ./scripts/test-resolver.mjs --test, com todos os src/lib/*.test.ts enumerados pelo PowerShell: 58 testes, 41 aprovados e 17 falhas (saída 1). Os cinco testes da Etapa 7A passaram. As falhas estão em budget-dikw, budget-forecast, essential-cash-timeline e financial-health; esses módulos e seus testes não têm alterações locais frente ao HEAD de origem. Não corrigidos nesta tarefa documental/de versionamento.
- Os testes dependem do resolvedor e da alteração de planning.test.ts previamente preparados no índice. Ambos permanecem fora destes commits; o resultado não certifica um checkout isolado sem esse suporte local.
- TypeScript: node_modules/.bin/tsc.cmd --noEmit --pretty false --incremental false: saída 2, 91 diagnósticos. Linhas de diagnóstico idênticas ao log ts-after.txt do backup Contas V1.0.3, sem diferenças. A referência histórica de 90 não representa o estado atual; a origem do diagnóstico adicional frente à auditoria de 24/11 ainda precisa ser investigada. Não houve supressão de erros nem alteração de configuração.
- Build: node_modules/.bin/vite.cmd build: aprovado, saída 0. Compilação local não publica o site e não comprova banco ou tipagem correta.
- git diff --check: aprovado para alterações rastreadas antes da consolidação. Busca heurística nos textos selecionados por chaves privadas, tokens secretos e URLs PostgreSQL com senha: nenhuma ocorrência; não é certificação exaustiva de segurança.
- Lint e navegador não reexecutados. Não reaproveitar os resultados históricos como aprovação desta versão.
- Evidências locais: pasta validacao-20261127 na área de trabalho desta tarefa, fora do repositório, com testes.txt, typescript.txt, build.txt, manifesto.json e script PowerShell autossuficiente CONSOLIDAR.ps1.

### Decisões de versionamento e pendências

- Commit Etapa 7A: de1c0c039616951a0c09292dda50a8345a5a279c.
- Commit Cartões/Contas: 50f78de618e101ed491cc96bb89f54ab2d3a85de. Checkpoint local da interface aprovada; não é release pronta para publicação.
- O commit documental seguinte registra estes hashes sem reescrever os commits. Consultar git log para o hash documental final.
- Preservados fora da seleção: scripts/test-resolver.mjs e src/lib/planning.test.ts (já preparados no índice), supabase/config.toml, todos os backups e as três migrações locais não homologadas: 20261105151000_homologation_financial_health_anonymous_access.sql, 20261119080000_budget_approval_homologation_anon.sql e 20261126153000_credit_cards_last_four_digits.sql.
- Dependência pendente: Cartões e os tipos locais usam credit_cards.last_four_digits. A gravação envia essa coluna inclusive quando vazia; sem a migração correspondente, cadastro/edição pode falhar. O código informa a ausência da coluna. Confirmar esquema e homologar a migração em tarefa própria antes de publicar; sua aplicação não foi presumida nem realizada.
- Resolver as 17 falhas, investigar os 91 diagnósticos, revisar lint, homologar persistência dos cartões e fluxos financeiros/responsivos antes de propor release. Migrações anônimas continuam retidas conforme REVISAO_PRE_PUSH.md.
- README, LEIA-ME e Documento Mestre preservam seu conteúdo anterior por acréscimo. O LEIA-ME legado descreve um pacote antigo; suas instruções de instalação não devem ser reaplicadas para esta consolidação.
- Nenhum push, deploy ou SQL remoto autorizado/executado nesta entrega. Solicitar autorização explícita antes de push/deploy, após apresentar commits e pendências. Não presumir execução de instruções anteriores.

<!-- CHECKPOINT_GESTAO_FAMILIA_20261127_BEGIN -->
## Atualização de continuidade — 27/11/2026

Registro detalhado: [Checkpoint de homologações](CHECKPOINT_HOMOLOGACOES_20261127.md). Consolidado das frentes Etapa 7A, Cartões V1.3.7, Contas V1.0.3, Planejamento/Fluxo de Caixa, Dashboard V1.2.3 e Central de Qualidade V1.0.2.1. O registro distingue aceite visual/funcional de validações técnicas ainda pendentes.

O último HEAD observado em log foi `c36e9b8c90d6b99e623bde02acbe0fe14d51b2e9`, **não necessariamente o HEAD atual**. Conferir Git e baseline antes de novos commits. Evitar alterações automáticas em regras de caixa, parcelamentos, migrações ou dados de homologação.
<!-- CHECKPOINT_GESTAO_FAMILIA_20261127_END -->
