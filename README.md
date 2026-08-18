# My Family Finances

PROJETO — Sistema de Gestão Financeira Familiar

Desenvolva uma aplicação web responsiva de Gestão Financeira Familiar, moderna, simples e intuitiva, com foco em controle financeiro, orçamento familiar, cartões de crédito, contas bancárias e visão consolidada das finanças da família.

O sistema deve ser pensado para uso real e contínuo, portanto desenvolva uma arquitetura organizada, modular e preparada para futuras evoluções.

1. OBJETIVO

O usuário deve conseguir responder rapidamente:

Quanto dinheiro temos?

Quanto recebemos no mês?

Quanto gastamos no mês?

Quanto ainda temos para pagar?

Quanto temos para receber?

Quanto podemos gastar?

Onde estamos gastando mais?

Como está nosso orçamento?

Como estão nossos cartões?

Quanto da renda já está comprometida?

Qual será nossa situação financeira nos próximos meses?

A aplicação deve diferenciar corretamente:

Receita

Despesa

Transferência entre contas

Compra no cartão

Pagamento de fatura

Movimentação patrimonial

Transferências e pagamentos de faturas não podem gerar duplicidade de receitas ou despesas.

2. ESTRUTURA FAMILIAR

Criar o conceito de Família.

Uma família poderá possuir vários membros.

Exemplo:

Família Linhares

Wagner

Esposa

Filho 1

Filho 2

Cada movimentação poderá opcionalmente ser vinculada a um membro da família.

Preparar a estrutura para futuramente permitir múltiplos usuários acessando a mesma família.

3. DASHBOARD

Criar uma página inicial com visão consolidada do mês selecionado.

No topo, permitir selecionar:

mês

ano

Criar cards para:

Saldo atual

Soma dos saldos das contas consideradas no caixa.

Receitas do mês

Total de receitas.

Despesas do mês

Total de despesas.

Resultado do mês

Receitas - Despesas.

Contas a pagar

Despesas pendentes.

Contas a receber

Receitas pendentes.

Cartão de crédito

Valor total das faturas abertas.

Orçamento disponível

Orçamento mensal - despesas realizadas/comprometidas.

Também apresentar:

evolução de receitas e despesas;

despesas por categoria;

orçamento x realizado;

maiores despesas;

próximos vencimentos;

situação dos cartões;

últimas movimentações.

O dashboard deve priorizar informação útil e evitar excesso de elementos visuais.

4. CONTAS FINANCEIRAS

Criar cadastro de contas.

Tipos:

Conta corrente

Conta digital

Poupança

Dinheiro

Carteira

Conta investimento

Outros

Campos:

Nome

Instituição

Tipo

Saldo inicial

Data do saldo inicial

Cor/ícone

Ativa/inativa

Considerar no saldo disponível

Observação

O saldo atual deve ser calculado a partir do saldo inicial + movimentações.

Nunca utilizar um saldo digitado manualmente como fonte principal depois que a conta começar a possuir movimentações.

5. PLANO DE CONTAS / CATEGORIAS

Criar categorias hierárquicas.

Exemplo:

DESPESAS

Moradia

Aluguel

Condomínio

Energia

Água

Internet

Manutenção

Alimentação

Supermercado

Restaurante

Delivery

Transporte

Combustível

Manutenção

Seguro

Aplicativos

Estacionamento

Saúde

Plano de saúde

Farmácia

Consultas

Educação

Escola

Cursos

Material escolar

Lazer

Viagens

Cinema

Passeios

Assinaturas

Streaming

Aplicativos

Serviços

RECEITAS

Salário

Pró-labore

Freelance

Rendimentos

Aluguéis

Outras receitas

Permitir ao usuário:

criar;

editar;

excluir;

ativar/desativar;

criar categorias e subcategorias.

6. LANÇAMENTOS

Esta será uma das telas principais.

Criar cadastro de movimentação contendo:

Descrição

Tipo

Categoria

Subcategoria

Valor

Data de competência

Data de vencimento

Data de pagamento/recebimento

Conta

Membro da família

Status

Observação

Tags

Tipos:

Receita

Despesa

Transferência

Status:

Previsto

Pendente

Pago/Recebido

Atrasado

Cancelado

Permitir:

criar;

editar;

