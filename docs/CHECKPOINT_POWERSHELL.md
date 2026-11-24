# Checkpoint Git seletivo — PowerShell

Execute os blocos separadamente, após ler seus resultados. Os comandos abaixo são instruções, não foram executados para fazer commit. Feche editores/processos que gravem arquivos durante snapshot, validação e staging. Nenhum bloco envia push ou aplica SQL.

## 1. Conferir o ponto de partida

```powershell
$ErrorActionPreference = 'Stop'
$repoCheckpoint = 'C:\Users\wagne\OneDrive\Documentos\GitHub\Gestor Financeiro'
$entregaCheckpoint = 'C:\Users\wagne\OneDrive\Documentos\ChatGPT\Site de Gestão Financeira'
Set-Location -LiteralPath $repoCheckpoint
function Git-Check {
    param([string[]]$Arguments)
    $result = & git @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Git falhou: $($Arguments -join ' ')" }
    $result
}
if ((Git-Check @('branch','--show-current')) -ne 'codex/ux-review') {
    throw 'Branch diferente: revisar antes de continuar.'
}
$headCheckpoint = Git-Check @('rev-parse','HEAD')
if ($headCheckpoint -ne 'abdd940cefe2f776cf47fb5cccfc3e6bb2b813de') {
    throw 'HEAD mudou desde a auditoria. Atualize a revisão.'
}
if (@(Git-Check @('diff','--cached','--name-only')).Count) {
    throw 'Já há conteúdo preparado. Revisar sem resetar o índice.'
}
Git-Check @('status','--short','--untracked-files=all')
```

## 2. Preservar cópia privada integral

A cópia contém `.git`, ambientes, dados ignorados e backups: não enviar ao GitHub nem compartilhar. Confirmar espaço em disco. Usar destino novo fora do repositório; não usar `/MIR`, `/PURGE` ou `/MOVE`. A cópia abaixo preserva arquivos comuns e verifica SHA-256; interrompe se houver links/junções para revisão manual. Uma cópia no mesmo disco não substitui backup externo protegido.

```powershell
$snapshotCheckpoint = Join-Path $env:LOCALAPPDATA ('GestorFinanceiro-checkpoints\' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
if (Test-Path -LiteralPath $snapshotCheckpoint) { throw 'Destino já existe.' }
$linksCheckpoint = @(Get-ChildItem -LiteralPath $repoCheckpoint -Force -Recurse -Attributes ReparsePoint)
if ($linksCheckpoint.Count) { throw 'Há links/junções ou arquivos de nuvem: revisar cópia e disponibilidade antes de prosseguir.' }
New-Item -ItemType Directory -Path $snapshotCheckpoint | Out-Null
& robocopy $repoCheckpoint $snapshotCheckpoint /E /COPY:DAT /DCOPY:DAT /R:1 /W:1 /XJ /NFL /NDL /NP
if ($LASTEXITCODE -ge 8) { throw 'Falha na cópia; preservar destino e investigar.' }
$sourceCheckpoint = @(Get-ChildItem -LiteralPath $repoCheckpoint -File -Force -Recurse)
foreach ($itemCheckpoint in $sourceCheckpoint) {
    $relativeCheckpoint = $itemCheckpoint.FullName.Substring($repoCheckpoint.Length).TrimStart('\')
    $targetCheckpoint = Join-Path $snapshotCheckpoint $relativeCheckpoint
    if (!(Test-Path -LiteralPath $targetCheckpoint)) { throw "Arquivo ausente: $relativeCheckpoint" }
    if ((Get-FileHash -LiteralPath $itemCheckpoint.FullName).Hash -ne (Get-FileHash -LiteralPath $targetCheckpoint).Hash) {
        throw "Cópia divergente: $relativeCheckpoint"
    }
}
Write-Host 'Snapshot verificado. Manter privado.'
```

## 3. Incorporar documentação e ignore, sem sobrescrever

Revisar `README_ADICAO.md`, os três documentos desta entrega e as regras propostas em `AUDITORIA_GIT.md`. Fazer a incorporação manual preservando o README existente. Se algum documento já existir, comparar e mesclar, nunca substituir automaticamente. Não copiar inventários ou logs brutos para o Git sem revisão de dados pessoais. Depois executar:

