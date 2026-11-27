/**
 * Fonte compartilhada da apuracao de caixa: Planejamento 4. Resultados e Fluxo de Caixa.
 * Valores monetarios retornados em CENTAVOS, conforme PlanModeloA homologado.
 * Este modulo extrai, sem alterar, a rotina que residia em plan-modelo-a.tsx.
 */
import { isThirdPartyTransaction } from "@/lib/derive";
import { brl } from "@/lib/format";
import type { Tables } from "@/integrations/supabase/types";

type Tx = Tables<"transactions"> & { deleted_at?: string | null };
export type CashEvent = { date: string; value: number; label: string; kind: "receita" | "direta" | "fatura" | "transferencia" | "abertura"; account: string | null; third: boolean; actual: boolean; restricted: boolean; uncertain?: boolean; nature?: string | null; installment?: boolean; category?: string; unallocated?: boolean; txId?: string; invoiceId?: string | null };
type Event = CashEvent;
const cents = (n: number) => Math.round(Number(n) * 100);
const money = (n: number) => brl(n / 100);
const sum = (events: Event[]) => events.reduce((s, e) => s + e.value, 0);
const shift = (key: string, n: number) => { const y = Number(key.slice(0, 4)), m = Number(key.slice(5, 7)); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2, "0")}`; };

type CashModelInput = {
  accounts: Tables<"accounts">[];
  cards: Tables<"credit_cards">[];
  invoices: Tables<"credit_card_invoices">[];
  categories: Tables<"categories">[];
  transactions: Tx[];
  budgets: (Tables<"budgets"> & {budget_items: Tables<"budget_items">[]})[];
  family: string | null | undefined;
  today: string;
  now: string;
};

export function buildCashResultsModel(input: CashModelInput) {
 const {family, today, now} = input;
 const qa = {data:input.accounts}, qc={data:input.cards}, qi={data:input.invoices};
 const qcat={data:input.categories}, qt={data:input.transactions}, qb={data:input.budgets};

    const accounts = (qa.data ?? []).filter(a=>a.family_id===family && a.is_active && a.include_in_cash);
    const allAccounts = (qa.data ?? []).filter(a=>a.family_id===family);
    const accountById = new Map(allAccounts.map(a=>[a.id,a]));
    const cards = (qc.data ?? []).filter(c=>c.family_id===family);
    const invoices = (qi.data ?? []).filter(f=>f.family_id===family);
    const categories = (qcat.data ?? []).filter(c=>c.family_id===family);
    const tx = (qt.data ?? []).filter(t=>t.family_id===family && !t.deleted_at && t.status!=="cancelado");
    const events: Event[] = [];
    const warnings: string[] = [];
    const invoiceIds = new Set(invoices.map(f=>f.id));
    const root = (id: string | null) => { const c = categories.find(x=>x.id===id); return c?.parent_id ?? c?.id ?? "sem-categoria"; };
    const third = (t: Tx) => isThirdPartyTransaction(categories,t);
    const restricted = (id:string|null) => {const a = id ? accountById.get(id) : undefined; return !!a && a.type==="outros";};
    const included = (id:string|null) => !id || accounts.some(a=>a.id===id);
    function push(e:Event){ if(included(e.account)) events.push(e); }
    for(const a of accounts) if(a.initial_balance_date<=today && cents(a.initial_balance)!==0) push({date:a.initial_balance_date,value:cents(a.initial_balance),label:`Saldo inicial: ${a.name}`,kind:"abertura",account:a.id,third:false,actual:true,restricted:restricted(a.id)});
    let missingPaid=0, futurePaid=0, orphan=0, excluded=0, partial=0;
    for(const t of tx){
      if(t.type==="despesa" && (t.credit_card_id || t.invoice_id)) {if(!t.invoice_id || !invoiceIds.has(t.invoice_id)) orphan++; continue;}
      if(t.type==="pagamento_fatura" && t.status!=="pago") continue;
      if(t.type==="transferencia" && t.status!=="pago") continue;
      const paid = t.status==="pago";
      const date = paid ? (t.paid_date ?? t.due_date ?? t.competence_date) : (t.due_date ?? t.competence_date);
      if(paid && !t.paid_date) missingPaid++;
      if(paid && date>today){futurePaid++; continue;}
      if(paid && !t.account_id){warnings.push(`Movimento pago sem conta: ${t.description}`); continue;}
      if(paid && t.account_id && date < (accountById.get(t.account_id)?.initial_balance_date ?? "")) continue;
      if(!included(t.account_id)){excluded++; continue;}
      const kind = t.type==="receita" ? "receita" : t.type==="pagamento_fatura" ? "fatura" : t.type==="transferencia" ? "transferencia" : "direta";
      if(t.type==="transferencia" && t.transfer_role!=="origem" && t.transfer_role!=="destino"){warnings.push(`Transferência sem direção: ${t.description}`);continue;}
      const sign = t.type==="receita" || (t.type==="transferencia" && t.transfer_role==="destino") ? 1 : -1;
      push({date,value:sign*cents(t.amount),label:t.description,kind,account:t.account_id,third:third(t),actual:paid,restricted:restricted(t.account_id),uncertain:!t.account_id,nature:t.expense_nature,installment:!!t.installment_group_id || Number(t.installment_total ?? 0)>1,category:root(t.category_id),unallocated:kind==="fatura",txId:t.id,invoiceId:t.invoice_id});
    }
    for(const f of invoices){
      const items = tx.filter(t=>t.type==="despesa" && t.invoice_id===f.id);
      const payments = tx.filter(t=>t.type==="pagamento_fatura" && t.invoice_id===f.id && t.status==="pago" && (t.paid_date??t.due_date??t.competence_date)<=today);
      const total = items.reduce((s,t)=>s+cents(t.amount),0), paid=payments.reduce((s,t)=>s+cents(t.amount),0);
      if(f.status==="paga" && total!==paid) warnings.push(`Fatura paga não conciliada: ${f.due_date} (${money(total-paid)})`);
      if(paid>total) warnings.push(`Pagamento superior à fatura: ${f.due_date}`);
      const card = cards.find(c=>c.id===f.credit_card_id);
      const acc = card?.payment_account_id ?? null;
      // Fully reconciled single payment: split the cash event without changing its total.
      if(payments.length===1 && total===paid && paid>0){
        const payment=payments[0];
        if(payment){
          const idx=events.findIndex(e=>e.kind==="fatura" && e.actual && e.unallocated && e.txId===payment.id && e.value===-paid);
          const original=events[idx];
          if(idx>=0 && original){events.splice(idx,1);for(const t of items) push({...original,value:-cents(t.amount),label:`${card?.name??"Cartão"} · ${t.description}`,third:third(t),nature:t.expense_nature,installment:!!t.installment_group_id || Number(t.installment_total ?? 0)>1,category:root(t.category_id),unallocated:false});}
        }
      }
      if(f.status==="paga" || total<=paid) continue;
      if(paid>0){partial++;push({date:f.due_date,value:-(total-paid),label:`Fatura parcial ${card?.name??"Cartão"}`,kind:"fatura",account:acc,third:false,actual:false,restricted:restricted(acc),uncertain:true,unallocated:true,invoiceId:f.id});}
      else for(const t of items) push({date:f.due_date,value:-cents(t.amount),label:`${card?.name??"Cartão"} · ${t.description}`,kind:"fatura",account:acc,third:third(t),actual:false,restricted:restricted(acc),uncertain:!acc,nature:t.expense_nature,installment:!!t.installment_group_id || Number(t.installment_total ?? 0)>1,category:root(t.category_id),invoiceId:f.id});

    }
    if(orphan) warnings.push(`${orphan} compra(s) de cartão sem fatura válida, não incluídas na projeção.`);
    if(missingPaid) warnings.push(`${missingPaid} movimento(s) pagos sem data de pagamento; usada a data alternativa cadastrada.`);
    if(futurePaid) warnings.push(`${futurePaid} lançamento(s) pagos com data futura, não incorporados.`);
    if(partial) warnings.push(`${partial} fatura(s) parcial(is): valor residual incluído sem rateio familiar/terceiros.`);
    if(excluded) warnings.push(`${excluded} movimento(s) em contas fora do caixa selecionado.`);
    const actual = events.filter(e=>e.actual);
    const pending = events.filter(e=>!e.actual);
    const old = pending.filter(e=>e.date.slice(0,7)<now);
    const eligible = pending.filter(e=>e.date.slice(0,7)>=now);
    const actualAt = (k:string) => sum(actual.filter(e=>e.date.slice(0,7)<k));
    const projectedAt = (k:string) => k<=now ? actualAt(k) : sum(actual)+sum(eligible.filter(e=>e.date.slice(0,7)<k));
    // Evolucao liquida das movimentacoes classificadas como terceiros.
    // O saldo inicial das contas permanece atribuido a familia.
    const thirdProjectedAt = (k:string):number =>
      k <= now
        ? sum(actual.filter(e => e.third && e.date.slice(0,7) < k))
        : sum(actual.filter(e => e.third)) +
          sum(eligible.filter(e => e.third && e.date.slice(0,7) < k));
    const budgetRows = (k:string, selected:Event[]) => {
      const budget=(qb.data??[]).find(b=>b.family_id===family && b.reference_month.slice(0,7)===k);
      const limits=new Map<string,number>();
      for(const item of budget?.budget_items??[]){ const id=root(item.category_id); limits.set(id,(limits.get(id)??0)+cents(item.amount)); }
      const used=new Map<string,number>();
      for(const e of selected) if(e.value<0 && !e.third && !e.unallocated && e.nature==="variavel" && (e.kind==="direta"||e.kind==="fatura")){const id=e.category??"sem-categoria";used.set(id,(used.get(id)??0)-e.value);}
      return {exists:!!budget, rows:[...new Set([...limits.keys(),...used.keys()])].map(id=>({id,name:categories.find(c=>c.id===id)?.name??"Sem categoria",limit:limits.get(id)??0,used:used.get(id)??0})).sort((a,b)=>a.name.localeCompare(b.name,"pt-BR"))};
    };
    const registeredRow = (k:string) => {
      const past = k<now, current=k===now;
      const realized=actual.filter(e=>e.date.slice(0,7)===k), expected=past?[]:eligible.filter(e=>e.date.slice(0,7)===k);
      const selected=[...realized,...expected];
      const inflow=sum(selected.filter(e=>e.kind==="receita")), direct=-sum(selected.filter(e=>e.kind==="direta")), invoicesTotal=-sum(selected.filter(e=>e.kind==="fatura"));
      const expenses=selected.filter(e=>e.kind==="direta"||e.kind==="fatura");
      const own=expenses.filter(e=>!e.third&&!e.unallocated);
      const thirdIn=sum(selected.filter(e=>e.third&&e.kind==="receita")),thirdOut=-sum(expenses.filter(e=>e.third&&!e.unallocated));
      const fixed=-sum(own.filter(e=>e.nature==="fixo")),variable=-sum(own.filter(e=>e.nature==="variavel")),other=-sum(own.filter(e=>e.nature!=="fixo"&&e.nature!=="variavel")),unallocated=-sum(expenses.filter(e=>e.unallocated));
      const budget=budgetRows(k,selected);
      return {key:k,past,current,realized,expected,selected,inflow,direct,invoicesTotal,outflow:direct+invoicesTotal,opening:projectedAt(k),closing:projectedAt(shift(k,1)),thirdIn,thirdOut,fixed,variable,other,unallocated,budget};
    };
    // Complemento variavel ainda nao registrado.
    const reserveFor = (k:string):number => {
      const month = registeredRow(k);
      if (month.past || !month.budget.exists) return 0;

      const approved = month.budget.rows.reduce(
        (total, item) => total + item.limit,
        0
      );

      return Math.max(0, approved - month.variable);
    };

    // Reserva acumulada entre o mes atual e o mes anterior.
    const reserveBefore = (k:string):number => {
      let total = 0;
      let cursor = now;

      while (cursor < k) {
        total += reserveFor(cursor);
        cursor = shift(cursor, 1);
      }

      return total;
    };

    // Resumo e grafico utilizam esta mesma projecao.
    const row = (k:string) => {
      const base = registeredRow(k);

      return {
        ...base,
        reserve: reserveFor(k),
        opening: base.opening - reserveBefore(k),
        closing: base.closing - reserveBefore(shift(k, 1)),
      };
    };
    const balances=accounts.map(a=>({name:a.name,value:sum(actual.filter(e=>e.account===a.id)),restricted:restricted(a.id)}));
    return {row,thirdProjectedAt,balances,actual,pending,old,cards,invoices,warnings,today,now};

}

export type CashResultsModel = ReturnType<typeof buildCashResultsModel>;
