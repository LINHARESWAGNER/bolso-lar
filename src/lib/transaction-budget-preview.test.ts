import { strict as assert } from "node:assert";
import { test } from "node:test";
import { transactionBudgetPreview } from "./transaction-budget-preview.ts";
import type { HealthData } from "./financial-health.ts";

type Input = Parameters<typeof transactionBudgetPreview>[0];
const familyId = "familia-1";
const makeInput = (): Input => ({
  familyId, categoryId: "super", purchaseDate: "2026-11-26", amount: 0,
  paymentMethod: "conta", cardId: null, installments: 1, recurring: false,
  categories: [
    {id:"alimentacao",name:"ALIMENTAÇÃO",parent_id:null,kind:"despesa",family_id:familyId},
    {id:"super",name:"Supermercado",parent_id:"alimentacao",kind:"despesa",family_id:familyId},
    {id:"outro",name:"Outro",parent_id:"alimentacao",kind:"despesa",family_id:familyId},
  ] as Input["categories"],
  cards: [], invoices: [],
  transactions: [
    {id:"a",family_id:familyId,type:"despesa",expense_nature:"variavel",category_id:"super",amount:1000,
     competence_date:"2026-11-10",due_date:"2026-11-10",paid_date:"2026-11-10",status:"pago",invoice_id:null,credit_card_id:null},
    {id:"b",family_id:familyId,type:"despesa",expense_nature:"variavel",category_id:"outro",amount:1043.27,
     competence_date:"2026-11-12",due_date:"2026-11-12",paid_date:null,status:"previsto",invoice_id:null,credit_card_id:null},
  ] as Input["transactions"],
  budgets: ["2026-11", "2026-12", "2027-01"].map(m=>({family_id:familyId,reference_month:`${m}-01`,budget_items:[{category_id:"alimentacao",amount:2000}]})) as HealthData["budgets"],
});

test("conta usa saldo registrado da categoria raiz sem projeções",()=>{
  const input=makeInput();
  const result=transactionBudgetPreview(input);
  assert.equal(result?.month,"2026-11");
  assert.equal(result?.registered,2043.27);
  assert.equal(result?.remaining,-43.27);
  input.amount=50;
  assert.equal(transactionBudgetPreview(input)?.after,-93.27);
});

test("cartão usa vencimento da fatura e ignora projeções",()=>{
  const input=makeInput();
  input.paymentMethod="cartao";input.cardId="card";
  input.cards=[{id:"card",family_id:familyId,closing_day:28,due_day:5}] as Input["cards"];
  input.invoices=[{id:"invoice",family_id:familyId,credit_card_id:"card",reference_month:"2026-11-01",status:"aberta",due_date:"2026-12-05"}] as Input["invoices"];
  // Mês da compra até o fechamento de novembro => fatura vencendo em dezembro.
  assert.equal(transactionBudgetPreview(input)?.month,"2026-12");
  assert.equal(transactionBudgetPreview(input)?.remaining,2000);
});

test("cartão com fatura fechada não antecipa saldo de mês incorreto",()=>{
  const input=makeInput();
  input.paymentMethod="cartao";input.cardId="card";
  input.cards=[{id:"card",family_id:familyId,closing_day:28,due_day:5}] as Input["cards"];
  input.invoices=[{id:"invoice",family_id:familyId,credit_card_id:"card",reference_month:"2026-11-01",status:"fechada",due_date:"2026-12-05"}] as Input["invoices"];
  assert.equal(transactionBudgetPreview(input),null);
});

test("parcelamento, recorrência e ausência de orçamento não produzem saldo enganoso",()=>{
  const input=makeInput();
  input.installments=2;
  assert.equal(transactionBudgetPreview(input),null);
  input.installments=1;input.recurring=true;
  assert.equal(transactionBudgetPreview(input),null);
  input.recurring=false;input.budgets=[];
  assert.equal(transactionBudgetPreview(input),null);
});

test("dezembro usa somente registrado; janeiro não antecipa compras de dezembro",()=>{
  const input=makeInput();
  input.paymentMethod="cartao"; input.cardId="card";
  input.cards=[{id:"card",family_id:familyId,closing_day:20,due_day:5}] as Input["cards"];
  // Compra em 26/11: referência da fatura dezembro, vencimento janeiro.
  assert.equal(transactionBudgetPreview(input)?.month,"2027-01");
  assert.equal(transactionBudgetPreview(input)?.remaining,2000);
  input.cards=[{id:"card",family_id:familyId,closing_day:28,due_day:5}] as Input["cards"];
  input.transactions.push({
    id:"dez",family_id:familyId,type:"despesa",expense_nature:"variavel",category_id:"super",amount:300,
    competence_date:"2026-11-20",due_date:"2026-12-05",paid_date:null,status:"previsto",
    credit_card_id:"card",invoice_id:"inv-dez",
  } as Input["transactions"][number]);
  input.invoices=[{id:"inv-dez",family_id:familyId,credit_card_id:"card",reference_month:"2026-11-01",status:"aberta",due_date:"2026-12-05"}] as Input["invoices"];
  assert.equal(transactionBudgetPreview(input)?.remaining,1700);
});