```powershell
Git-Check @('diff','--','README.md','.gitignore','docs')
Git-Check @('ls-files','supabase/.temp/*','*.bak','*.bak-*')
# O comando abaixo deve mostrar a regra aplicada; se faltar regra, revisar .gitignore.
& git check-ignore -v -- supabase/.temp/pooler-url src/lib/derive.ts.bak backup-essenciais/alerta-mes-atual-20261112-133730.tsx.bak
```

## 4. Validar TypeScript e testes

Não instalar/atualizar dependências para forçar uma baseline. Guardar logs fora do repositório. A medição histórica de 90 precisa ser comparada com o resultado atual; se divergir, registrar e investigar, sem substituir silenciosamente a referência.

```powershell
$validacaoCheckpoint = Join-Path $snapshotCheckpoint 'validacao'
New-Item -ItemType Directory -Path $validacaoCheckpoint | Out-Null
& node --version
& .\node_modules\.bin\tsc.cmd --version
$tsCheckpoint = @(& .\node_modules\.bin\tsc.cmd --noEmit --pretty false --incremental false 2>&1)
$tsExitCheckpoint = $LASTEXITCODE
$tsCheckpoint | Set-Content -LiteralPath (Join-Path $validacaoCheckpoint 'typescript.txt') -Encoding UTF8
$diagnosticosCheckpoint = @($tsCheckpoint | ForEach-Object { "$_" } | Where-Object { $_ -match 'error TS\d+' })
Write-Host "TypeScript: exit=$tsExitCheckpoint; erros=$($diagnosticosCheckpoint.Count); referência histórica=90"
if ($diagnosticosCheckpoint.Count -ne 90) { Write-Warning 'Baseline divergente. Revisão necessária.' }
$testesCheckpoint = @(Get-ChildItem src/lib -Filter '*.test.ts' | ForEach-Object { $_.FullName })
& node --experimental-strip-types --test @testesCheckpoint *> (Join-Path $validacaoCheckpoint 'testes.txt')
Write-Host "Testes: exit=$LASTEXITCODE"
# Executar build/lint apenas após revisar seus efeitos e a configuração de ambiente.
# pnpm build
# pnpm lint
```

Para mudanças futuras, comparar diagnósticos normalizados por arquivo/código/mensagem com a baseline capturada, preservando multiplicidade. Contagem igual não é prova de ausência de regressão. Registrar separadamente falha de carregamento, asserção, compilação e execução. Checkpoint com falhas conhecidas é marco de preservação, não release homologada.

## 5. Criar lista explícita e revisar segredos

`candidatos-revisao.txt` contém 46 caminhos observados, inclusive itens retidos: **não usá-lo diretamente em git add**. Criar `selecionados.txt` nesta pasta de entrega com um caminho relativo literal por linha, somente após revisão. Para primeiro commit documental, selecionar apenas README, .gitignore e documentos incorporados. Para código, revisar dependências com as migrações. Não incluir config de ambiente ou migrações anônimas até resolver os achados.

```powershell
$manifestoCheckpoint = Join-Path $entregaCheckpoint 'selecionados.txt'
if (!(Test-Path -LiteralPath $manifestoCheckpoint)) { throw 'Criar a lista de arquivos revisados antes de continuar.' }
$selecionadosCheckpoint = @(Get-Content -LiteralPath $manifestoCheckpoint | Where-Object { $_.Trim() } | Sort-Object -Unique)
if (!$selecionadosCheckpoint.Count) { throw 'Lista vazia.' }
$hashesCheckpoint = @{}
foreach ($pathCheckpoint in $selecionadosCheckpoint) {
    if ($pathCheckpoint -match '(^|[/\\])(_?backup[^/\\]*|\.temp|\.git|node_modules|\.migration-backups|\.output|dist)([/\\]|$)|\.bak|(^|[/\\])\.env|\.log$|^/|:|\*|\?|(^|[/\\])\.\.([/\\]|$)') {
        throw "Caminho proibido ou não literal: $pathCheckpoint"
    }
    if ($pathCheckpoint -match '^supabase/config\.toml$|homologation.*(?:anon|anonymous)') {
        throw "Item retido pela auditoria: $pathCheckpoint"
    }
    $fullCheckpoint = [IO.Path]::GetFullPath((Join-Path $repoCheckpoint $pathCheckpoint))
    if (!$fullCheckpoint.StartsWith($repoCheckpoint + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Fora do repositório.' }
    if (!(Test-Path -LiteralPath $fullCheckpoint -PathType Leaf)) { throw "Não é arquivo: $pathCheckpoint" }
    $hashesCheckpoint[$pathCheckpoint] = (Get-FileHash -LiteralPath $fullCheckpoint).Hash
    $textCheckpoint = [IO.File]::ReadAllText($fullCheckpoint)
    if ($textCheckpoint -match 'sb_secret_[A-Za-z0-9]+|-----BEGIN .*PRIVATE KEY|postgres(?:ql)?://[^\s]+:[^\s]+@|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+') {
        throw "Possível segredo em $pathCheckpoint; revisar localmente sem colar o valor."
    }
}
Git-Check (@('diff','--') + $selecionadosCheckpoint)
# Abrir também cada arquivo novo no editor: git diff não mostra untracked.
# Revisar senhas, tokens, dados financeiros, nomes/IDs privados, seeds e SQL.
# Chaves publishable não são service_role. Variáveis VITE_* chegam ao navegador.
```

