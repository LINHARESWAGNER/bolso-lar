# Revisão de migração e testes — 24/11/2026

## Migração de aprovação anônima

Arquivo: `supabase/migrations/20261119080000_budget_approval_homologation_anon.sql`.

**Não aprovada para publicação ou aplicação. Mantida localmente, sem edição e fora do checkpoint.**

O script verifica existência da tabela, RPC e família fixa, mas não verifica o ambiente de destino. Em seguida torna `created_by` anulável, permite SELECT para anon e substitui uma RPC `SECURITY DEFINER` para aceitar anon em uma família fixa. Qualquer cliente com a chave pública do projeto pode aprovar/revisar orçamentos dessa família; RLS por família não autentica o operador. Uma cópia de produção que contenha a família também satisfaria a verificação inicial. Os comentários “homologação somente” não são uma barreira executável.

Há proteções úteis: search_path vazio, validação de categorias da família, controle otimista de versão e bloqueio da família durante a gravação. Elas não eliminam a autorização anônima intencional. A outra migração anônima (`20261105151000...`) possui opt-in explícito por configuração de sessão, mas também será retida para revisar conjuntamente o fluxo de homologação.

Antes de liberar: confirmar histórico de aplicação em cada banco; definir separação verificável de homologação; revisar o modo anônimo no cliente e projeto configurado; testar com usuários de famílias distintas, anon, versão desatualizada e tentativa de alteração do histórico. Não editar retroativamente migração aplicada nem executar SQL remoto nesta consolidação. Se o acesso já estiver ativo em banco compartilhado, uma migração corretiva revisada será necessária; excluir o arquivo do commit não revoga permissões existentes.

## Cinco falhas de teste

| Resultado original | Causa identificada | Decisão |
|---|---|---|
| budget-dikw.test.ts não carregava | Import relativo sem extensão em dependência | Usar resolvedor local de testes, sem mudar imports da aplicação |
| budget-forecast.test.ts não carregava | Mesmo mecanismo de resolução | Mesmo tratamento |
| essential-cash-timeline.test.ts não carregava | Import relativo sem extensão | Mesmo tratamento |
| financial-health.test.ts não carregava | Import relativo sem extensão em dependência | Mesmo tratamento |
| planning: parcelas no ano | Expectativa 3500 descontava novamente 500 já incluídos em variável=2000 | Corrigir expectativa para 4000, preservando o cálculo |

A tela de planejamento explicita “Variáveis (inclui parcelas)” e “Parcelas variáveis já estão incluídas nos limites das categorias”. A função calcula `income - fixed - variable`. No cenário do teste: 10000 - 4000 - 2000 = 4000; `installments=500` é informação de comprometimento, não nova despesa a somar. O teste deve proteger essa regra de não duplicação. Não foi modificado código de negócio.

Diagnóstico antes da correção da expectativa: 53 testes executados com resolvedor, 52 aprovados, uma falha. O resolvedor só tenta extensões TypeScript para imports relativos não encontrados e só é carregado pelo comando de teste; não participa da aplicação. Comando reproduzível (Node 24.21.0, sem instalar dependências):

```powershell
$testFiles = @(Get-ChildItem src/lib -Filter '*.test.ts' | ForEach-Object { $_.FullName })
node --experimental-strip-types --loader ./scripts/test-resolver.mjs --test @testFiles
if ($LASTEXITCODE -ne 0) { throw 'Testes falharam.' }
```

Node pode emitir aviso experimental do loader; isso não é falha de teste. Resultados finais e comparação TypeScript serão registrados no documento mestre/histórico. Aprovação dos testes unitários não comprova navegador, build nem segurança do banco.

## Condições antes de push

Revisão solicitada concluída no código local; **push não autorizado por este documento**. Resolver retenções de ambiente e SQL, conferir diff dos commits e dados privados, validar build/lint/fluxos críticos e histórico de migrações. Os commits de checkpoint preservam trabalho, não declaram uma release homologada.
