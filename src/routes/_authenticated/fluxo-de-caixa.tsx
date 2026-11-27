import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { PageHeader } from "@/components/ui-bits";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { brl, brlCompact, toISODate } from "@/lib/format";
import { buildCashResultsModel, type CashEvent } from "@/lib/cash-results-model";
import { useProfile, useAccounts, useCards, useInvoices, useCategories, useBudgets } from "@/lib/queries";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

type Tx = Tables<"transactions"> & {deleted_at?: string | null};
type Scope = "familia" | "terceiros" | "geral";
const keyOf = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;
const shift = (key: string, offset: number) => {
  const year=Number(key.slice(0,4)), month=Number(key.slice(5,7));
  const date=new Date(year,month-1+offset,1);
  return keyOf(date.getFullYear(),date.getMonth()+1);
};
const money = (cents:number) => brl(cents/100);
const sum = (list:CashEvent[]) => list.reduce((acc,event)=>acc+event.value,0);
const receipts = (events:CashEvent[]) => sum(events.filter(event=>event.kind==="receita"));
const payments = (events:CashEvent[]) => -sum(events.filter(event=>event.kind==="direta" || event.kind==="fatura"));

export const Route = createFileRoute("/_authenticated/fluxo-de-caixa")({
  head: () => ({meta:[{title:"Fluxo de caixa — Finanças da Família"}, {name:"description",content:"Fluxo de caixa conciliado com 4. Resultados do Planejamento"}]}),
  component: FluxoDeCaixa,
});