A busca é heurística. Revisão manual de todo o conteúdo selecionado continua necessária. Se um segredo já tiver sido publicado, retirar do próximo diff não resolve a exposição; planejar rotação e revisão do histórico sem reescrevê-lo nesta tarefa.

## 6. Preparar apenas os arquivos aprovados

```powershell
if ((Read-Host 'Após revisar conteúdo, segredos e validações, digite PREPARAR') -cne 'PREPARAR') { throw 'Interrompido sem staging.' }
if ((Git-Check @('rev-parse','HEAD')) -ne $headCheckpoint) { throw 'HEAD mudou.' }
if (@(Git-Check @('diff','--cached','--name-only')).Count) { throw 'Índice deixou de estar vazio.' }
foreach ($pathCheckpoint in $selecionadosCheckpoint) {
    if ((Get-FileHash -LiteralPath (Join-Path $repoCheckpoint $pathCheckpoint)).Hash -ne $hashesCheckpoint[$pathCheckpoint]) { throw "Arquivo mudou: $pathCheckpoint" }
}
Git-Check (@('--literal-pathspecs','add','--') + $selecionadosCheckpoint)
$stagedCheckpoint = @(Git-Check @('-c','core.quotePath=false','diff','--cached','--name-only'))
if (!$stagedCheckpoint.Count) { throw 'Nenhuma mudança selecionada.' }
foreach ($pathCheckpoint in $stagedCheckpoint) {
    if ($pathCheckpoint -notin $selecionadosCheckpoint) { throw "Arquivo inesperado no índice: $pathCheckpoint" }
}
Git-Check @('diff','--cached','--check')
Git-Check @('diff','--cached','--stat')
Git-Check @('diff','--cached','--')
Git-Check @('status','--short')
```

Se qualquer verificação falhar após staging, parar e preservar o índice para revisão; não executar reset/restore automaticamente. Os arquivos excluídos da lista devem continuar locais e visíveis ou ignorados conforme as regras revisadas.

## 7. Commit local, somente após revisar o índice completo

Executar este bloco na mesma sessão apenas quando todas as diferenças acima estiverem aprovadas. Se algo mudar, repetir revisão e validação. Não usar `--no-verify` para contornar hooks.

```powershell
$treeCheckpoint = Git-Check @('write-tree')
if ((Read-Host 'Índice revisado e limitações documentadas? Digite COMMIT LOCAL') -cne 'COMMIT LOCAL') { throw 'Sem commit.' }
if ((Git-Check @('write-tree')) -ne $treeCheckpoint) { throw 'Índice mudou durante a confirmação.' }
if ((Git-Check @('rev-parse','HEAD')) -ne $headCheckpoint) { throw 'HEAD mudou.' }
$mensagemCheckpoint = Read-Host 'Mensagem do commit (ex.: docs: registrar auditoria e continuidade PDCA)'
if ([string]::IsNullOrWhiteSpace($mensagemCheckpoint)) { throw 'Mensagem vazia.' }
Git-Check @('commit','-m',$mensagemCheckpoint)
Git-Check @('log','-1','--format=%H%n%s')
Git-Check @('show','--stat','--oneline','HEAD')
Git-Check @('status','--short','--untracked-files=all')
```

Conferir também o conteúdo final caso hooks tenham modificado arquivos. Registrar hash e resultado no histórico de continuidade em commit documental posterior. Não fazer amend, push ou aplicar migrações neste procedimento. Manter snapshot e backups intactos.
