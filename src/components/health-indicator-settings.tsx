import type { Dispatch, SetStateAction } from "react";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isThirdPartyCategory } from "@/lib/derive";
import {
  familyInstallmentGroups,
  resolveEssential,
  type HealthData,
  type HealthMetricId,
  type Settings,
} from "@/lib/financial-health";

type Props = {
  indicator: HealthMetricId;
  data: HealthData;
  settings: Settings;
  draft: Settings | null;
  setDraft: Dispatch<SetStateAction<Settings | null>>;
  saving: boolean;
  onSave: () => Promise<void>;
  onEssential: (categoryId: string, value: string) => Promise<void>;
  onDebt: (groupId: string, kind: string) => Promise<void>;
};

const fields: Record<HealthMetricId, { key: keyof Settings; label: string }[]> = {
  budget: [{ key: "budget_tolerance_pct", label: "Tolerância do orçamento (%)" }],
  essential: [{ key: "essential_max_pct", label: "Comprometimento máximo com essenciais (%)" }],
  debt: [
    { key: "debt_healthy_pct", label: "Comprometimento saudável até (%)" },
    { key: "debt_critical_pct", label: "Comprometimento crítico acima de (%)" },
  ],
  investment: [{ key: "investment_target_pct", label: "Meta de investimento (%)" }],
  reserve: [{ key: "reserve_target_months", label: "Reserva de emergência (meses)" }],
  cards: [{ key: "card_max_pct", label: "Limite comprometido dos cartões (%)" }],
};

const debtOptions = [
  ["emprestimo", "Empréstimo"],
  ["financiamento", "Financiamento"],
  ["compra_parcelada", "Compra parcelada"],
  ["imposto_taxa_parcelada", "Imposto/taxa parcelada"],
  ["acordo_renegociacao", "Acordo/renegociação"],
  ["outro_compromisso", "Outro compromisso parcelado"],
  ["nao_considerar", "Não considerar"],
] as const;

const normalizeDebt = (value: string | undefined) =>
  value === "cartao_parcelado"
    ? "compra_parcelada"
    : value === "nao_divida"
      ? "nao_considerar"
      : (value ?? "");

export function HealthIndicatorSettings({
  indicator,
  data,
  settings,
  draft,
  setDraft,
  saving,
  onSave,
  onEssential,
  onDebt,
}: Props) {
  const current = draft ?? settings;
  const roots = data.categories
    .filter(
      (c) => c.kind === "despesa" && !c.parent_id && !isThirdPartyCategory(data.categories, c.id),
    )
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const groups = familyInstallmentGroups(data.groups, data.transactions, data.categories).filter(
    (g) => !g.deleted_at,
  );
  return (
    <section
      className="space-y-3 rounded-xl border border-primary/30 bg-card p-3 text-sm"
      aria-label="Configurações do indicador"
    >
      <div className="flex items-center gap-2">
        <Settings2 className="h-4 w-4 text-primary" />
        <strong>Parâmetros deste indicador</strong>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {fields[indicator].map(({ key, label }) => (
          <label key={key} className="space-y-1 text-xs">
            <span className="block text-muted-foreground">{label}</span>
            <Input
              type="number"
              min="0"
              max={key === "reserve_target_months" ? "120" : "100"}
              step="0.5"
              value={current[key]}
              onChange={(e) =>
                setDraft((prior) => ({ ...settings, ...prior, [key]: Number(e.target.value) }))
              }
            />
          </label>
        ))}
      </div>
      {indicator === "debt" && current.debt_critical_pct <= current.debt_healthy_pct && (
        <p className="text-xs text-destructive">A faixa crítica deve ser maior que a saudável.</p>
      )}
      <Button
        size="sm"
        disabled={
          saving || (indicator === "debt" && current.debt_critical_pct <= current.debt_healthy_pct)
        }
        onClick={() => void onSave()}
      >
        {saving ? "Salvando…" : "Salvar parâmetro"}
      </Button>
      {indicator === "essential" && (
        <div className="space-y-2 border-t pt-3">
          <h3 className="font-semibold">Classificação das categorias essenciais</h3>
          <p className="text-xs text-muted-foreground">
            Categorias filhas herdam a definição da raiz, salvo se classificadas individualmente.
            Salvas automaticamente ao selecionar.
          </p>
          <div className="grid gap-2 lg:grid-cols-2">
            {roots.map((root) => {
              const children = data.categories
                .filter(
                  (c) =>
                    c.kind === "despesa" &&
                    c.parent_id === root.id &&
                    !isThirdPartyCategory(data.categories, c.id),
                )
                .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
              return (
                <div key={root.id} className="rounded-lg border p-2 space-y-2">
                  {[root, ...children].map((c) => {
                    const flag = data.essentials.find((e) => e.category_id === c.id);
                    const effective = resolveEssential(c.id, data.categories, data.essentials);
                    return (
                      <div
                        key={c.id}
                        className={`flex items-center gap-2 ${c.parent_id ? "pl-3 border-l" : "font-medium"}`}
                      >
                        <span className="min-w-0 flex-1 truncate" title={c.name}>
                          {c.name}
                          <span className="block text-[10px] font-normal text-muted-foreground">
                            {flag
                              ? "Definição própria"
                              : c.parent_id
                                ? `Herdado: ${effective === null ? "indefinido" : effective ? "essencial" : "não essencial"}`
                                : "Sem definição própria"}
                          </span>
                        </span>
                        <select
                          aria-label={`Essencial: ${c.name}`}
                          className="w-32 rounded border bg-background p-1 text-xs"
                          value={flag ? (flag.is_essential ? "sim" : "nao") : ""}
                          onChange={(e) => void onEssential(c.id, e.target.value)}
                        >
                          <option value="">{c.parent_id ? "Herdar" : "Definir"}</option>
                          <option value="sim">Essencial</option>
                          <option value="nao">Não essencial</option>
                        </select>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {indicator === "debt" && (
        <div className="space-y-2 border-t pt-3">
          <h3 className="font-semibold">Classificação dos compromissos parcelados</h3>
          <p className="text-xs text-muted-foreground">
            Compras parceladas no cartão são identificadas automaticamente. Cada seleção é salva
            individualmente.
          </p>
          <div className="grid gap-2 lg:grid-cols-2">
            {groups.map((g) => {
              const kind = data.debtKinds.find((d) => d.installment_group_id === g.id)?.debt_kind;
              return (
                <div key={g.id} className="flex items-center gap-2 rounded-lg border p-2">
                  <span className="min-w-0 flex-1 truncate" title={g.description}>
                    {g.description}
                  </span>
                  <select
                    aria-label={`Classificação: ${g.description}`}
                    className="max-w-44 rounded border bg-background p-1 text-xs"
                    value={normalizeDebt(kind)}
                    onChange={(e) => void onDebt(g.id, e.target.value)}
                  >
                    <option value="" disabled>
                      {g.credit_card_id ? "Compra no cartão" : "Classificar"}
                    </option>
                    {debtOptions.map(([value, label]) => (
                      <option value={value} key={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