function FluxoDeCaixa() {
  const today=toISODate(new Date()), now=today.slice(0,7);
  const year=Number(now.slice(0,4));
  const [from,setFrom] = useState(keyOf(year,1));
  const [to,setTo] = useState(keyOf(year+1,12));
  const [scope,setScope] = useState<Scope>("geral");
  const {data:profile} = useProfile();
  const family=profile?.family_id;
  const qa=useAccounts(), qc=useCards(), qi=useInvoices(), qcat=useCategories(), qb=useBudgets();

  // Mesma consulta paginada e chave de cache do Planejamento: nenhum limite de 5000 registros.
  const qt=useQuery({queryKey:["plan-modelo-a-read",family],enabled:!!family,queryFn:async()=>{
    if(!family) return [] as Tx[];
    const out:Tx[]=[];
    for(let offset=0;;offset+=500){
      const {data,error}=await supabase.from("transactions").select("*").eq("family_id",family).is("deleted_at",null).order("id").range(offset,offset+499);
      if(error) throw error;
      const page=data??[];
      out.push(...page);
      if(page.length<500) break;
    }
    return out;
  }});
  const loaded=!!family && !qa.isLoading && !qc.isLoading && !qi.isLoading && !qcat.isLoading && !qb.isLoading && !qt.isLoading;
  const hasError=qa.isError || qc.isError || qi.isError || qcat.isError || qb.isError || qt.isError;

  const model = useMemo(()=>buildCashResultsModel({
    accounts:qa.data??[], cards:qc.data??[], invoices:qi.data??[], categories:qcat.data??[],
    transactions:qt.data??[], budgets:qb.data??[], family,today,now,
  }),[qa.data,qc.data,qi.data,qcat.data,qt.data,qb.data,family,today,now]);

  // Reproduz a construcao das tres visoes de "4. Resultados".
  // Unidades: centavos, com conversao para reais SOMENTE na apresentacao.
  const rows = useMemo(()=>{
    if(!loaded || !/^\d{4}-(0[1-9]|1[0-2])$/.test(from) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(to) || to<from) return [];
    const output=[];
    let month=from;
    while(month<=to && output.length<120){
      const item=model.row(month);
      const allEvents=item.past?item.realized:item.selected;
      const selected=scope==="geral"?allEvents:allEvents.filter(e=>scope==="terceiros"?e.third:!e.third);
      const revenue=receipts(selected);
      const expenses=payments(selected)+(scope==="terceiros"?0:item.reserve);
      const thirdOpening=model.thirdProjectedAt(month);
      const thirdClosing=model.thirdProjectedAt(shift(month,1));
      const opening=scope==="geral"?item.opening:scope==="terceiros"?thirdOpening:item.opening-thirdOpening;
      const balance=scope==="geral"?item.closing:scope==="terceiros"?thirdClosing:item.closing-thirdClosing;
      const adjustments=balance-opening-(revenue-expenses);
      const direct=payments(selected.filter(e=>e.kind==="direta"));
      const invoices=payments(selected.filter(e=>e.kind==="fatura"));
      const reserve=scope==="terceiros"?0:item.reserve;
      output.push({
        key:month, label:new Date(`${month}-01T12:00:00`).toLocaleDateString("pt-BR",{month:"short",year:"2-digit"}),
        revenue:revenue/100, direct:direct/100, invoices:invoices/100, reserve:reserve/100,
        expenses:expenses/100, adjustments:adjustments/100, opening:opening/100,
        result:(revenue-expenses+adjustments)/100, balance:balance/100,
        past:item.past, current:item.current,
      });
      month=shift(month,1);
    }
    return output;
  },[from,to,scope,model,loaded]);
  const negatives=rows.filter(row=>row.balance<0);
  const latest=rows.find(row=>row.current);

  return <div className="space-y-5">
    <PageHeader title="Fluxo de caixa" subtitle="Regime de caixa · mesma apuração de 4. Resultados do Planejamento"
      actions={<div className="flex flex-wrap items-end gap-3">
        <div><Label htmlFor="fluxo-de" className="text-xs">De (mês)</Label><Input id="fluxo-de" type="month" value={from} onChange={e=>setFrom(e.target.value)} /></div>
        <div><Label htmlFor="fluxo-ate" className="text-xs">Até (mês)</Label><Input id="fluxo-ate" type="month" min={from} value={to} onChange={e=>setTo(e.target.value)} /></div>
      </div>}/>
    <section className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="font-semibold">Evolução do caixa</h2><p className="text-sm text-muted-foreground">Entradas, pagamentos e saldo acumulado pelo mês de caixa.</p></div>
        <div className="inline-flex rounded-lg border border-border bg-muted/40 p-1" role="group" aria-label="Visão financeira">
          {([ ["familia","Família"],["terceiros","Terceiros"],["geral","Geral"] ] as const).map(([value,label])=><button key={value} type="button" aria-pressed={scope===value} onClick={()=>setScope(value)} className={`rounded-md px-3 py-2 text-sm ${scope===value?"bg-primary text-primary-foreground":"text-muted-foreground hover:text-foreground"}`}>{label}</button>)}
        </div>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">{scope==="geral"?"Geral: família e terceiros consolidados.":scope==="familia"?"Família: movimentações familiares e reserva do orçamento variável.":"Terceiros: evolução líquida das movimentações de terceiros; não representa saldo bancário separado."}</p>
      {hasError?<p className="mt-5 text-destructive">Não foi possível carregar todos os registros. Nenhum valor parcial será apresentado como resultado conciliado.</p>:
        !loaded?<p className="mt-5 text-muted-foreground">Carregando apuração completa...</p>:
        !rows.length?<p className="mt-5 text-muted-foreground">Selecione um intervalo válido de meses.</p>:
      <>
        {negatives.length>0&&<div className="my-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive"/> Saldo negativo em {negatives.length} mês(es), começando em {negatives[0]?.label}.</div>}
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Saldo de abertura do período</p><strong className="text-xl">{brl(rows[0]?.opening??0)}</strong></div>
          <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Saldo ao final do período</p><strong className="text-xl">{brl(rows[rows.length-1]?.balance??0)}</strong></div>
          <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Mês corrente</p><strong className="text-xl">{latest?brl(latest.balance):"Fora do intervalo"}</strong></div>
        </div>
        <div className="mt-5 h-80"><ResponsiveContainer width="100%" height="100%"><AreaChart data={rows} margin={{top:18,right:16,left:14,bottom:4}}>
          <defs><linearGradient id="cash-results-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.28}/><stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0}/></linearGradient></defs>
          <CartesianGrid strokeDasharray="3 5" vertical={false}/><XAxis dataKey="label" tick={{fontSize:11}}/><YAxis width={76} tickFormatter={v=>brlCompact(Number(v))}/>
          <Tooltip formatter={(value,name)=>[brl(Number(value)),String(name)]} contentStyle={{background:"var(--color-popover)",border:"1px solid var(--color-border)",borderRadius:8,color:"var(--color-popover-foreground)"}}/>
          <Area type="monotone" dataKey="balance" name="Saldo acumulado" stroke="var(--color-chart-1)" fill="url(#cash-results-fill)" strokeWidth={2}/>
        </AreaChart></ResponsiveContainer></div>
        <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[1030px] text-sm"><thead><tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
          <th className="py-2">Mês</th><th className="py-2 text-right">Receitas</th><th className="py-2 text-right">Diretas</th><th className="py-2 text-right">Faturas</th><th className="py-2 text-right">Reserva variável</th><th className="py-2 text-right">Pagamentos</th><th className="py-2 text-right">Ajustes*</th><th className="py-2 text-right">Resultado</th><th className="py-2 text-right">Saldo acumulado</th>
        </tr></thead><tbody>{rows.map(row=><tr key={row.key} className="border-t border-border/60"><td className="py-2">{row.label} <span className="text-xs text-muted-foreground">{row.past?"Realizado":row.current?"Atual":"Projetado"}</span></td>
          {[row.revenue,row.direct,row.invoices,row.reserve,row.expenses,row.adjustments,row.result,row.balance].map((value,index)=><td key={index} className={`py-2 text-right tabular-nums ${index===0?"text-success":index===7&&value<0?"text-destructive":""}`}>{brl(value)}</td>)}
        </tr>)}</tbody></table></div>
        <p className="mt-3 text-xs text-muted-foreground">* Ajustes conciliatórios preservam saldo de abertura, transferências e movimentos que não são receita nem pagamento. Compras no cartão entram no caixa por fatura; não são somadas novamente ao pagamento. Valores futuros incluem os compromissos registrados e reservas variáveis segundo a regra de Resultados do Planejamento.</p>
      </>}
    </section>
  </div>;
}
