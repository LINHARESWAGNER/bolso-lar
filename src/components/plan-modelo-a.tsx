import { useEffect, useMemo, useState } from "react";
import { PlanAResults } from "@/components/plan-a-results";
import { useQuery } from "@tanstack/react-query";
import { JourneyHeader } from "@/components/journey-header";
import { MonthSelector } from "@/components/month-selector";
import { usePeriod } from "@/components/period-context";
import { useAccounts, useBudgetPlanVersions, useBudgets, useCards, useCategories, useInvoices, useProfile } from "@/lib/queries";
import { isThirdPartyTransaction } from "@/lib/derive";
import { brl, toISODate } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

type Tx = Tables<"transactions"> & { deleted_at?: string | null };
type Event = { date: string; value: number; label: string; kind: "receita" | "direta" | "fatura" | "transferencia" | "abertura"; account: string | null; third: boolean; actual: boolean; restricted: boolean; uncertain?: boolean; nature?: string | null; installment?: boolean; category?: string; unallocated?: boolean; txId?: string; invoiceId?: string | null };
const cents = (n: number) => Math.round(Number(n) * 100);
const money = (n: number) => brl(n / 100);
const sum = (e: Event[]) => e.reduce((s, x) => s + x.value, 0);
const keyOf = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;
const shift = (key: string, n: number) => { const y = Number(key.slice(0,4)), m = Number(key.slice(5,7)); const d = new Date(y, m - 1 + n, 1); return keyOf(d.getFullYear(),d.getMonth()+1); };
const monthName = (key: string) => new Intl.DateTimeFormat("pt-BR", {month:"short",year:"numeric"}).format(new Date(`${key}-01T12:00:00`));
const tone = (v: number) => v < 0 ? "text-destructive" : v > 0 ? "text-success" : "text-foreground";
const cardClass = "rounded-xl border border-border bg-card p-5";

