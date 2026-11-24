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
