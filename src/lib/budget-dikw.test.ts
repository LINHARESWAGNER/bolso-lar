import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildBudgetDIKW, budgetSnapshot, projectBudgetMonth } from "./budget-dikw.ts";
import { DEFAULT_HEALTH_SETTINGS, type HealthData, type HealthPeriod } from "./financial-health.ts";

const month = (m: string): HealthPeriod => {
  const [y, n] = m.split("-").map(Number);
  return { start: `${m}-01`, end: `${m}-${new Date(y, n, 0).getDate()}`, months: 1 };
};
const transaction = (id: string, amount: number, status = "pago", categoryId = "super", date = "2026-10-10", extra = {}) => ({
  id, amount, status, category_id: categoryId, competence_date: date, type: "despesa", expense_nature: "variavel",
  description: id, credit_card_id: null, invoice_id: null, recurring_id: null, ...extra,
});
const budget = (m: string, items: { category_id: string; amount: number }[]) => ({
  reference_month: `${m}-01`, budget_items: items.map((item,i) => ({...item,id:`${m}-${i}`})),
});
const data = (): HealthData => ({
  categories: [
    { id: "alimentacao", name: "Alimentação", parent_id: null, kind: "despesa" },
    { id: "super", name: "Supermercado", parent_id: "alimentacao", kind: "despesa" },
    { id: "transporte", name: "Transporte", parent_id: null, kind: "despesa" },
    { id: "combustivel", name: "Combustível", parent_id: "transporte", kind: "despesa" },
    { id: "terceiros", name: "Compras para terceiros", parent_id: null, kind: "despesa" },
  ] as HealthData["categories"],
  transactions: [], cards: [], invoices: [], assets: [], movements: [], groups: [], essentials: [], debtKinds: [],
  budgets: [] as HealthData["budgets"],
});
const settings = DEFAULT_HEALTH_SETTINGS;

test("pago + previsto entram por competência; cancelado, terceiros, fatura e transferência não entram", () => {
  const d=data();
  d.transactions = [
    transaction("pago",120),transaction("previsto-cartao",80,"previsto","super","2026-10-11",{credit_card_id:"card"}),
    transaction("cancelado",1000,"cancelado"),transaction("terceiros",500,"pago","terceiros"),
    transaction("fatura",200,"pago","super","2026-10-10",{type:"pagamento_fatura"}),
    transaction("transferencia",100,"pago","super","2026-10-10",{type:"transferencia"}),
    transaction("outro-mes",30,"pago","super","2026-09-30"),
  ] as HealthData["transactions"];
  d.budgets=[budget("2026-10",[{category_id:"alimentacao",amount:150}])] as HealthData["budgets"];
  const result=budgetSnapshot(d,month("2026-10"),5);
  assert.equal(result.registered,200);
  assert.equal(result.paid,120);
  assert.equal(result.pending,80);
  assert.equal(result.count,2);
  assert.equal(result.deviation,(200-150)/150*100);
  assert.equal(result.categories[0].difference,50);
});

test("categoria filha soma na raiz; estourada, sem orçamento, sem consumo e sem categoria",()=>{
  const d=data();
  d.budgets=[budget("2026-10",[{category_id:"alimentacao",amount:100},{category_id:"transporte",amount:100}])] as HealthData["budgets"];
  d.transactions=[transaction("super",160),transaction("semcategoria",20,"previsto",null as unknown as string)] as HealthData["transactions"];
  const result=budgetSnapshot(d,month("2026-10"),5);
  assert.equal(result.categories.find(c=>c.name==="Alimentação")?.state,"acima");
  assert.equal(result.categories.find(c=>c.name==="Transporte")?.state,"sem_consumo");
  assert.equal(result.categories.find(c=>c.name==="Sem categoria")?.state,"sem_orcamento");
  assert.equal(result.excessTotal,80);
  assert.equal(result.difference,-20);
  assert.equal(result.outsideCount,2);
});