export function PlanModeloA() {
  const [carouselStart, setCarouselStart] = useState(() => toISODate(new Date()).slice(0, 7));
  const [showMonthSummary, setShowMonthSummary] = useState(true);
  const {year, month, setYear, setMonth} = usePeriod();
  const today = toISODate(new Date());
  const now = today.slice(0,7);
  const key = keyOf(year,month);
  const {data: profile, isLoading: lp, isError: ep} = useProfile();
  const family = profile?.family_id;
  const qb = useBudgets();
  const approvalVersions = useBudgetPlanVersions();
  const monthlyApprovedVersions = (approvalVersions.data ?? [])
    .filter(version =>
      version.family_id === family &&
      version.reference_month.startsWith(key)
    );

  const latestApprovedVersion = monthlyApprovedVersions.reduce(
    (latest, current) =>
      !latest || current.version_number > latest.version_number
        ? current
        : latest,
    undefined as (typeof monthlyApprovedVersions)[number] | undefined
  );

  const selectedMonthlyBudget = (qb.data ?? []).find(
    budget =>
      budget.family_id === family &&
      budget.reference_month.startsWith(key)
  );
  const qa = useAccounts(), qc = useCards(), qi = useInvoices(), qcat = useCategories();
  // Independent, paginated, family-scoped read. No insert/update/RPC.
  const qt = useQuery({queryKey:["plan-modelo-a-read",family],enabled:!!family,queryFn:async()=>{
    if(!family) return [] as Tx[];
    const out: Tx[] = [];
    for(let offset=0;;offset+=500){
      const {data,error} = await supabase.from("transactions").select("*").eq("family_id",family).is("deleted_at",null).order("id").range(offset,offset+499);
      if(error) throw error;
      const page = data ?? []; out.push(...page);
      if(page.length<500) break;
    }
    return out;
  }});

  const model = useMemo(()=>{
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
  },[qa.data,qc.data,qi.data,qcat.data,qt.data,qb.data,family,today,now]);
  // Editor oficial de limites para meses ainda nao aprovados.
  const [officialBudgetDraft, setOfficialBudgetDraft] = useState<Record<string, string>>({});
  const [officialBudgetSaving, setOfficialBudgetSaving] = useState(false);
  const [officialBudgetMessage, setOfficialBudgetMessage] = useState("");

  const officialBudgetCategories = (qcat.data ?? [])
    .filter(category =>
      category.family_id === family &&
      category.kind === "despesa" &&
      !category.parent_id
    )
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

  useEffect(() => {
    const categories = qcat.data ?? [];
    const roots = new Map(categories.map(category => [category.id, category.parent_id ?? category.id]));
    const next: Record<string, string> = {};

    for (const item of selectedMonthlyBudget?.budget_items ?? []) {
      const rootId = roots.get(item.category_id) ?? item.category_id;
      const amount = Number(item.amount);

      next[rootId] = String(Number(next[rootId] ?? 0) + amount);
    }

    setOfficialBudgetDraft(next);
    setOfficialBudgetMessage("");
  }, [key, selectedMonthlyBudget, qcat.data]);

  const copyOfficialPreviousBudget = () => {
    const previous = shift(key, -1);
    const source = (qb.data ?? []).find(
      budget =>
        budget.family_id === family &&
        budget.reference_month.startsWith(previous)
    );

    if (!source) {
      setOfficialBudgetMessage("O mes anterior nao possui orcamento cadastrado.");
      return;
    }

    const categories = qcat.data ?? [];
    const roots = new Map(categories.map(category => [category.id, category.parent_id ?? category.id]));
    const next: Record<string, string> = {};

    for (const item of source.budget_items ?? []) {
      const rootId = roots.get(item.category_id) ?? item.category_id;
      next[rootId] = String(Number(next[rootId] ?? 0) + Number(item.amount));
    }

    if (!Object.keys(next).length) {
      setOfficialBudgetMessage("Nao ha limites para copiar no mes anterior.");
      return;
    }

    setOfficialBudgetDraft(next);
    setOfficialBudgetMessage("Limites copiados. Confira antes de aprovar.");
  };

  const saveOfficialVariableBudget = async () => {
    if (!family || officialBudgetSaving || approvalVersions.isLoading ||
        qb.isLoading || latestApprovedVersion || selectedMonthlyBudget) return;

    const parsed = Object.entries(officialBudgetDraft).map(([category_id, raw]) => ({
      category_id,
      amount: Number(raw.replace(",", "."))
    }));

    if (parsed.some(item => !Number.isFinite(item.amount) || item.amount < 0)) {
      setOfficialBudgetMessage("Corrija os valores invalidos ou negativos.");
      return;
    }

    const items = parsed
      .filter(item => item.amount > 0)
      .map(item => ({
        ...item,
        amount: Math.round(item.amount * 100) / 100
      }));

    if (!items.length) {
      setOfficialBudgetMessage("Informe ao menos um limite maior que zero.");
      return;
    }

    if (!window.confirm(
      "Aprovar este orcamento? Alteracoes posteriores deverao ser feitas no Action e registradas em uma nova versao."
    )) return;

    setOfficialBudgetSaving(true);
    setOfficialBudgetMessage("");

    try {
      const totalVariable = items.reduce((total, item) => total + item.amount, 0);

      const { error } = await supabase.rpc("save_budget_plan_version", {
        p_reference_month: `${key}-01`,
        p_items: items,
        p_context: {
          income: r.inflow / 100,
          fixed: r.fixed / 100,
          variable: totalVariable
        },
        p_expected_version: 0,
        p_change_kind: null,
        p_justification: null
      });

      if (error) throw error;

      await Promise.all([
        qb.refetch(),
        approvalVersions.refetch()
      ]);

      setOfficialBudgetMessage("Orcamento aprovado com sucesso.");
    } catch (error) {
      setOfficialBudgetMessage(
        `Nao foi possivel aprovar: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    } finally {
      setOfficialBudgetSaving(false);
    }
  };
  const loading = lp || qa.isLoading || qc.isLoading || qi.isLoading || qcat.isLoading || qt.isLoading || qb.isLoading;
  const error = ep || qa.isError || qc.isError || qi.isError || qcat.isError || qt.isError || qb.isError;
  const r = model.row(key);
  const bank=model.balances.filter(b=>!b.restricted).reduce((s,b)=>s+b.value,0);
  const benefits=model.balances.filter(b=>b.restricted).reduce((s,b)=>s+b.value,0);
  const refLimit = (v: typeof r) => v.budget.rows.reduce((a,b)=>a+b.limit,0);
  const limitFor = (v: typeof r) => v.budget.exists ? refLimit(v) : null;
  const limit=limitFor(r);
  const remaining=limit===null?null:limit-r.variable;
  const reserve=r.reserve;
  const receipts=(list:Event[], onlyFamily=false)=>sum(list.filter(e=>e.kind==="receita"&&(!onlyFamily||!e.third)));
  const payments=(list:Event[])=>-sum(list.filter(e=>e.kind==="direta"||e.kind==="fatura"));
  const ownFixed=r.selected.filter(e=>!e.third&&!e.unallocated&&e.nature==="fixo");
  const fixedDirect=-sum(ownFixed.filter(e=>e.kind==="direta")), fixedCard=-sum(ownFixed.filter(e=>e.kind==="fatura"));
  const variableInstallments=-sum(r.selected.filter(e=>!e.third&&!e.unallocated&&e.nature==="variavel"&&e.installment&&(e.kind==="direta"||e.kind==="fatura")));
  const variableOther=r.variable-variableInstallments;
  const adjustments=sum(r.selected.filter(e=>e.kind==="transferencia"||e.kind==="abertura"));
  const periodParams=`&origem=planejamento&ano=${year}&mes=${String(month).padStart(2,"0")}`;
  const line=(label:string, value:number, color="")=><div className="flex items-center justify-between gap-3 border-b border-border/60 py-2 text-sm"><span>{label}</span><strong className={`tabular-nums ${color}`}>{money(value)}</strong></div>;
  const monthProgressBar = (
    label: string,
    planned: number | null,
    actual: number,
    actualLabel: string,
    variable = false,
    revenue = false
  ) => {
    const pct = planned !== null && planned > 0
      ? actual / planned * 100
      : null;

    const barColor = variable
      ? planned === null
        ? "#64748b"
        : actual > planned
          ? "#ef4444"
          : actual === planned && planned > 0
            ? "#eab308"
            : "#22c55e"
      : revenue
        ? "#22c55e"
        : "#3b82f6";

    const width = pct === null
      ? 0
      : Math.min(100, Math.max(0, pct));

    return (
      <div className="space-y-1.5 border-b border-border/60 py-3 last:border-b-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">{label}</span>
          <span
            className="text-xs font-semibold tabular-nums"
            style={{ color: barColor }}
          >
            {pct === null ? "Sem limite" : `${pct.toFixed(1)}%`}
          </span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs">
          <span className="text-muted-foreground">
            Planejado{" "}
            <strong className="text-foreground">
              {planned === null ? "Não definido" : money(planned)}
            </strong>
          </span>

          <span className="text-muted-foreground">
            {actualLabel}{" "}
            <strong className="text-foreground">
              {money(actual)}
            </strong>
          </span>
        </div>

        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{
              width: `${width}%`,
              backgroundColor: barColor,
            }}
          />
        </div>
      </div>
    );
  };

const headline=(label:string,value:number,color="")=><div><p className="text-sm text-muted-foreground">{label}</p><strong className={`text-2xl tabular-nums ${color}`}>{money(value)}</strong></div>;
  const title=(n:number,t:string,desc:string)=><div className="flex items-start gap-3 pt-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 font-semibold text-primary">{n}</span><div><h2 className="text-lg font-semibold">{t}</h2><p className="text-sm text-muted-foreground">{desc}</p></div></div>;
  const detailClass="mt-3 cursor-pointer text-sm font-medium text-primary";
  type ChartScope = "familia" | "terceiros" | "geral";

  const chartMonthRows = (scope: ChartScope) =>
    Array.from({ length: 12 }, (_, i) => {
      const period = keyOf(year, i + 1);
      const item = model.row(period);

      const allEvents = item.past ? item.realized : item.selected;

      const selectedEvents =
        scope === "geral"
          ? allEvents
          : allEvents.filter(e =>
              scope === "terceiros" ? e.third : !e.third
            );

      const revenue = receipts(selectedEvents);

      const expenses =
        payments(selectedEvents) +
        (scope === "terceiros" ? 0 : item.reserve);

      const thirdOpening = model.thirdProjectedAt(period);
      const thirdClosing = model.thirdProjectedAt(shift(period, 1));

      const opening =
        scope === "geral"
          ? item.opening
          : scope === "terceiros"
            ? thirdOpening
            : item.opening - thirdOpening;

      const closing =
        scope === "geral"
          ? item.closing
          : scope === "terceiros"
            ? thirdClosing
            : item.closing - thirdClosing;

      // Mantem a conciliacao de abertura, transferencias
      // e ajustes, sem alterar receitas nem pagamentos.
      const adjustments =
        closing - opening - (revenue - expenses);

      return {
        key: period,
        revenue,
        expenses,
        adjustments,
        balance: closing,
        past: item.past,
        current: item.current,
      };
    });

  const january = keyOf(year, 1);
  const generalOpening = model.row(january).opening;
  const thirdOpening = model.thirdProjectedAt(january);

  const chartViews = {
    familia: {
      opening: generalOpening - thirdOpening,
      rows: chartMonthRows("familia"),
    },
    terceiros: {
      opening: thirdOpening,
      rows: chartMonthRows("terceiros"),
    },
    geral: {
      opening: generalOpening,
      rows: chartMonthRows("geral"),
    },
  };
  return <div className="space-y-5">
    <JourneyHeader step={2} title="Planejamento" subtitle="Organize receitas e despesas pelo mês de pagamento" actions={<MonthSelector/>}/>
    <div className="flex flex-wrap items-center justify-between gap-3"><a className="text-sm text-primary" href="/planejamento?modelo=legado">Gerenciar e aprovar orçamento</a><button type="button" className="rounded-md border px-3 py-2 text-sm" onClick={()=>{void qt.refetch();void qa.refetch();void qc.refetch();void qi.refetch();void qcat.refetch();void qb.refetch();void approvalVersions.refetch();}}>Atualizar dados</button></div>
    <section className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Orçamento do mês selecionado
          </p>
          <p className="mt-1 font-semibold">
            {approvalVersions.isLoading || qb.isLoading
              ? "Consultando aprovação..."
              : latestApprovedVersion
                ? `Aprovado · versão ${latestApprovedVersion.version_number}`
                : selectedMonthlyBudget
                  ? "Orçamento anterior sem versão aprovada"
                  : "Orçamento ainda não definido"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {latestApprovedVersion
              ? "As revisões do orçamento aprovado são registradas no Action."
              : selectedMonthlyBudget
                ? "Existem limites cadastrados, mas a aprovação precisa ser conferida."
                : "Defina os limites por categoria para planejar as despesas variáveis."}
          </p>
        </div>
        <a
          href={
            latestApprovedVersion
              ? "/agir"
              : "/planejamento?modelo=legado"
          }
          className="inline-flex rounded-md border border-primary px-3 py-2 text-sm font-medium text-primary hover:bg-primary/10"
        >
          {latestApprovedVersion
            ? "Revisar orçamento no Action"
            : "Gerenciar e aprovar orçamento"}
        </a>
      </div>
    </section>
      {!approvalVersions.isLoading && !qb.isLoading &&
        !latestApprovedVersion && !selectedMonthlyBudget && (
        <section className={cardClass}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">
                Orçamento variável de {monthName(key)}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Defina limites familiares por categoria. Eles nao criam
                pagamentos; apenas reservam recursos na projecao.
              </p>
            </div>
            <button
              type="button"
              onClick={copyOfficialPreviousBudget}
              disabled={officialBudgetSaving}
              className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted"
            >
              Copiar mês anterior
            </button>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {officialBudgetCategories.map(category => (
              <label
                key={category.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
              >
                <span className="text-sm">{category.name}</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={officialBudgetDraft[category.id] ?? ""}
                  disabled={officialBudgetSaving}
                  onChange={event => {
                    setOfficialBudgetDraft(current => ({
                      ...current,
                      [category.id]: event.target.value
                    }));
                  }}
                  className="w-32 rounded-md border border-input bg-background px-3 py-2 text-right text-sm"
                />
              </label>
            ))}
          </div>

          {officialBudgetMessage && (
            <p role="status" className="mt-3 text-sm text-muted-foreground">
              {officialBudgetMessage}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <p className="text-sm text-muted-foreground">
              Total informado:{" "}
              <strong className="text-foreground">
                {brl(Object.values(officialBudgetDraft).reduce(
                  (total, value) =>
                    total + (Number(value.replace(",", ".")) || 0),
                  0
                ))}
              </strong>
            </p>
            <button
              type="button"
              disabled={officialBudgetSaving || !officialBudgetCategories.length}
              onClick={() => { void saveOfficialVariableBudget(); }}
              className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {officialBudgetSaving
                ? "Aprovando..."
                : "Salvar e aprovar orçamento"}
            </button>
          </div>
        </section>
      )}

      {!approvalVersions.isLoading && !qb.isLoading &&
        !latestApprovedVersion && selectedMonthlyBudget && (
          <section className={cardClass}>
            <h2 className="font-semibold">Orçamento anterior identificado</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Este mês possui limites cadastrados sem versão aprovada.
              A incorporação ao histórico deve ser tratada antes de uma
              nova aprovação para evitar sobrescrever os valores.
            </p>
            <a
              href="/planejamento?modelo=legado"
              className="mt-3 inline-block text-sm font-medium text-primary"
            >
              Consultar orçamento anterior
            </a>
          </section>
        )}
    {loading ? <section className={cardClass}>Carregando dados financeiros...</section> : error || !family ? <section className={cardClass}>Não foi possível carregar todos os dados. Nenhuma projeção será exibida.</section> : <>
      <section className={cardClass}>
        <div className="flex flex-wrap items-center justify-between gap-3">
  <h2 className="font-semibold">Escolha o mês que pagará suas compras</h2>
  <button
    type="button"
    aria-expanded={showMonthSummary}
    aria-controls="plan-month-summary"
    className="rounded-md border px-3 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
    onClick={() => setShowMonthSummary(v => !v)}
  >
    {showMonthSummary ? "Ocultar resumo" : "Exibir resumo"}
  </button>
</div>
        <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
  <button type="button" aria-label="Mostrar tres meses anteriores" className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted" onClick={() => setCarouselStart(k => shift(k, -3))}>â€¹ Anteriores</button>
  <button type="button" className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted" onClick={() => setCarouselStart(now)}>Mes atual</button>
  <button type="button" aria-label="Mostrar tres meses seguintes" className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted" onClick={() => setCarouselStart(k => shift(k, 3))}>Proximos â€º</button>
</div>
        <div id="plan-month-summary" style={{ display: showMonthSummary ? undefined : "none" }} className="mt-4 grid gap-3 md:grid-cols-3">{[carouselStart,shift(carouselStart,1),shift(carouselStart,2)].map(k=>{const v=model.row(k);return <button key={k} type="button" aria-pressed={key===k} onClick={()=>{setYear(Number(k.slice(0,4)));setMonth(Number(k.slice(5,7)));}} className={`rounded-xl border p-4 text-left transition-colors hover:bg-muted/40 ${key===k?"border-primary bg-primary/5":"border-border"}`}><span className={`inline-block rounded-md px-3 py-2 text-sm font-semibold ${key===k?"bg-primary text-primary-foreground":"bg-muted"}`}>{monthName(k)}</span><div className="mt-2">{monthProgressBar(
    "Receitas familiares",
    v.inflow-v.thirdIn,
    receipts(v.realized,true),
    "Recebido",
    false,
    true
)}
{monthProgressBar(
    "Despesas fixas",
    v.fixed,
    -sum(v.realized.filter(e =>
        !e.third &&
        !e.unallocated &&
        e.nature==="fixo" &&
        (e.kind==="direta" || e.kind==="fatura")
    )),
    "Pago"
)}
{monthProgressBar(
    "Despesas variáveis",
    v.budget.exists ? refLimit(v) : null,
    v.variable,
    "Comprometido",
    true
)}</div></button>;})}</div>
      </section>
      {title(1,`Família · ${monthName(key)}`,"Planejamento de receitas e despesas familiares")}
      <section className={`${cardClass} grid gap-4 lg:grid-cols-3`}><article className="min-w-0 rounded-lg border p-4"><h3 className="mb-3 font-semibold">Receitas</h3>{headline("Receitas familiares do mês",r.inflow-r.thirdIn,"text-success")}{line("Recebidas",receipts(r.realized,true))}{line("A receber",receipts(r.expected,true))}<p className="mt-2 text-xs text-muted-foreground">Inclui benefícios registrados. Não inclui terceiros.</p><a className="mt-4 inline-block text-sm text-primary" href={`/recorrencias?visao=receitas${periodParams}`}>Gerenciar receitas →</a></article>
        <article className="min-w-0 rounded-lg border p-4"><h3 className="mb-3 font-semibold">Despesas fixas</h3>{headline("Despesas fixas do mês de pagamento",r.fixed)}{line("Diretas / recorrentes",fixedDirect)}{line("Fixas no cartão",fixedCard)}<a className="mt-4 inline-block text-sm text-primary" href={`/recorrencias?visao=despesas-fixas${periodParams}`}>Gerenciar despesas fixas →</a></article>
        <article className="min-w-0 rounded-lg border p-4"><h3 className="mb-3 font-semibold">Despesas variáveis</h3>{headline("Variáveis já comprometidas",r.variable)}{line("Compras parceladas",variableInstallments)}{line("Demais despesas variáveis",variableOther)}
          {limit===null?<p className="py-2 text-sm text-muted-foreground">Orçamento não definido</p>:line("Orçamento aprovado",limit)}
          {remaining===null?<p className="py-2 text-sm text-muted-foreground">Nenhum orçamento disponível para este mês.</p>:line("Limite restante",remaining,tone(remaining))}
          {limit!==null&&<div className="mt-3 h-2 overflow-hidden rounded-full bg-muted"><div className={`h-full ${r.variable>limit?"bg-destructive":"bg-primary"}`} style={{width:`${limit>0?Math.max(0,Math.min(100,r.variable/limit*100)):r.variable>0?100:0}%`}}/></div>}
          <p className="mt-3 text-xs text-muted-foreground">Referência original por competência: {r.budget.exists?money(refLimit(r)):"não definida"}. </p>
          <a className="mt-4 inline-block text-sm text-primary" href="#plan-a-variaveis" onClick={()=>{const el=document.getElementById("plan-a-variaveis"); if(el instanceof HTMLDetailsElement) el.open=true;}}>Gerenciar despesas variáveis →</a>
        </article>
        <details id="plan-a-variaveis" className="min-w-0 rounded-lg border p-4 lg:col-span-3"><summary className={detailClass}>Planejamento variável por categoria (referência original)</summary>
<div className="mt-3 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-muted-foreground"><th className="p-2">Categoria</th><th className="p-2 text-right">Limite de referência</th><th className="p-2 text-right">Comprometido</th><th className="p-2 text-right">Disponível</th></tr></thead><tbody>{r.budget.rows.map(b=><tr key={b.id} className="border-t"><td className="p-2">{b.name}</td><td className="p-2 text-right">{r.budget.exists?money(b.limit):"—"}</td><td className="p-2 text-right">{money(b.used)}</td><td className={`p-2 text-right ${tone(b.limit-b.used)}`}>{r.budget.exists?money(b.limit-b.used):"—"}</td></tr>)}</tbody><tfoot><tr className="border-t font-semibold"><td className="p-2">Total</td><td className="p-2 text-right">{r.budget.exists?money(r.budget.rows.reduce((a,b)=>a+b.limit,0)):"—"}</td><td className="p-2 text-right">{money(r.variable)}</td><td className="p-2 text-right">{r.budget.exists?money(r.budget.rows.reduce((a,b)=>a+b.limit-b.used,0)):"—"}</td></tr></tfoot></table></div>
          </details>
        <div className="lg:col-span-3"><a className="mt-4 inline-block text-sm text-primary" href="/agir">Revisar orçamento no Action (competência) →</a></div>
      </section>
      {(r.other!==0||r.unallocated!==0)&&<p className="text-sm text-amber-500">Despesas sem natureza: {money(r.other)} · Pagamentos sem rateio: {money(r.unallocated)}. Incluídos no fluxo financeiro.</p>}
      {title(2,"Terceiros","Recursos e obrigações separados do orçamento familiar")}
      <section className={cardClass}><h3 className="mb-3 font-semibold">Movimentações de terceiros</h3><div className="grid gap-3 md:grid-cols-3">{headline("Receitas de terceiros",r.thirdIn,"text-success")}{headline("Despesas de terceiros",r.thirdOut,"text-destructive")}{headline("Diferença",r.thirdIn-r.thirdOut,tone(r.thirdIn-r.thirdOut))}</div><p className="mt-3 text-xs text-muted-foreground">Incluídos integralmente nos recebimentos e pagamentos. Não consomem o orçamento familiar.</p></section>
      {title(3,"Fluxo financeiro","Consolidação dos recebimentos e pagamentos, sem duplicar as compras do cartão")}
      <section className={cardClass}><h3 className="mb-4 font-semibold">Recebimentos e pagamentos · {monthName(key)}</h3>
        <div className="grid gap-4 lg:grid-cols-2">
          <article className="rounded-lg border p-4">{headline("Total de receitas · família + terceiros",r.inflow,"text-success")}{line("Família",r.inflow-r.thirdIn)}{line("Terceiros",r.thirdIn)}{line("Já recebidas",receipts(r.realized))}{line("A receber",receipts(r.expected))}</article>
          <article className="min-w-0 rounded-lg border p-4">{headline("Total de pagamentos · família + terceiros",r.outflow,"text-destructive")}
            <details className="border-b border-border/60"><summary className="cursor-pointer py-2 text-sm text-primary"><span className="inline-flex w-[calc(100%-1.5rem)] items-center justify-between gap-2"><span>Faturas de cartão</span><strong className="tabular-nums text-foreground">{money(r.invoicesTotal)}</strong></span></summary>
<div className="mt-3 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-muted-foreground"><th className="p-2">Cartão / vencimento</th><th className="p-2 text-right">Família</th><th className="p-2 text-right">Terceiros</th><th className="p-2 text-right">Sem rateio</th><th className="p-2 text-right">Total</th></tr></thead><tbody>{model.invoices.map(f=>{const list=r.selected.filter(e=>e.kind==="fatura"&&e.invoiceId===f.id);if(!list.length)return null;return <tr key={f.id} className="border-t"><td className="p-2">{model.cards.find(c=>c.id===f.credit_card_id)?.name??"Cartão"} · {f.due_date.split("-").reverse().join("/")}</td><td className="p-2 text-right">{money(-sum(list.filter(e=>!e.third&&!e.unallocated)))}</td><td className="p-2 text-right">{money(-sum(list.filter(e=>e.third&&!e.unallocated)))}</td><td className="p-2 text-right">{money(-sum(list.filter(e=>e.unallocated)))}</td><td className="p-2 text-right font-semibold">{money(-sum(list))}</td></tr>;})}{r.selected.some(e=>e.kind==="fatura"&&!model.invoices.some(f=>f.id===e.invoiceId))&&<tr className="border-t"><td colSpan={4} className="p-2">Pagamento sem fatura identificada</td><td className="p-2 text-right">{money(-sum(r.selected.filter(e=>e.kind==="fatura"&&!model.invoices.some(f=>f.id===e.invoiceId))))}</td></tr>}</tbody></table></div><p className="text-xs text-muted-foreground">Valores atribuídos ao período; compras não são somadas novamente ao pagamento da fatura.</p>
          {r.unallocated!==0&&<p className="mt-2 text-xs text-amber-500">Sem rateio: {money(r.unallocated)} (incluído no total financeiro).</p>}</details>
            <details className="border-b border-border/60"><summary className="cursor-pointer py-2 text-sm text-primary"><span className="inline-flex w-[calc(100%-1.5rem)] items-center justify-between gap-2"><span>Pagamentos diretos</span><strong className="tabular-nums text-foreground">{money(r.direct)}</strong></span></summary><p className="mt-2 text-xs text-muted-foreground">Boletos, Pix e outras saídas fora do cartão; meio específico não identificado.</p><div className="mt-3 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-muted-foreground"><th className="p-2">Descrição</th><th className="p-2">Data</th><th className="p-2">Situação</th><th className="p-2 text-right">Valor</th></tr></thead><tbody>{r.selected.filter(e=>e.kind==="direta").sort((a,b)=>a.date.localeCompare(b.date)).map((e,i)=><tr key={i} className="border-t"><td className="p-2">{e.label}{e.third?" · terceiros":""}</td><td className="p-2">{e.date.split("-").reverse().join("/")}</td><td className="p-2">{e.actual?"Pago":"Previsto"}</td><td className="p-2 text-right">{money(-e.value)}</td></tr>)}</tbody></table></div></details>
            {line("Já pagos",payments(r.realized))}{line("A pagar",payments(r.expected))}
          </article>
        </div>
        <div className="mt-4 rounded-lg border p-4"><div className="grid gap-4 md:grid-cols-3">{headline(`Saldo inicial ${key>now?"projetado":"realizado"}`,r.opening,tone(r.opening))}{headline(r.past?"Saldo final realizado":"Saldo final projetado (inclui reserva)",r.closing,tone(r.closing))}</div>
          {!r.past&&limit!==null&&line("Reserva variável adicional do mês",reserve)}
          {adjustments!==0&&line("Ajustes de abertura e transferências líquidas",adjustments)}
          <p className="mt-2 text-xs text-muted-foreground">Inclui benefícios. A reserva variável é transportada aos meses seguintes. Atrasados anteriores não são descontados até reprogramação ou pagamento.</p>
          <details><summary className={detailClass}>Saldo atual das contas · {money(bank+benefits)}</summary>{line("Demais contas e dinheiro",bank)}{line("Outros / benefícios",benefits)}{model.balances.map(b=><div key={b.name}>{line(b.name,b.value,tone(b.value))}</div>)}</details>
          <details><summary className={detailClass}>Pendências anteriores · {money(-sum(model.old.filter(e=>e.value<0)))}</summary>{line("A pagar",-sum(model.old.filter(e=>e.value<0)))}{line("A receber",sum(model.old.filter(e=>e.value>0)))}<p className="mt-2 text-xs text-muted-foreground">Anteriores a {monthName(now)}; fora da projeção até reprogramação ou pagamento.</p></details>
        </div>
      </section>
      <PlanAResults year={year} views={chartViews} />
      {model.warnings.length>0&&<details className={cardClass}><summary className="cursor-pointer text-sm font-semibold text-amber-500">Alertas de qualidade dos dados ({model.warnings.length})</summary><ul className="mt-2 list-disc pl-5 text-sm">{model.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul></details>}
    </>}
  </div>;
}
