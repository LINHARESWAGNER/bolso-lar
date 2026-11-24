# Auditoria Git — 24/11/2026

## Evidências e alcance

Anexo original recuperado do chat e comparado com `git status --porcelain --untracked-files=all` no repositório real. Branch `codex/ux-review`; HEAD `abdd940cefe2f776cf47fb5cccfc3e6bb2b813de`, de 04/11/2026. Índice vazio no diagnóstico. Não houve staging, commit, push, exclusão, restauração, reset ou migração. Revisão de inventário e pontos críticos; não equivale a revisão funcional integral dos 188 arquivos.

| Grupo | Quantidade | Tratamento |
|---|---:|---|
| Rastreado modificado | 21 | Revisão individual; 20 em src e configuração Supabase |
| Código/testes novos | 18 | Candidatos; conferir imports e dependências |
| Migrações novas | 7 | Revisão SQL e separação de homologação |
| Backups não rastreados | 132 | Preservar no disco; excluir da seleção |
| supabase/.temp | 9 | Preservar localmente; não versionar |
| LEIA-ME.txt | 1 | Revisão editorial e de dados antes de selecionar |
| Total | 188 | 21 rastreados + 167 não rastreados |

Diff rastreado: 2.782 inserções e 560 remoções. Avisos LF/CRLF são conversão de finais de linha; não normalizar o repositório nesta etapa.

## Segredos e ambiente

A busca heurística nos 46 candidatos não encontrou padrões de chave `sb_secret_` com valor, chave privada PEM, URI PostgreSQL com senha ou JWT longo. Isso não certifica ausência de segredos, dados pessoais, tokens com outros formatos ou segredos no histórico. Não foram exibidos conteúdos de `.env.local`, dumps ou `.temp`.

`.env.local` e `.migration-backups/` já estão ignorados, assim como dependências e saídas de build. Existem nomes de dumps de produção entre os ignorados: tratá-los como dados privados. O relatório bruto inclui um inventário enorme de dependências e nomes privados; não adicioná-lo automaticamente ao Git.

`supabase/.temp` não está rastreado. `.gitignore` atual não cobre esses temporários, os diretórios `backup-*`, `_backup*` nem os `.bak*` dentro de src. Ignorar não apaga arquivos e não remove arquivos já rastreados.

`supabase/config.toml` troca o projeto de destino. Não é uma senha, mas uma mudança operacional que exige confirmar homologação antes de qualquer comando remoto. Deixar fora do checkpoint inicial.

`src/integrations/supabase/client.ts` adiciona o modo `VITE_HOMOLOGATION_BYPASS_AUTH`, desativando persistência/renovação de sessão. A função preexistente aceita prefixo `sb_secret_`: revisar configuração e garantir que nenhuma chave privilegiada alcance o navegador. Não foi comprovada presença de uma chave secreta.

## Migrações

| Arquivo | Revisão necessária |
|---|---|
| 20261105140000_financial_health.sql | Esquema, RLS, funções e isolamento entre famílias |
| 20261105150000_fix_financial_health_validation_triggers.sql | Dependência da anterior e comportamento dos triggers |
| 20261105151000_homologation_financial_health_anonymous_access.sql | Possui trava `app.homologation_bypass_auth = on`; libera CRUD anon para família fixa quando ativada |
| 20261105160000_financial_health_installments_and_essential_inheritance.sql | Parcelas, herança e compatibilidade dos dados existentes |
| 20261110231000_recurring_explicit_continuation.sql | Continuidade de recorrências e integridade dos vínculos |
| 20261118234500_budget_plan_save_and_action.sql | RPC, concorrência, RLS e histórico de versões |
| 20261119080000_budget_approval_homologation_anon.sql | **Reter:** permite RPC anon, autor nulo e leitura da família fixa, sem trava explícita de ambiente equivalente à migração anterior |

A última verifica existência de família e função; isso não prova que o banco seja de homologação. Comentários não impedem execução em produção. Separar scripts de homologação do fluxo automático ou adicionar proteção verificável em tarefa futura revisada. Não alterar migrações já aplicadas sem verificar o histórico do banco. Nenhuma situação de aplicação remota foi verificada.

## Plano seguro

1. Preservar snapshot privado integral, incluindo ignorados e backups, com espaço suficiente e verificação da cópia. Git seletivo não preserva esses arquivos por si só.
2. Propor regras específicas de ignore e documentação. Revisar antes de adicionar.
3. Revisar código e SQL por dependência; não inventar commits históricos a partir de backups. Se as mudanças estiverem acopladas, usar um checkpoint local explicitamente não homologado, após revisão, em vez de dividir arbitrariamente.
4. Separar mudanças de ambiente e acesso anônimo. Se sua exclusão deixar o código dependente delas, adiar o checkpoint funcional e registrar a dependência.
5. Validar baseline, testes e comportamento; revisar o conteúdo completo do índice antes de commit. Push permanece fora deste procedimento.

Regras propostas para acrescentar ao `.gitignore`, preservando o conteúdo existente:

```gitignore
/backup-*/
/_backup*/
*.bak
*.bak-*
/supabase/.temp/
```

Não usar `git add .`, `git add -A`, `git commit -a`, `git clean`, stash, reset ou restore como atalhos de organização.