excluir;

duplicar;

marcar como pago;

filtros;

pesquisa;

ordenação.

Filtros importantes:

período;

conta;

categoria;

membro;

status;

receita/despesa.

7. LANÇAMENTOS RECORRENTES

Permitir cadastrar despesas e receitas recorrentes.

Exemplos:

salário;

aluguel;

condomínio;

escola;

internet;

academia;

assinaturas.

Periodicidades:

semanal;

mensal;

bimestral;

trimestral;

semestral;

anual.

Campos:

data inicial;

data final opcional;

quantidade de ocorrências opcional.

O sistema deverá gerar as ocorrências sem perder o vínculo com a recorrência original.

Editar uma ocorrência não deve obrigatoriamente alterar todas as demais.

8. PARCELAMENTOS

Permitir lançar despesas parceladas.

Exemplo:

Notebook
R$ 6.000
10 parcelas

Gerar:

1/10 — R$ 600
2/10 — R$ 600
...
10/10 — R$ 600

Guardar um identificador do parcelamento para relacionar todas as parcelas.

Permitir visualizar o total da compra, parcelas pagas e parcelas restantes.

9. CARTÕES DE CRÉDITO

Criar módulo específico para cartões.

Cadastro:

Nome

Instituição

Bandeira

Limite

Dia de fechamento

Dia de vencimento

Conta utilizada para pagamento

Ativo/inativo

Exibir:

limite total;

limite utilizado;

limite disponível;

próxima fatura;

compras futuras.

Compras

Permitir cadastrar:

descrição;

categoria;

valor;

data;

cartão;

quantidade de parcelas;

membro;

observação.

Regra essencial

A despesa deve ser reconhecida pela compra.

O pagamento da fatura não deve gerar uma segunda despesa.

Pagamento da fatura representa movimentação financeira entre a conta bancária e a obrigação do cartão.

Criar estrutura de:

Cartão → Fatura → Compras → Parcelas.

Determinar automaticamente em qual fatura uma compra deverá entrar considerando a data de fechamento.

10. TRANSFERÊNCIAS

Transferências entre contas próprias não são receitas nem despesas.

Exemplo:

Nubank → Itaú
R$ 2.000

Resultado:

Nubank: -R$ 2.000
Itaú: +R$ 2.000

Resultado financeiro familiar: R$ 0.

As duas movimentações devem permanecer relacionadas para que editar/excluir uma transferência mantenha a consistência.

11. ORÇAMENTO MENSAL

Permitir criar orçamento por categoria.

Exemplo:

CategoriaOrçamentoMoradiaR$ 3.000AlimentaçãoR$ 2.000TransporteR$ 1.000LazerR$ 800

Apresentar:

orçamento;

realizado;

comprometido;

disponível;

percentual consumido.

Utilizar indicadores visuais para destacar categorias próximas ou acima do orçamento.

Permitir copiar o orçamento do mês anterior.

12. CALENDÁRIO FINANCEIRO

Criar visualização mensal em calendário.

Mostrar nos dias:

receitas;

despesas;

vencimentos;

faturas;

pagamentos.

Ao clicar em um dia, mostrar os lançamentos correspondentes.

Diferenciar visualmente:

pago;

pendente;

atrasado;

receita;

despesa.

13. FLUXO DE CAIXA

Criar uma tela de projeção financeira.

Apresentar:

Saldo inicial

Receitas previstas

Despesas previstas
= Saldo projetado

Permitir projeção dos próximos:

30 dias;

60 dias;

90 dias;

6 meses;

12 meses.

Considerar:

lançamentos futuros;

recorrências;

parcelas;

faturas;

receitas previstas.

14. RELATÓRIOS

Criar inicialmente:

Receitas x Despesas

Por mês.

Despesas por categoria

Despesas por membro

Despesas por conta

Evolução mensal

Orçamento x Realizado

Gastos com cartão

Permitir selecionar período.

15. REGRAS DE DATA

Guardar separadamente:

Data de competência
Quando aquela receita/despesa pertence economicamente.

Data de pagamento
Quando ocorreu efetivamente a entrada ou saída do dinheiro.

Não tratar essas datas como sendo necessariamente iguais.

Essa diferenciação será necessária para relatórios por competência e fluxo de caixa.

