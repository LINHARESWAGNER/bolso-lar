# Ajustes: valores, cartões, lançamentos, parcelados, recorrências, fluxo e aparência

## 1. Formatação de centavos (bug)
Hoje o valor digitado é lido removendo os pontos do texto. Ao editar, o campo é preenchido com o número cru do banco (`100.5`), então o ponto é removido no salvamento e 100,50 vira 10.050,00.

- Criar um campo de moeda único (`CurrencyInput`) com máscara pt-BR: digitação por centavos, exibindo sempre `1.234,56`, devolvendo o número correto.
- Usar em: novo lançamento, editar lançamento, recorrências, orçamento, pagamento de fatura, saldo inicial de conta e limite de cartão.
- Ao abrir uma edição, o valor do banco é formatado para pt-BR antes de entrar no campo.

## 2. Menu Cartões
- **Pagar fatura**: diálogo com escolha da conta de débito, valor e data. Bloqueia o pagamento se o saldo da conta for insuficiente. O pagamento gera a saída na conta (saldo atualiza) e marca **todos os lançamentos da fatura como pagos**.
- **Ver fatura**: botão que abre a lista completa dos lançamentos que compõem a fatura (descrição, data, categoria, parcela, valor) com total.
- **Estorno de pagamento**: desfaz o pagamento — remove a saída da conta (saldo volta), a fatura volta para "A pagar" e os lançamentos voltam para previsto/pendente.
- **Separação de faturas**: filtro/abas "A pagar" e "Pagas" por cartão.

## 3. Lista de Lançamentos
- Nova coluna **Cartão** na tabela e novo filtro por cartão.
- Botão direto em cada linha para **Pago/Recebido**, funcionando como alternância (marca e desmarca, limpando a data de pagamento ao desmarcar). Rótulo conforme o tipo.

## 4. Novo menu: Compras parceladas
- Página própria no menu lateral listando os grupos de parcelamento (cartão, descrição, total, nº de parcelas, período, quanto já foi pago), com as parcelas visíveis.
- **Editar** o grupo (descrição, valor total, nº de parcelas, categoria, cartão, data da 1ª parcela, membro) regerando todas as parcelas e realocando nas faturas corretas; parcelas já pagas são preservadas com aviso.
- **Excluir** o grupo remove todas as parcelas.

## 5. Lançamento no Cartão
- Renomear o rótulo "Competência" para **"Dia da compra"** quando o tipo é Cartão.

## 6. Nova recorrência
- **Receita**: esconder o campo Cartão; "Dia do mês (opcional)" vira **Data de recebimento**.
- **Despesa**: obrigatório escolher **Conta ou Cartão**, nunca os dois (seleção mutuamente exclusiva, com validação).
  - Conta: campo renomeado para **Data de vencimento**, obrigatório.
  - Cartão: sem vencimento manual — cada ocorrência entra na fatura conforme o fechamento do cartão, igual às compras no cartão.

## 7. Fluxo de caixa
- Desdobrar as **saídas** em: **Recorrente**, **Pontual**, **Parcelado cartão** e **Orçamento**.
- **Orçamento** entra apenas para meses **posteriores ao mês corrente**, usando o **saldo restante** (planejado menos o já lançado), evitando contagem dupla.
- Tabela e gráfico passam a refletir essa composição; o saldo projetado considera todas as parcelas.

## 8. Aparência
Ampliar a aba Aparência em Configurações:
- Temas prontos (Azul-noite, Grafite, Verde, Roxo, Claro suave).
- Ajustes personalizados: cor de destaque (ícones/botões), cor do texto, cor de fundo e cor dos cartões/superfícies, com pré-visualização.
- Extras: densidade (compacto/confortável) e raio dos cantos.
- Tudo salvo no navegador e aplicado via variáveis do tema, mantendo contraste legível.

## Notas técnicas
- Máscara centralizada em `src/lib/format.ts` + componente `CurrencyInput`.
- Cartões: `payInvoice` reescrita em `src/lib/transactions.ts` (validação de saldo, update em lote da fatura) e nova `reverseInvoicePayment`.
- Parcelados: nova rota `src/routes/_authenticated/parcelados.tsx` + funções de update/delete por `installment_group_id`.
- Fluxo de caixa: helpers em `src/lib/derive.ts` para classificar saídas (recurring_id, installment_group_id, cartão, avulso) e calcular sobra de orçamento por mês.
- Aparência: tokens sobrescritos em runtime no `documentElement` a partir de um provider ampliado (`theme-provider.tsx`), sem cores fixas nos componentes.
- Sem mudanças de banco previstas; o estorno usa os registros existentes de transações e faturas.