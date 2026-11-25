import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { brl } from "@/lib/format";
import { isThirdPartyCategory, isThirdPartyTransaction } from "@/lib/derive";
import { useCategories, useDeletedTransactions, useInvoices, useInvalidateFinance, useProfile, useRecurrences, useTransactions } from "@/lib/queries";
import type { Tables } from "@/lib/finance";
import { RecurrenceDialog } from "@/routes/_authenticated/recorrencias";
import { deleteTransaction } from "@/lib/transactions";

const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
type Tx = Tables["transactions"]["Row"];
type Rule = Tables["recurring_transactions"]["Row"];
type Section = "receitas" | "fixas";
type MonthState = "paid" | "planned" | "estimate" | "none";
type Occurrence = { id: string; date: string; amount: number; state: MonthState; tx?: Tx; estimate?: boolean };
type DisplayRow = { id: string; title: string; category: string; subtitle: string; occurrences: Occurrence[]; rule?: Rule; stages?: Rule[]; third?: boolean };
const money = (v: number) => Math.round(v * 100) / 100;
const monthIndex = (date: string) => Number(date.slice(5, 7)) - 1;
const fmtDate = (date: string) => date ? `${date.slice(8,10)}/${date.slice(5,7)}/${date.slice(0,4)}` : "—";
const frequency: Record<string, number> = { mensal: 1, bimestral: 2, trimestral: 3, semestral: 6, anual: 12 };
function expected(rule: Rule, year: number, month: number) {
  const key = `${year}-${String(month + 1).padStart(2, "0")}`;
  if (!rule.is_active || key < rule.start_date.slice(0,7) || (rule.end_date && key > rule.end_date.slice(0,7))) return false;
  if (rule.frequency === "semanal") return true;
  const diff = (year - Number(rule.start_date.slice(0,4))) * 12 + month + 1 - Number(rule.start_date.slice(5,7));
  return diff >= 0 && diff % (frequency[rule.frequency] ?? 1) === 0;
}
function stateOf(records: Occurrence[]): MonthState {
  if (!records.length) return "none";
  if (records.some(o => o.state === "planned")) return "planned";
  if (records.some(o => o.state === "estimate")) return "estimate";
  return "paid";
}
const colors: Record<MonthState, string> = {
  paid: "bg-blue-600/85 border-blue-400/30 text-white",
  planned: "bg-emerald-600/85 border-emerald-400/30 text-white",
  estimate: "bg-amber-500/80 border-amber-300/30 text-white",
  none: "bg-muted/70 border-border/50 text-muted-foreground",
};
function groupInstallment(description: string) {
  return description.replace(/\s*\(\s*\d+\s*\/\s*\d+\s*\)\s*$/, "").trim();
}