16. MODELO DE DADOS

Estruture o banco de dados de maneira relacional e normalizada.

Entidades principais sugeridas:

users

families

family_members

accounts

categories

transactions

recurring_transactions

installment_groups

credit_cards

credit_card_invoices

credit_card_purchases

credit_card_installments

budgets

budget_items

tags

transaction_tags

Utilizar UUIDs como identificadores.

Adicionar:

created_at

updated_at

onde for apropriado.

Utilizar relacionamentos e constraints para garantir integridade dos dados.

Evitar duplicação desnecessária de informações.

17. INTERFACE

Quero uma interface moderna de aplicativo financeiro.

Layout desktop:

Menu lateral esquerdo.

Itens:

Dashboard

Lançamentos

Contas

Cartões

Orçamento

Calendário

Fluxo de Caixa

Relatórios

Configurações

No mobile utilizar navegação adaptada.

Utilizar:

cards;

tabelas;

gráficos;

modais/drawers;

filtros;

indicadores de status;

ícones consistentes.

A interface deve ser limpa, profissional e minimalista.

Não quero aparência de planilha Excel.

Utilizar formatação monetária brasileira:

R$ 1.234,56

Datas:

DD/MM/AAAA

Idioma inicial:

Português do Brasil.

18. EXPERIÊNCIA DE USO

Priorizar velocidade no lançamento das informações.

Criar botão destacado:

+ Novo lançamento

O usuário deve conseguir cadastrar uma despesa rapidamente sem navegar por várias telas.

Utilizar autocomplete/combobox para:

categorias;

contas;

cartões;

membros.

Depois de selecionar uma categoria utilizada anteriormente para uma descrição semelhante, preparar a arquitetura para futuramente sugerir automaticamente essa categoria.

19. RESPONSIVIDADE

A aplicação deve funcionar corretamente em:

desktop;

notebook;

tablet;

celular.

No celular, priorizar:

saldo;

lançamentos;

novo lançamento;

orçamento;

cartões.

20. SEGURANÇA E DADOS

Os dados de uma família nunca devem ficar acessíveis para usuários pertencentes a outra família.

Implementar autenticação e autorização adequadas.

Caso utilize Supabase, criar as políticas RLS necessárias.

Não confiar apenas em filtros do frontend para isolamento dos dados.

21. ARQUITETURA PARA EVOLUÇÃO

Preparar a aplicação para posteriormente receber módulos de:

Patrimônio

Investimentos

Financiamentos

Dívidas

Metas financeiras

Reserva de emergência

Importação de OFX

Importação de CSV/Excel

Conciliação bancária

Open Finance

Análise automática de gastos

Alertas

Inteligência financeira

Aplicativo/PWA

Não é necessário desenvolver todos esses módulos agora.

Apenas evite decisões arquiteturais que dificultem adicioná-los posteriormente.

22. ESCOPO DA PRIMEIRA ENTREGA

Implemente primeiro uma V1 realmente funcional contendo:

Autenticação

Família

Membros

Contas

Categorias

Lançamentos

Transferências

Recorrências

Parcelamentos

Cartões e faturas

Orçamento mensal

Dashboard

Calendário financeiro

Fluxo de caixa

Relatórios básicos

Não crie apenas telas estáticas ou dados mockados.

Quero que cadastros e movimentações estejam conectados ao banco de dados e que os indicadores sejam calculados a partir dos dados reais cadastrados.

23. ORDEM DE IMPLEMENTAÇÃO

Antes de começar a criar componentes isolados:

Analise estes requisitos.

Defina o modelo de dados.

Defina os relacionamentos.

Crie autenticação e estrutura da família.

Implemente contas e categorias.

Implemente o motor de lançamentos.

Implemente transferências, recorrências e parcelamentos.

Implemente cartões/faturas.

Implemente orçamento.

Construa dashboard, calendário, fluxo de caixa e relatórios sobre o modelo já funcional.

Não altere regras financeiras para simplificar a implementação sem informar.

Quando existir ambiguidade em uma regra financeira importante, me pergunte antes de assumir uma regra.

O objetivo é criar a base de um sistema de gestão financeira familiar robusto, e não apenas um protótipo visual.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/893278bd-5596-43d1-8352-4b6f3bc41b7d).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