test("plano de ação quantifica redução líquida sem prometer alterar gasto passado",()=>{
  const d=data();
  d.budgets=[budget("2026-10",[{category_id:"alimentacao",amount:100}])] as HealthData["budgets"];
  d.transactions=[transaction("compra",180)] as HealthData["transactions"];
  const report=buildBudgetDIKW(d,settings,month("2026-10"),month("2026-11"),"2026-11-08");
  assert.equal(report.neededReduction,80);
  assert.equal(report.afterActionsDeviation,0);
  assert.match(report.actions[0].action,/R\$\s*80,00/);
  assert.match(report.actions[0].action,/próximo mês/);
});

test("projeção conta compromissos futuros registrados uma única vez",()=>{
  const d=data();
  d.budgets=[budget("2026-11",[{category_id:"alimentacao",amount:1000}])] as HealthData["budgets"];
  d.transactions=[
    transaction("dia1",100,"pago","super","2026-11-01"),
    transaction("dia3",100,"pago","super","2026-11-03"),
    transaction("dia5",100,"pago","super","2026-11-05"),
    transaction("futuro",120,"previsto","super","2026-11-15"),
  ] as HealthData["transactions"];
  const result=projectBudgetMonth(budgetSnapshot(d,month("2026-11"),5),"2026-11-08");
  assert.equal(result.confidence,"baixa");
  assert.equal(result.recordedFuture,120);
  assert.equal(result.expected, 1125);
  assert.equal(result.remaining,580);
});

test("projeção não inventa números com dados insuficientes",()=>{
  const result=projectBudgetMonth(budgetSnapshot(data(),month("2026-11"),5),"2026-11-03");
  assert.equal(result.confidence,"insuficiente");
  assert.equal(result.expected,null);
});

test("comparação mês anterior e média de três só aparecem com bases completas",()=>{
  const d=data();
  for(const m of ["2026-07","2026-08","2026-09","2026-10"]){
    d.budgets.push(budget(m,[{category_id:"alimentacao",amount:100}]) as HealthData["budgets"][number]);
    d.transactions.push(transaction(m,m==="2026-10"?150:90,"pago","super",`${m}-10`) as HealthData["transactions"][number]);
  }
  const report=buildBudgetDIKW(d,settings,month("2026-10"),month("2026-11"),"2026-11-08");
  assert.equal(report.previous.available,true);
  assert.equal(report.previous.spentChange,60);
  assert.equal(report.averageThree.available,true);
  assert.equal(report.averageThree.spent,90);
  d.budgets=d.budgets.filter(b=>b.reference_month!=="2026-08-01");
  assert.equal(buildBudgetDIKW(d,settings,month("2026-10"),month("2026-11"),"2026-11-08").averageThree.available,false);
});

test("recomendações têm categoria, valores e ação verificável; sem mensagem genérica",()=>{
  const d=data();
  d.budgets=[budget("2026-10",[{category_id:"alimentacao",amount:100}])] as HealthData["budgets"];
  d.transactions=[transaction("a",160)] as HealthData["transactions"];
  const report=buildBudgetDIKW(d,settings,month("2026-10"),month("2026-11"),"2026-11-08");
  for(const item of report.actions){
    assert.ok(item.category);
    assert.ok(item.amount>=0);
    assert.ok(item.effect.includes("R$"));
    assert.doesNotMatch(item.action,/revise os gastos|mantenha o controle/i);
  }
});


test("parcelas nao alimentam extrapolacao proporcional diaria", () => {
  const d = data();

  d.budgets = [
    budget("2026-11", [
      { category_id: "alimentacao", amount: 1000 }
    ])
  ] as HealthData["budgets"];

  d.transactions = [
    transaction("p1", 100, "pago", "super", "2026-11-01", {
      installment_group_id: "grupo1",
      installment_total: 6
    }),
    transaction("p2", 100, "pago", "super", "2026-11-03", {
      installment_group_id: "grupo2",
      installment_total: 6
    }),
    transaction("p3", 100, "pago", "super", "2026-11-05", {
      installment_group_id: "grupo3",
      installment_total: 6
    })
  ] as HealthData["transactions"];

  const snapshot = budgetSnapshot(d, month("2026-11"), 5);
  const result = projectBudgetMonth(snapshot, "2026-11-19");

  assert.equal(snapshot.registered, 300);
  assert.equal(result.averageDaily, 0);
  assert.equal(result.additional, null);
  assert.equal(result.confidence, "insuficiente");
});