export function PlanManagementAnnual({ section, initialYear }: { section: Section; initialYear?: number }) {
  const [year, setYear] = useState(initialYear ?? new Date().getFullYear());
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [onlyMonth, setOnlyMonth] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
  const [showThird, setShowThird] = useState(false);
  const [createKind, setCreateKind] = useState<"rec" | "pun" | null>(null);
  const [editingRule, setEditingRule] = useState<Rule | null>(null);
  const [editingTx, setEditingTx] = useState<Tx | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editDate, setEditDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [deletingRuleId, setDeletingRuleId] = useState<string | null>(null);
  const [linkingTx, setLinkingTx] = useState<Tx | null>(null);
  const [linkTargetId, setLinkTargetId] = useState("");
  const [linkSaving, setLinkSaving] = useState(false);
  const [savingGroupId, setSavingGroupId] = useState<string | null>(null);
  const [legacyNames, setLegacyNames] = useState<Record<string, string>>({});
  const profile = useProfile();
  const recurrences = useRecurrences();
  const transactions = useTransactions();
  const deletedTransactions = useDeletedTransactions();
  const categories = useCategories();
  const invoices = useInvoices();
  const invalidate = useInvalidateFinance();
  const family = profile.data?.family_id;
  const isIncome = section === "receitas";
  // Leitura de legado apenas para IMPORTACAO EXPLICITA; nunca gravar novos nomes no navegador.
  const legacyStorageKey = family ? `gestao-familia:plan:group-names:${family}:${section}` : "";
  useEffect(() => {
    if (!legacyStorageKey) { setLegacyNames({}); return; }
    try {
      const saved: unknown = JSON.parse(window.localStorage.getItem(legacyStorageKey) || "{}");
      setLegacyNames(saved && typeof saved === "object" && !Array.isArray(saved)
        ? Object.fromEntries(Object.entries(saved).filter(([, value]) => typeof value === "string")) as Record<string,string>
        : {});
    } catch { setLegacyNames({}); }
  }, [legacyStorageKey]);
  const categoryList = useMemo(() => (categories.data ?? []).filter(c => c.family_id === family), [categories.data, family]);
  const catById = useMemo(() => new Map(categoryList.map(c => [c.id, c.name])), [categoryList]);
  const invoiceById = useMemo(() => new Map((invoices.data ?? []).filter(i => i.family_id === family).map(i => [i.id, i])), [invoices.data, family]);
  const familyRules = useMemo(() => (recurrences.data ?? []).filter(r =>
    r.family_id === family && (isIncome ? r.type === "receita" : r.type === "despesa" && r.expense_nature === "fixo")
  ), [recurrences.data, family, isIncome]);
  // O nome de apresentacao pertence a recorrencia raiz da cadeia e vem do Supabase.
  // O campo e adicionado pela migracao 5F; os tipos gerados serao atualizados na sincronizacao do schema.
  const groupNames = useMemo(() => Object.fromEntries(familyRules.flatMap(rule => {
    const name = (rule as Rule & { group_display_name?: string | null }).group_display_name;
    return typeof name === "string" && name.trim() ? [[`chain:${rule.id}`, name]] : [];
  })) as Record<string,string>, [familyRules]);
  const visibleTitle = (row: DisplayRow) => row.stages?.length ? (groupNames[row.id] || row.title) : row.title;
  async function updateGroupName(row: DisplayRow, choice: string) {
    if (!family || !row.stages?.length || !row.id.startsWith("chain:") || savingGroupId) return;
    let selected = choice;
    if (choice === "__custom__") {
      const entered = window.prompt("Nome do compromisso agrupado:", visibleTitle(row));
      if (entered === null) return;
      selected = entered.trim();
      if (!selected) { toast.error("Informe um nome válido."); return; }
    }
    if (selected !== "__default__" && selected.length > 100) {
      toast.error("Use até 100 caracteres."); return;
    }
    const rootId = row.id.slice("chain:".length);
    if (!familyRules.some(rule => rule.id === rootId)) {
      toast.error("A recorrência principal não foi encontrada."); return;
    }
    const nameToSave = selected === "__default__" || selected === row.title ? null : selected;
    setSavingGroupId(row.id);
    try {
      const payload = {group_display_name: nameToSave} as unknown as Tables["recurring_transactions"]["Update"];
      const { data, error } = await supabase.from("recurring_transactions")
        .update(payload).eq("id", rootId).eq("family_id", family).select("id").maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Não foi possível atualizar a recorrência principal. Verifique o acesso ao Supabase.");
      invalidate();
      toast.success("Nome salvo no Supabase para todos os dispositivos.");
    } catch (error) {
      toast.error("Falha ao salvar nome no Supabase", {description: error instanceof Error ? error.message : String(error)});
    } finally { setSavingGroupId(null); }
  }
  const rules = useMemo(() => familyRules.filter(r =>
    r.family_id === family && (isIncome ? r.type === "receita" : r.type === "despesa" && r.expense_nature === "fixo") &&
    r.start_date <= `${year}-12-31` && (!r.end_date || r.end_date >= `${year}-01-01`)
  ), [familyRules, year]);
  const allTx = useMemo(() => (transactions.data ?? []).filter(t =>
    t.family_id === family && t.status !== "cancelado" &&
    (isIncome ? t.type === "receita" : t.type === "despesa" && t.expense_nature === "fixo")
  ), [transactions.data, family, isIncome]);
  const txDate = (tx: Tx) => {
    if (!isIncome && tx.credit_card_id && tx.invoice_id) {
      const invoice = invoiceById.get(tx.invoice_id);
      if (invoice) return (invoice.status === "paga" && invoice.paid_at ? invoice.paid_at : invoice.due_date).slice(0,10);
    }
    return tx.competence_date;
  };
  const txState = (tx: Tx): MonthState => {
    if (!isIncome && tx.credit_card_id && tx.invoice_id) {
      const invoice = invoiceById.get(tx.invoice_id);
      if (invoice) return invoice.status === "paga" ? "paid" : "planned";
    }
    return tx.status === "pago" ? "paid" : "planned";
  };
  const { recurrent, punctual, third } = useMemo(() => {
    const suppressed = new Set((deletedTransactions.data ?? []).filter(t => t.family_id === family && Boolean(t.recurring_id)).map(t => `${t.recurring_id}:${t.competence_date.slice(0,7)}`));
    const entries = allTx.map(t => ({ tx: t, date: txDate(t), state: txState(t) })).filter(x => x.date.startsWith(`${year}-`));
    const recurring: DisplayRow[] = [];
    const punctualMap = new Map<string, DisplayRow>();
    const thirdMap = new Map<string, DisplayRow>();
    for (const rule of rules) {
      const isThird = isThirdPartyCategory(categoryList, rule.category_id);
      const occurrences = entries.filter(x => x.tx.recurring_id === rule.id).map(x => ({ id: x.tx.id, date: x.date, amount: Number(x.tx.amount), state: x.state, tx: x.tx } as Occurrence));
      // Only direct-account rules can be projected reliably without a linked invoice.
      if (!rule.credit_card_id) {
        for (let m = 0; m < 12; m++) {
          const monthKey = `${year}-${String(m + 1).padStart(2,"0")}`;
          if (!expected(rule, year, m) || suppressed.has(`${rule.id}:${monthKey}`) || occurrences.some(o => monthIndex(o.date) === m)) continue;
          occurrences.push({ id: `estimate:${rule.id}:${m}`, date: `${year}-${String(m+1).padStart(2,"0")}-01`, amount: Number(rule.amount), state: "estimate", estimate: true });
        }
      }

      const row: DisplayRow = { id: `r:${rule.id}`, title: rule.description, category: catById.get(rule.category_id ?? "") ?? "Sem categoria", subtitle: `${rule.frequency} · ${fmtDate(rule.start_date)} até ${rule.end_date ? fmtDate(rule.end_date) : "sem término"}`, occurrences, rule, third: isThird };
      if (isThird) thirdMap.set(row.id, row); else recurring.push(row);
    }
    // Don't merge standalone transactions into a recurrence solely by description.
    for (const {tx, date, state} of entries) {
      if (tx.recurring_id) {
        if (!rules.some(r => r.id === tx.recurring_id)) {
          // A historical recurring transaction without a rule in the selected year remains visible.
          const map = isThirdPartyTransaction(categoryList, tx) ? thirdMap : punctualMap;
          const key = `historic:${tx.recurring_id}`;
          if (!map.has(key)) map.set(key, { id:key, title:tx.description, category:catById.get(tx.category_id ?? "") ?? "Sem categoria", subtitle:"Regra histórica · registro preservado", occurrences:[] });
          map.get(key)?.occurrences.push({id:tx.id,date,amount:Number(tx.amount),state,tx});
        }
        continue;
      }
      const isThird = isThirdPartyTransaction(categoryList,tx);
      const map = isThird ? thirdMap : punctualMap;
      const label = !isIncome && tx.installment_group_id ? groupInstallment(tx.description) : tx.description.trim();
      const key = tx.installment_group_id ? `installment:${tx.installment_group_id}` : `standalone:${tx.category_id ?? ""}:${label.toLocaleLowerCase("pt-BR")}`;
      let item = map.get(key);
      if (!item) {
        item = {id:key,title:label,category:catById.get(tx.category_id ?? "") ?? "Sem categoria", subtitle:tx.installment_group_id ? "Parcelas registradas" : "Lançamentos individuais",occurrences:[]};
        map.set(key,item);
      }
      item.occurrences.push({id:tx.id,date,amount:Number(tx.amount),state,tx});
    }
    // Somente vinculos explicitos: nunca agrupar regras pela descricao.
    // Ancestrais fora do ano tambem podem identificar a mesma cadeia.
    const byRuleId = new Map(familyRules.map(r => [r.id, r]));
    const chainRoot = (rule: Rule) => {
      let cursor = rule;
      const visited = new Set<string>([cursor.id]);
      while (cursor.predecessor_recurrence_id) {
        const previous = byRuleId.get(cursor.predecessor_recurrence_id);
        if (!previous || visited.has(previous.id) ||
            previous.category_id !== rule.category_id ||
            isThirdPartyCategory(categoryList, previous.category_id) !== isThirdPartyCategory(categoryList, rule.category_id)) break;
        cursor = previous;
        visited.add(cursor.id);
      }
      return cursor.id;
    };
    const combineExplicitChains = (items: DisplayRow[]) => {
      const grouped = new Map<string, DisplayRow[]>();
      for (const item of items) {
        const chainKey = item.rule ? `chain:${chainRoot(item.rule)}` : item.id;
        const list = grouped.get(chainKey) ?? [];
        list.push(item);
        grouped.set(chainKey, list);
      }
      return [...grouped.entries()].map(([key, group]) => {
        const first = group[0];
        if (!first) throw new Error("Cadeia de recorrências sem etapa.");
        if (group.length === 1) return first;
        const stages = group.flatMap(item => item.rule ? [item.rule] : [])
          .sort((a,b) => a.start_date.localeCompare(b.start_date));
        const allOccurrences = group.flatMap(item => item.occurrences);
        // Projecoes nunca substituem registros. Uma cadeia nao deve
        // projetar duas cobranças no mesmo mes sem lancamento.
        const monthsWithTx = new Set(allOccurrences.filter(o => o.tx).map(o => o.date.slice(0,7)));
        const estimatesByMonth = new Map<string, Occurrence>();
        for (const o of allOccurrences.filter(o => o.estimate)) {
          const month = o.date.slice(0,7);
          if (!monthsWithTx.has(month)) estimatesByMonth.set(month, o);
        }
        const distinct = new Map<string, Occurrence>();
        for (const o of allOccurrences.filter(o => o.tx)) distinct.set(o.id, o);
        for (const o of estimatesByMonth.values()) distinct.set(o.id, o);
        return {
          id: key,
          title: stages[0]?.description ?? first.title,
          category: first.category,
          subtitle: `${stages.length} etapas vinculadas · valores por periodo`,
          occurrences: [...distinct.values()],
          stages,
          third: first.third,
        } as DisplayRow;
      });
    };
    const order = (a: DisplayRow,b: DisplayRow) => a.title.localeCompare(b.title,"pt-BR");
    const thirdRules = [...thirdMap.values()].filter(row => row.rule);
    const thirdOther = [...thirdMap.values()].filter(row => !row.rule);
    return {
      recurrent: combineExplicitChains(recurring).sort(order),
      punctual: [...punctualMap.values()].sort(order),
      third: [...combineExplicitChains(thirdRules), ...thirdOther].sort(order),
    };
  // These helpers close over invoice/category maps already in the dependency list.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allTx, rules, year, isIncome, invoiceById, categoryList, catById, deletedTransactions.data, family, familyRules]);

  const allFamily = [...recurrent, ...punctual];
  const totals = allFamily.flatMap(r => r.occurrences);
  const sumBy = (state?: MonthState) => money(totals.filter(o => !state || o.state === state).reduce((a,o) => a + o.amount,0));
  const loading = profile.isLoading || recurrences.isLoading || transactions.isLoading || categories.isLoading || invoices.isLoading || deletedTransactions.isLoading;
  const error = profile.isError || recurrences.isError || transactions.isError || categories.isError || invoices.isError || deletedTransactions.isError;
  const changeExpand = (id: string) => setExpanded(v => ({...v,[id]:!v[id]}));
  const openTx = (tx: Tx) => {
    setEditingTx(tx); setEditValue(String(tx.amount)); setEditDescription(tx.description); setEditDate(tx.competence_date);
  };
  const possibleLinkTargets = useMemo(() => {
    if (!linkingTx || isIncome) return [] as Rule[];
    return familyRules.filter(r =>
      r.type === "despesa" && r.expense_nature === "fixo" &&
      r.category_id === linkingTx.category_id &&
      !r.credit_card_id
    ).sort((a,b) => a.description.localeCompare(b.description,"pt-BR"));
  }, [linkingTx, isIncome, familyRules]);
  const openLink = (tx: Tx) => {
    if (isIncome || tx.status === "pago" || tx.recurring_id ||
        tx.credit_card_id || tx.invoice_id || tx.installment_group_id || tx.transfer_group_id) {
      toast.error("Somente previsões pontuais e não pagas, fora do cartão, podem ser vinculadas aqui.");
      return;
    }
    setLinkingTx(tx);
    setLinkTargetId("");
  };
  async function linkStandalone() {
    if (!linkingTx || !family || !linkTargetId || linkSaving) return;
    const target = possibleLinkTargets.find(r => r.id === linkTargetId);
    if (!target) { toast.error("Escolha uma regra válida."); return; }
    setLinkSaving(true);
    try {
      // Reconfirmar a origem e a situacao imediatamente antes da atualizacao.
      const { data: current, error: txError } = await supabase.from("transactions")
        .select("id, family_id, description, competence_date, status, recurring_id, category_id, credit_card_id, invoice_id, installment_group_id, transfer_group_id")
        .eq("id", linkingTx.id).eq("family_id", family)
        .is("deleted_at", null).single();
      if (txError) throw txError;
      if (!current || current.status === "pago" || current.status === "cancelado" ||
          current.recurring_id || current.credit_card_id || current.invoice_id ||
          current.installment_group_id || current.transfer_group_id || current.category_id !== target.category_id) {
        throw new Error("O lançamento foi alterado ou não atende aos critérios de vinculação.");
      }
      const month = current.competence_date.slice(0,7);
      const { data: siblings, error: siblingError } = await supabase.from("transactions")
        .select("id, competence_date")
        .eq("family_id", family).eq("recurring_id", target.id).is("deleted_at", null);
      if (siblingError) throw siblingError;
      if ((siblings ?? []).some(row => row.competence_date.slice(0,7) === month)) {
        throw new Error("A recorrência já possui um lançamento ativo nesse mês.");
      }
      const outside = current.competence_date < target.start_date ||
        Boolean(target.end_date && current.competence_date > target.end_date);
      const warning = outside
        ? "\n\nATENÇÃO: a data deste lançamento está fora do período cadastrado na recorrência. O vínculo não ampliará as datas da regra."
        : "";
      if (!window.confirm(`Vincular \"${current.description}\" à regra \"${target.description}\"?\n\nO valor, a data e o status permanecerão intactos.${warning}`)) return;
      const { data: updated, error: updateError } = await supabase.from("transactions")
        .update({ recurring_id: target.id })
        .eq("id", current.id).eq("family_id", family)
        .eq("status", current.status).is("deleted_at", null)
        .is("recurring_id", null).is("credit_card_id", null)
        .is("invoice_id", null).is("installment_group_id", null)
        .select("id").maybeSingle();
      if (updateError) throw updateError;
      if (!updated) throw new Error("O registro foi modificado por outro processo. Atualize a página.");
      invalidate();
      setLinkingTx(null);
      toast.success("Lançamento vinculado sem alterar valor ou pagamento.");
    } catch (error) {
      toast.error("Vinculação não concluída", { description: error instanceof Error ? error.message : String(error) });
    } finally { setLinkSaving(false); }
  }
  async function saveTx() {
    if (!editingTx || !family) return;
    const amount = Number(editValue.replace(",","."));
    if (!Number.isFinite(amount) || amount <= 0 || !editDescription.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(editDate)) {
      toast.error("Confira descrição, valor e data.");return;
    }
    if (editingTx.credit_card_id || editingTx.invoice_id || editingTx.installment_group_id || editingTx.status === "pago") {
      toast.error("Lançamento protegido. Use a rotina financeira original para alterar compras de cartão, parcelas ou valores já pagos.");return;
    }
    setSaving(true);
    try {
      const { error: err } = await supabase.from("transactions").update({ description:editDescription.trim(), amount, competence_date:editDate, due_date:editDate }).eq("id", editingTx.id).eq("family_id",family).neq("status","pago");
      if (err) throw err;
      invalidate();setEditingTx(null);toast.success("Previsão atualizada.");
    } catch (e) { toast.error("Não foi possível salvar",{description:e instanceof Error?e.message:String(e)}); }
    finally {setSaving(false);}
  }
  async function removeIndividual(tx: Tx) {
    if (!family || tx.family_id !== family) return;
    if (tx.credit_card_id || tx.invoice_id || tx.installment_group_id || tx.transfer_group_id || tx.type === "pagamento_fatura") {
      toast.error("Registro vinculado a cartão, parcela ou transferência. Utilize a rotina financeira correspondente.");
      return;
    }
    const settled = tx.status === "pago";
    const message = settled
      ? `ATENÇÃO: ${tx.description} (${brl(Number(tx.amount))}) já está pago/recebido. Excluir retira esse pagamento dos totais, mas o mantém na lixeira para restauração. Se deseja apenas juntá-lo a outra recorrência, NÃO exclua. Deseja realmente excluir?`
      : `Enviar ${tx.description} (${brl(Number(tx.amount))}) para Excluídos? Você poderá restaurar o registro depois.`;
    if (!window.confirm(message)) return;
    setRemovingId(tx.id);
    try {
      await deleteTransaction(tx);
      invalidate();
      toast.success("Registro enviado para Excluídos. É possível restaurá-lo na Execução.");
    } catch (error) {
      toast.error("Falha ao excluir", { description: error instanceof Error ? error.message : String(error) });
    } finally {
      setRemovingId(null);
    }
  }
  async function deleteEmptyRule(rule: Rule) {
    if (!family || rule.family_id !== family) return;
    if (deletingRuleId) return;

    setDeletingRuleId(rule.id);
    try {
      // Conferir no servidor, sem depender apenas do ano selecionado.
      // Registros com deleted_at preenchido NAO bloqueiam a remocao.
      const { count: activeCount, error: activeError } = await supabase
        .from("transactions")
        .select("id", { count: "exact", head: true })
        .eq("family_id", family)
        .eq("recurring_id", rule.id)
        .is("deleted_at", null);
      if (activeError) throw activeError;
      if (activeCount === null || activeCount > 0) {
        toast.error("Regra ainda possui lançamentos ativos", {
          description: "Revise os lançamentos antes de excluir a regra. Nenhum dado foi alterado.",
        });
        return;
      }

      const { count: dependentCount, error: dependentError } = await supabase
        .from("recurring_transactions")
        .select("id", { count: "exact", head: true })
        .eq("family_id", family)
        .eq("predecessor_recurrence_id", rule.id);
      if (dependentError) throw dependentError;
      if (dependentCount === null || dependentCount > 0) {
        toast.error("Esta regra possui continuações vinculadas", {
          description: "Desvincule as continuações antes de excluir. Nenhum dado foi alterado.",
        });
        return;
      }

      const { count: deletedCount, error: deletedError } = await supabase
        .from("transactions")
        .select("id", { count: "exact", head: true })
        .eq("family_id", family)
        .eq("recurring_id", rule.id)
        .not("deleted_at", "is", null);
      if (deletedError) throw deletedError;
      if (deletedCount === null) throw new Error("Nao foi possivel verificar os registros excluidos.");

      const notice = deletedCount > 0
        ? `\n\n${deletedCount} lançamento(s) já excluído(s) continuarão na lixeira, ` +
          "mas perderão o vínculo com esta regra (ON DELETE SET NULL)."
        : "";
      if (!window.confirm(
        `Excluir definitivamente o planejamento "${rule.description}"?\n\n` +
        "A exclusão remove somente a regra, que está sem lançamentos ativos ou dependências." +
        notice + "\n\nDeseja continuar?"
      )) return;

      // A FK transactions_recurring_id_fkey usa ON DELETE SET NULL.
      // Nao apagar transacoes. Remover SOMENTE a regra selecionada.
      const { data, error } = await supabase
        .from("recurring_transactions")
        .delete()
        .eq("id", rule.id)
        .eq("family_id", family)
        .select("id")
        .single();
      if (error) throw error;
      if (!data) throw new Error("Nenhuma regra foi removida.");
      invalidate();
      toast.success("Planejamento excluído. Lançamentos históricos preservados.");
    } catch (error) {
      toast.error("Não foi possível excluir a regra", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setDeletingRuleId(null);
    }
  }
  const downloadCsv = () => {
    const rows = [["grupo","descricao","categoria","data","valor","situacao"]];
    const exportGroups: Array<[string, DisplayRow[]]> = [
      ["recorrente", recurrent], ["pontual", punctual], ["terceiros", third],
    ];
    for (const [group,items] of exportGroups) {
      for (const item of items) for (const o of item.occurrences) rows.push([group,visibleTitle(item),item.category,o.date,o.amount.toFixed(2),o.state]);
    }
    const csv = "\ufeff"+rows.map(row=>row.map(v=>`"${String(v).replaceAll('"','""')}"`).join(";")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}));
    const a = document.createElement("a");a.href=url;a.download=`planejamento-${section}-${year}.csv`;a.click();URL.revokeObjectURL(url);
  };
  const renderRows = (rows: DisplayRow[],group: string) => {
    const filtered = rows.filter(r => (visibleTitle(r)+" "+r.title+" "+r.category).toLocaleLowerCase("pt-BR").includes(search.toLocaleLowerCase("pt-BR")) &&
      (!onlyMonth || r.occurrences.some(o => monthIndex(o.date) === selectedMonth)));
    return <div className="overflow-x-auto"><div className="min-w-[1020px]">
      <div className="grid grid-cols-[minmax(190px,2.1fr)_minmax(140px,1.4fr)_minmax(420px,5fr)_130px_145px] gap-3 px-4 py-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        <span>Planejamento</span><span>Categoria</span><div className="grid grid-cols-12 gap-1 text-center">{MONTHS.map(m=><span key={m}>{m}</span>)}</div><span className="text-right">Total anual</span><span>Ações</span>
      </div>
      {filtered.map(r => {
        const open = Boolean(expanded[r.id]);
        return <div key={`${group}:${r.id}`} className="border-t border-border/70">
          <div className="grid min-h-[62px] grid-cols-[minmax(190px,2.1fr)_minmax(140px,1.4fr)_minmax(420px,5fr)_130px_145px] items-center gap-3 px-4 py-2 hover:bg-muted/25">
            <button type="button" onClick={()=>changeExpand(r.id)} className="min-w-0 text-left"><strong className="block truncate text-xs">{open?"▾":"▸"} {visibleTitle(r)}</strong><span className="block truncate pl-4 text-[10px] text-muted-foreground">{r.subtitle}</span></button>
            <span className="truncate text-xs text-muted-foreground">{r.category}</span>
            <div className="grid grid-cols-12 gap-1">{MONTHS.map((m,i)=>{
              const records = r.occurrences.filter(o=>monthIndex(o.date)===i);
              const status=stateOf(records);
              return <button key={m} type="button" disabled={!records.length} onClick={()=>setExpanded(v=>({...v,[r.id]:true}))} title={`${m}/${year}: ${brl(records.reduce((s,o)=>s+o.amount,0))}, ${records.length} registro(s)`} className={`h-6 rounded border text-[11px] ${colors[status]}`}>{status==="paid"?"✓":status==="planned"?"◷":status==="estimate"?"•":""}</button>;
            })}</div>
            <strong className="text-right text-xs tabular-nums">{brl(r.occurrences.reduce((s,o)=>s+o.amount,0))}</strong>
            <div className="flex items-center justify-end gap-1">
              {r.stages?.length ? (
                <button type="button" className="rounded border px-2 py-1 text-xs" onClick={() => changeExpand(r.id)}>
                  {open ? "Ocultar etapas" : `Ver ${r.stages.length} etapas`}
                </button>
              ) : r.rule ? (
                <>
                  <button
                    type="button"
                    aria-label={`Editar ${r.title}`}
                    className="rounded border px-2 py-1 text-xs"
                    onClick={() => setEditingRule(r.rule!)}
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    disabled={deletingRuleId === r.rule.id}
                    onClick={() => void deleteEmptyRule(r.rule!)}
                    title="Excluir regra sem lancamentos ativos nem dependencias"
                    className="rounded border border-destructive/40 px-2 py-1 text-[11px] text-destructive disabled:opacity-40"
                  >
                    Excluir
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  aria-label={`Consultar ${r.title}`}
                  className="rounded border px-2 py-1 text-xs"
                  onClick={() => setExpanded(v => ({ ...v, [r.id]: true }))}
                >
                  ▤
                </button>
              )}
            </div>
          </div>
          {open && <div className="mx-4 mb-3 overflow-hidden rounded-md border bg-background/30">
            {r.stages?.length ? <div className="border-b bg-muted/20 p-3">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <label htmlFor={`group-name-${r.id}`} className="text-xs font-semibold">Nome do compromisso agrupado</label>
                <select
                  id={`group-name-${r.id}`}
                  aria-label={`Escolher nome do compromisso ${r.title}`}
                  className="min-w-[220px] max-w-full rounded border bg-background px-2 py-1 text-xs"
                  value={groupNames[r.id] && !r.stages.some(stage => stage.description === groupNames[r.id]) ? "__custom__" : groupNames[r.id] ?? "__default__"}
                  disabled={savingGroupId === r.id}
                  onChange={event => void updateGroupName(r, event.target.value)}
                >
                  <option value="__default__">Padrão: {r.title}</option>
                  {[...new Set(r.stages.map(stage => stage.description))].filter(name => name !== r.title).map(name =>
                    <option key={name} value={name}>{name}</option>
                  )}
                  <option value="__custom__">{groupNames[r.id] && !r.stages.some(stage => stage.description === groupNames[r.id]) ? `Personalizado: ${groupNames[r.id]}` : "Personalizar nome..."}</option>
                </select>
                <span className="text-[10px] text-muted-foreground">Nome sincronizado pelo Supabase</span>
                {!groupNames[r.id] && legacyNames[r.id] && <button
                  type="button"
                  disabled={savingGroupId === r.id}
                  className="rounded border border-primary/50 px-2 py-1 text-[11px] text-primary disabled:opacity-40"
                  onClick={() => void updateGroupName(r, legacyNames[r.id] ?? "__default__")}
                >Importar nome deste navegador: {legacyNames[r.id]}</button>}
              </div>
              <p className="mb-2 text-xs font-semibold">Etapas vinculadas explicitamente</p>
              <div className="space-y-2">{r.stages.map(stage =>
                <div key={stage.id} className="flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-2 text-xs">
                  <span>{stage.description} · {fmtDate(stage.start_date)} até {stage.end_date ? fmtDate(stage.end_date) : "sem término"} · {brl(Number(stage.amount))}</span>
                  <button type="button" className="rounded border px-2 py-1" onClick={() => setEditingRule(stage)}>Editar etapa</button>
                </div>
              )}</div>
            </div> : null}
            {r.occurrences.slice().sort((a,b)=>a.date.localeCompare(b.date)).map(o=><div key={o.id} className="grid min-w-[850px] grid-cols-[105px_minmax(140px,1fr)_100px_130px_245px] items-center gap-2 border-t px-3 py-2 text-xs first:border-t-0">
              <span>{fmtDate(o.date)}</span><span className="min-w-0 truncate text-muted-foreground" title={o.estimate ? "Projeção sem lançamento" : o.tx?.description ?? visibleTitle(r)}>{o.estimate?"Projeção sem lançamento":o.tx?.description??visibleTitle(r)}</span>
              <span>{o.state==="paid"?isIncome?"Recebido":"Pago":o.state==="estimate"?"Estimativa":"Previsto"}</span><strong className="text-right">{brl(o.amount)}</strong>
              {o.tx ? <div className="flex min-w-0 items-center justify-end gap-1.5 whitespace-nowrap"><button type="button" onClick={()=>openTx(o.tx!)} className="shrink-0 rounded border px-2 py-1 text-xs">Editar</button>{!isIncome && !o.tx.recurring_id && o.tx.status !== "pago" && !o.tx.credit_card_id && !o.tx.invoice_id && !o.tx.installment_group_id && !o.tx.transfer_group_id && <button type="button" className="shrink-0 rounded border border-primary/50 px-2 py-1 text-xs text-primary" onClick={() => openLink(o.tx!)}>Vincular</button>}<button type="button" disabled={removingId===o.tx.id || Boolean(o.tx.credit_card_id || o.tx.invoice_id || o.tx.installment_group_id || o.tx.transfer_group_id)} title={o.tx.credit_card_id || o.tx.invoice_id || o.tx.installment_group_id ? "Exclusão protegida: use Cartões / Parcelamentos" : "Enviar lançamento para Excluídos"} onClick={()=>void removeIndividual(o.tx!)} className="shrink-0 rounded border border-destructive/40 px-2 py-1 text-xs text-destructive disabled:cursor-not-allowed disabled:opacity-30">Excluir</button></div> : <span className="text-right text-muted-foreground">—</span>}
            </div>)}
          </div>}
        </div>;
      })}
      {!filtered.length && <p className="p-6 text-sm text-muted-foreground">Nenhum registro encontrado.</p>}
    </div></div>;
  };
  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><a href="/planejamento?modelo=A" className="text-xs text-primary">← Voltar ao Planejamento</a><h1 className="mt-2 text-2xl font-semibold">{isIncome?"Gerenciar receitas":"Gerenciar despesas fixas"}</h1><p className="text-sm text-muted-foreground">Jan–Dez · Registros periódicos e pontuais em fontes separadas</p></div>
      <div className="flex items-center gap-2"><select aria-label="Ano" className="rounded-md border bg-background px-3 py-2 text-sm" value={year} onChange={e=>setYear(Number(e.target.value))}>{Array.from({length:6},(_,i)=>new Date().getFullYear()-2+i).map(y=><option key={y} value={y}>{y}</option>)}</select><button onClick={downloadCsv} className="rounded border px-3 py-2 text-xs">Exportar CSV</button><button onClick={()=>setCreateKind("rec")} className="rounded bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground">+ {isIncome?"Nova receita recorrente":"Nova despesa fixa"}</button></div>
    </div>
    {loading ? <p>Carregando planejamentos...</p> : error ? <p className="text-destructive">Falha ao carregar os dados.</p> : !family ? <p>Família não identificada.</p> : <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[["Total anual",sumBy()],[isIncome?"Recebido":"Pago",sumBy("paid")],["Previsto",sumBy("planned")],["Estimativas",sumBy("estimate")]].map(([label,value])=><div key={String(label)} className="rounded-xl border bg-card p-4"><p className="text-xs text-muted-foreground">{label}</p><strong className="mt-2 block text-xl">{brl(Number(value))}</strong></div>)}</div>
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3 text-xs"><span className="font-semibold">Meses:</span>{[["Recebido / pago","paid"],["Previsto","planned"],["Estimativa","estimate"],["Sem ocorrência","none"]].map(([label,state])=><span key={state} className="flex items-center gap-1"><span className={`h-3 w-3 rounded ${colors[state as MonthState]}`} />{label}</span>)}<input value={search} onChange={e=>setSearch(e.target.value)} className="ml-auto rounded border bg-background px-3 py-2" placeholder="Buscar descrição/categoria" aria-label="Buscar" /></div>
      <section className="overflow-hidden rounded-xl border bg-card"><div className="flex items-center justify-between gap-3 border-b bg-muted/25 px-4 py-4"><div><h2 className="font-semibold">{isIncome?"Receitas recorrentes":"Despesas recorrentes e compromissos"}</h2><p className="text-xs text-muted-foreground">Uma linha por regra cadastrada · {recurrent.length} registros</p></div><button onClick={()=>setCreateKind("rec")} className="rounded border px-3 py-2 text-xs">+ Novo planejamento</button></div>{renderRows(recurrent,"rec")}</section>
      <section className="overflow-hidden rounded-xl border bg-card"><div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted/25 px-4 py-4"><div><h2 className="font-semibold">{isIncome?"Receitas pontuais":"Despesas pontuais e parcelas"}</h2><p className="text-xs text-muted-foreground">Ocorrências individuais, sem associação automática a regras pelo nome · {punctual.length} linhas</p></div><div className="flex gap-2"><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={onlyMonth} onChange={e=>setOnlyMonth(e.target.checked)}/>Filtrar mês</label><select value={selectedMonth} onChange={e=>setSelectedMonth(Number(e.target.value))} className="rounded border bg-background px-2 py-1 text-xs">{MONTHS.map((m,i)=><option key={m} value={i}>{m}</option>)}</select></div></div>{renderRows(punctual,"pun")}</section>
      {third.length>0 && <section className="overflow-hidden rounded-xl border bg-card"><button onClick={()=>setShowThird(v=>!v)} className="flex w-full items-center justify-between px-4 py-4 text-left"><strong>Movimentações de terceiros · {third.length} linhas</strong><span className="text-xs">{showThird?"Ocultar":"Mostrar"}</span></button>{showThird && renderRows(third,"third")}</section>}
      <p className="text-xs text-muted-foreground">Compras no cartão usam o pagamento ou vencimento da fatura. Estimativas sem lançamento não são pendências. Lançamentos pagos e compras de cartão exigem suas rotinas financeiras originais para edição.</p>
    </>}
    <RecurrenceDialog open={createKind==="rec"||Boolean(editingRule)} recurrence={editingRule} scopedType={isIncome?"receita":"despesa"} fixedExpenseOnly={!isIncome} excludeThirdParty={false} onClose={()=>{setCreateKind(null);setEditingRule(null)}} />
     {linkingTx && <div role="presentation" className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onMouseDown={e=>{if(e.target===e.currentTarget&&!linkSaving)setLinkingTx(null)}}>
       <div role="dialog" aria-modal="true" aria-label="Vincular lançamento à recorrência" className="w-full max-w-lg rounded-xl border bg-card p-5">
         <h2 className="text-lg font-semibold">Vincular lançamento à recorrência</h2>
         <p className="mt-2 text-xs text-muted-foreground">{linkingTx.description} · {fmtDate(linkingTx.competence_date)} · {brl(Number(linkingTx.amount))}. Nenhum pagamento será excluído ou recriado.</p>
         <label className="mt-4 block text-xs font-medium">Regra existente da mesma categoria
           <select value={linkTargetId} onChange={e=>setLinkTargetId(e.target.value)} className="mt-2 w-full rounded-md border bg-background p-2 text-sm">
             <option value="">Selecione a recorrência</option>
             {possibleLinkTargets.map(rule => <option key={rule.id} value={rule.id}>{rule.description} · {fmtDate(rule.start_date)} a {rule.end_date ? fmtDate(rule.end_date) : "sem término"}{!rule.is_active ? " (inativa)" : ""}</option>)}
           </select>
         </label>
         {!possibleLinkTargets.length && <p className="mt-3 rounded border border-amber-500/40 p-3 text-xs">Não há uma regra existente da mesma categoria. Nenhum vínculo será criado. Verifique se a recorrência histórica ainda existe.</p>}
         <p className="mt-3 text-xs text-muted-foreground">Se a regra estiver encerrada, vinculá-la não altera sua data final nem cria novas previsões.</p>
         <div className="mt-5 flex justify-end gap-2"><button type="button" disabled={linkSaving} className="rounded border px-3 py-2 text-xs" onClick={()=>setLinkingTx(null)}>Cancelar</button><button type="button" disabled={!linkTargetId||linkSaving} onClick={()=>void linkStandalone()} className="rounded bg-primary px-3 py-2 text-xs text-primary-foreground disabled:opacity-40">Confirmar vínculo</button></div>
       </div>
     </div>}
    {editingTx && <div role="presentation" className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onMouseDown={e=>{if(e.target===e.currentTarget)setEditingTx(null)}}><div className="w-full max-w-md rounded-xl border bg-card p-5"><h2 className="text-lg font-semibold">Editar lançamento individual</h2><p className="mb-4 text-xs text-muted-foreground">Alterações de previsões não pagas, fora do cartão e de parcelamentos. Para lançamentos protegidos, utilize a rotina original.</p>
      <label className="mb-3 block text-xs">Descrição<input value={editDescription} onChange={e=>setEditDescription(e.target.value)} className="mt-1 w-full rounded border bg-background p-2"/></label>
      <label className="mb-3 block text-xs">Valor<input value={editValue} onChange={e=>setEditValue(e.target.value)} className="mt-1 w-full rounded border bg-background p-2"/></label>
      <label className="mb-3 block text-xs">Data da previsão<input type="date" value={editDate} onChange={e=>setEditDate(e.target.value)} className="mt-1 w-full rounded border bg-background p-2"/></label>
      {(editingTx.status==="pago"||editingTx.credit_card_id||editingTx.installment_group_id) && <p className="mb-3 rounded border border-amber-500/40 p-2 text-xs">Edição protegida: lançamentos pagos, compras no cartão e parcelas devem ser alterados na rotina financeira correspondente.</p>}
      <div className="flex justify-end gap-2"><button onClick={()=>setEditingTx(null)} className="rounded border px-4 py-2 text-xs">Cancelar</button><button disabled={saving||editingTx.status==="pago"||Boolean(editingTx.credit_card_id)||Boolean(editingTx.installment_group_id)} onClick={()=>void saveTx()} className="rounded bg-primary px-4 py-2 text-xs text-primary-foreground disabled:opacity-40">Salvar previsão</button></div></div></div>}
  </div>;
}
