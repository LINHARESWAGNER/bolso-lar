import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CalendarClock,
  CheckCircle2,
  Landmark,
  Pencil,
  Plus,
  Target,
  Trash2,
  TrendingUp,
  WalletCards,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CurrencyInput } from "@/components/currency-input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/ui-bits";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/lib/finance";
import { brl, brlCompact, formatDateBR, shortMonth, toISODate } from "@/lib/format";
import {
  useInvestmentAssets,
  useInvestmentMonthlyRecords,
  useInvestmentMovements,
  useInvestmentSettings,
  useInvalidateFinance,
  useProfile,
} from "@/lib/queries";

export const Route = createFileRoute("/_authenticated/investimentos")({
  head: () => ({
    meta: [
      { title: "Investimentos — Finanças da Família" },
      {
        name: "description",
        content: "Acompanhe o patrimônio, as metas e a reserva de emergência da família.",
      },
    ],
  }),
  component: Investimentos,
});

type Asset = Tables["investment_assets"]["Row"];
type InvestmentMovement = Tables["investment_movements"]["Row"];
type MonthlyRecord = Tables["investment_monthly_records"]["Row"];
type Scenario = "conservador" | "base" | "otimista";

const CATEGORY_LABELS: Record<string, string> = {
  reserva_emergencia: "Reserva de emergência",
  renda_fixa: "Renda fixa",
  fundos: "Fundos",
  acoes: "Ações",
  fiis: "Fundos imobiliários",
  previdencia: "Previdência",
  cripto: "Criptoativos",
  outros: "Outros",
};

const LIQUIDITY_LABELS: Record<string, string> = {
  imediata: "Imediata",
  d_1: "D+1",
  d_2_mais: "D+2 ou mais",
  carencia: "Com carência",
};

const defaultSettings = {
  target_amount: 1_000_000,
  monthly_contribution: 2_000,
  conservative_rate: 6,
  base_rate: 10,
  optimistic_rate: 14,
  active_scenario: "base" as Scenario,
  reinvest_dividends: true,
  reserve_months: 6,
  essential_monthly_cost: 0,
};

function MetricCard({
  title,
  value,
  icon: Icon,
  subtitle,
}: {
  title: string;
  value: string;
  icon: LucideIcon;
  subtitle?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs text-muted-foreground">{title}</p>
        <Icon className="h-4 w-4 shrink-0 text-primary" />
      </div>
      <p className="mt-2 truncate text-lg font-semibold text-card-foreground">{value}</p>
      {subtitle && <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

function monthStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function addMonths(date: Date, count: number) {
  return new Date(date.getFullYear(), date.getMonth() + count, 1);
}

function monthName(iso: string) {
  const [year, month] = iso.split("-").map(Number);
  return `${shortMonth(month)}/${String(year).slice(2)}`;
}

function scenarioRate(settings: typeof defaultSettings, scenario: Scenario) {
  if (scenario === "conservador") return settings.conservative_rate;
  if (scenario === "otimista") return settings.optimistic_rate;
  return settings.base_rate;
}

function Investimentos() {
  const { data: profile } = useProfile();
  const { data: savedSettings } = useInvestmentSettings();
  const { data: assets = [] } = useInvestmentAssets();
  const { data: movements = [] } = useInvestmentMovements();
  const { data: monthlyRecords = [] } = useInvestmentMonthlyRecords();
  const invalidate = useInvalidateFinance();
  const [assetOpen, setAssetOpen] = useState(false);
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null);
  const [movementOpen, setMovementOpen] = useState(false);
  const [monthlyOpen, setMonthlyOpen] = useState(false);

  const settings = useMemo(
    () => ({
      ...defaultSettings,
      ...(savedSettings ?? {}),
      active_scenario: (savedSettings?.active_scenario ?? "base") as Scenario,
    }),
    [savedSettings],
  );
  const activeAssets = assets.filter((asset) => asset.is_active);
  const currentBalance = activeAssets.reduce(
    (sum, asset) => sum + Number(asset.current_balance),
    0,
  );
  const totalContributed = movements
    .filter((movement) => movement.type === "aporte")
    .reduce((sum, movement) => sum + Number(movement.amount), 0);
  const totalWithdrawn = movements
    .filter((movement) => movement.type === "resgate")
    .reduce((sum, movement) => sum + Number(movement.amount), 0);
  const totalEarnings = movements
    .filter((movement) =>
      ["rendimento", "dividendo", "dividendo_reaplicado"].includes(movement.type),
    )
    .reduce((sum, movement) => sum + Number(movement.amount), 0);
  const progress = settings.target_amount > 0 ? (currentBalance / settings.target_amount) * 100 : 0;

  const projection = useMemo(() => {
    const confirmed = monthlyRecords
      .filter((record) => record.is_confirmed)
      .sort((a, b) => a.reference_month.localeCompare(b.reference_month));
    const lastConfirmed = confirmed.at(-1);
    const startDate = lastConfirmed
      ? addMonths(new Date(`${lastConfirmed.reference_month}T00:00:00`), 1)
      : monthStart(new Date());
    let balance = lastConfirmed ? Number(lastConfirmed.ending_balance) : currentBalance;
    const annualRate = scenarioRate(settings, settings.active_scenario);
    const monthlyRate = Math.pow(1 + annualRate / 100, 1 / 12) - 1;
    const points = new Map<
      string,
      {
        key: string;
        label: string;
        realizado?: number;
        previsto?: number;
        aportes?: number;
        rendimentos?: number;
      }
    >();
    let contributions = 0;
    const earningsMovements = movements
      .filter((movement) =>
        ["rendimento", "dividendo", "dividendo_reaplicado"].includes(movement.type),
      )
      .sort((a, b) => a.movement_date.localeCompare(b.movement_date));
    for (const record of confirmed) {
      contributions += Number(record.actual_contribution);
      const date = new Date(`${record.reference_month}T00:00:00`);
      points.set(record.reference_month.slice(0, 7), {
        key: record.reference_month.slice(0, 7),
        label: monthName(record.reference_month),
        realizado: Number(record.ending_balance),
        aportes: contributions,
        rendimentos: earningsMovements
          .filter(
            (movement) => movement.movement_date.slice(0, 7) <= record.reference_month.slice(0, 7),
          )
          .reduce((sum, movement) => sum + Number(movement.amount), 0),
      });
    }
    contributions = Math.max(contributions, totalContributed);
    let projectedEarnings = totalEarnings;
    const startKey = monthKey(startDate);
    points.set(startKey, {
      key: startKey,
      label: monthName(`${startKey}-01`),
      realizado: lastConfirmed ? Number(lastConfirmed.ending_balance) : currentBalance,
      previsto: balance,
      aportes: contributions,
      rendimentos: projectedEarnings,
    });
    let reachedAt: Date | null = balance >= settings.target_amount ? startDate : null;
    for (let index = 1; index <= 600; index += 1) {
      const date = addMonths(startDate, index);
      const monthlyEarnings = balance * monthlyRate;
      balance = balance + monthlyEarnings + Number(settings.monthly_contribution);
      contributions += Number(settings.monthly_contribution);
      projectedEarnings += monthlyEarnings;
      const key = monthKey(date);
      points.set(key, {
        key,
        label: monthName(`${key}-01`),
        previsto: balance,
        aportes: contributions,
        rendimentos: projectedEarnings,
      });
      if (!reachedAt && balance >= settings.target_amount) reachedAt = date;
      if (reachedAt && index % 12 === 0 && date > addMonths(reachedAt, 12)) break;
    }
    const all = [...points.values()].sort((a, b) => a.key.localeCompare(b.key));
    const reduced = all.filter((point, index) => {
      const historical = point.realizado !== undefined;
      return historical || index === all.length - 1 || index % 12 === 0;
    });
    return { points: reduced, reachedAt };
  }, [currentBalance, monthlyRecords, movements, settings, totalContributed, totalEarnings]);

  const reserveAssets = activeAssets.filter((asset) => asset.is_emergency_reserve);
  const reserveBalance = reserveAssets.reduce(
    (sum, asset) => sum + Number(asset.current_balance),
    0,
  );
  const reserveTarget = Number(settings.essential_monthly_cost) * Number(settings.reserve_months);
  const protectedMonths =
    Number(settings.essential_monthly_cost) > 0
      ? reserveBalance / Number(settings.essential_monthly_cost)
      : 0;
  const reserveProgress =
    reserveTarget > 0 ? Math.min(100, (reserveBalance / reserveTarget) * 100) : 0;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Investimentos"
        subtitle="Patrimônio, metas e reserva de emergência"
        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => setMovementOpen(true)}
              disabled={!assets.length}
            >
              <ArrowUpFromLine className="mr-2 h-4 w-4" /> Movimentar
            </Button>
            <Button
              onClick={() => {
                setEditingAsset(null);
                setAssetOpen(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" /> Novo investimento
            </Button>
          </div>
        }
      />

      <Tabs defaultValue="carteira">
        <TabsList>
          <TabsTrigger value="carteira">Carteira e projeção</TabsTrigger>
          <TabsTrigger value="reserva">Reserva de emergência</TabsTrigger>
        </TabsList>

        <TabsContent value="carteira" className="mt-5 space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <MetricCard title="Patrimônio atual" value={brl(currentBalance)} icon={TrendingUp} />
            <MetricCard
              title="Aportes registrados"
              value={brl(totalContributed)}
              icon={WalletCards}
            />
            <MetricCard title="Rendimentos" value={brl(totalEarnings)} icon={ArrowUpFromLine} />
            <MetricCard title="Resgates" value={brl(totalWithdrawn)} icon={ArrowDownToLine} />
            <MetricCard title="Meta" value={brl(settings.target_amount)} icon={Target} />
            <MetricCard
              title="Previsão"
              value={
                projection.reachedAt
                  ? projection.reachedAt.toLocaleDateString("pt-BR", {
                      month: "short",
                      year: "numeric",
                    })
                  : "Acima de 50 anos"
              }
              icon={CalendarClock}
              subtitle={`${progress.toFixed(1)}% da meta`}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(300px,0.72fr)]">
            <section className="rounded-xl border border-border bg-card p-4">
              <h2 className="text-sm font-semibold text-card-foreground">
                Evolução patrimonial e projeção
              </h2>
              <div className="mt-4 h-[360px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={projection.points}
                    margin={{ top: 10, right: 18, left: 12, bottom: 4 }}
                  >
                    <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
                    />
                    <YAxis
                      width={76}
                      tickFormatter={(value) => brlCompact(value)}
                      tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
                    />
                    <Tooltip
                      formatter={(value, name) => [brl(Number(value)), String(name)]}
                      contentStyle={{
                        background: "var(--color-card)",
                        borderColor: "var(--color-border)",
                      }}
                    />
                    <Legend />
                    <ReferenceLine
                      y={Number(settings.target_amount)}
                      stroke="#f59e0b"
                      strokeDasharray="6 4"
                      label={{ value: "Meta", fill: "#f59e0b", position: "insideTopRight" }}
                    />
                    <Line
                      type="monotone"
                      dataKey="realizado"
                      name="Realizado"
                      stroke="#22c55e"
                      strokeWidth={3}
                      connectNulls={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="previsto"
                      name="Previsto"
                      stroke="#3b82f6"
                      strokeWidth={2.5}
                      strokeDasharray="5 4"
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="aportes"
                      name="Aportes acumulados"
                      stroke="#38bdf8"
                      strokeWidth={1.5}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="rendimentos"
                      name="Rendimentos acumulados"
                      stroke="#a78bfa"
                      strokeWidth={1.8}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>

            <ProjectionSettings
              key={savedSettings?.updated_at ?? "new-settings"}
              familyId={profile?.family_id ?? null}
              settings={settings}
              settingsId={savedSettings?.id}
              onSaved={invalidate}
            />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,0.7fr)]">
            <MonthlyTable records={monthlyRecords} onAdd={() => setMonthlyOpen(true)} />
            <ReserveSummary
              balance={reserveBalance}
              target={reserveTarget}
              progress={reserveProgress}
              protectedMonths={protectedMonths}
            />
          </div>

          <AssetTable
            assets={activeAssets}
            onEdit={(asset) => {
              setEditingAsset(asset);
              setAssetOpen(true);
            }}
          />
          <MovementTable movements={movements} assets={assets} onDeleted={invalidate} />
        </TabsContent>

        <TabsContent value="reserva" className="mt-5 space-y-5">
          <ReserveView
            key={savedSettings?.updated_at ?? "new-reserve"}
            assets={reserveAssets}
            balance={reserveBalance}
            target={reserveTarget}
            progress={reserveProgress}
            protectedMonths={protectedMonths}
            monthlyContribution={settings.monthly_contribution}
            settings={settings}
            settingsId={savedSettings?.id}
            familyId={profile?.family_id ?? null}
            onSaved={invalidate}
            onEdit={(asset) => {
              setEditingAsset(asset);
              setAssetOpen(true);
            }}
          />
        </TabsContent>
      </Tabs>

      <AssetDialog
        open={assetOpen}
        onOpenChange={setAssetOpen}
        asset={editingAsset}
        familyId={profile?.family_id ?? null}
        onSaved={invalidate}
      />
      <MovementDialog
        open={movementOpen}
        onOpenChange={setMovementOpen}
        assets={activeAssets}
        familyId={profile?.family_id ?? null}
        onSaved={invalidate}
      />
      <MonthlyDialog
        open={monthlyOpen}
        onOpenChange={setMonthlyOpen}
        familyId={profile?.family_id ?? null}
        defaultPlanned={settings.monthly_contribution}
        defaultBalance={currentBalance}
        onSaved={invalidate}
      />
    </div>
  );
}

function ProjectionSettings({
  familyId,
  settings,
  settingsId,
  onSaved,
}: {
  familyId: string | null;
  settings: typeof defaultSettings;
  settingsId?: string;
  onSaved: () => void;
}) {
  const [target, setTarget] = useState(settings.target_amount);
  const [contribution, setContribution] = useState(settings.monthly_contribution);
  const [scenario, setScenario] = useState<Scenario>(settings.active_scenario);
  const [reinvest, setReinvest] = useState(settings.reinvest_dividends);
  const [rates, setRates] = useState({
    conservative: settings.conservative_rate,
    base: settings.base_rate,
    optimistic: settings.optimistic_rate,
  });

  async function save() {
    if (!familyId) return;
    const payload = {
      family_id: familyId,
      target_amount: target,
      monthly_contribution: contribution,
      active_scenario: scenario,
      reinvest_dividends: reinvest,
      conservative_rate: rates.conservative,
      base_rate: rates.base,
      optimistic_rate: rates.optimistic,
    };
    const result = settingsId
      ? await supabase.from("investment_settings").update(payload).eq("id", settingsId)
      : await supabase.from("investment_settings").insert(payload);
    if (result.error) toast.error("Não foi possível salvar a projeção");
    else {
      toast.success("Projeção atualizada");
      onSaved();
    }
  }

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-4">
      <h2 className="text-sm font-semibold text-card-foreground">Configuração da projeção</h2>
      <div className="space-y-2">
        <Label>Meta patrimonial</Label>
        <CurrencyInput value={target} onValueChange={setTarget} />
      </div>
      <div className="space-y-2">
        <Label>Aporte mensal</Label>
        <CurrencyInput value={contribution} onValueChange={setContribution} />
      </div>
      <div className="flex items-center justify-between rounded-lg border border-border p-3">
        <div>
          <p className="text-sm text-foreground">Reaplicar dividendos</p>
          <p className="text-xs text-muted-foreground">Mantém os rendimentos na projeção.</p>
        </div>
        <Switch checked={reinvest} onCheckedChange={setReinvest} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        {(["conservador", "base", "otimista"] as const).map((item) => {
          const key =
            item === "conservador" ? "conservative" : item === "otimista" ? "optimistic" : "base";
          return (
            <button
              key={item}
              type="button"
              onClick={() => setScenario(item)}
              className={`rounded-lg border p-2 text-xs ${scenario === item ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground"}`}
            >
              <span className="block capitalize">{item}</span>
              <span>{rates[key].toFixed(1)}% a.a.</span>
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Input
          type="number"
          step="0.1"
          value={rates.conservative}
          onChange={(e) => setRates({ ...rates, conservative: Number(e.target.value) })}
          aria-label="Taxa conservadora"
        />
        <Input
          type="number"
          step="0.1"
          value={rates.base}
          onChange={(e) => setRates({ ...rates, base: Number(e.target.value) })}
          aria-label="Taxa base"
        />
        <Input
          type="number"
          step="0.1"
          value={rates.optimistic}
          onChange={(e) => setRates({ ...rates, optimistic: Number(e.target.value) })}
          aria-label="Taxa otimista"
        />
      </div>
      <Button className="w-full" onClick={save}>
        Recalcular e salvar
      </Button>
    </section>
  );
}

function MonthlyTable({ records, onAdd }: { records: MonthlyRecord[]; onAdd: () => void }) {
  const visible = [...records]
    .sort((a, b) => b.reference_month.localeCompare(a.reference_month))
    .slice(0, 8);
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-card-foreground">Previsto × realizado</h2>
        <Button size="sm" variant="outline" onClick={onAdd}>
          Confirmar mês
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left">Mês</th>
              <th className="px-4 py-3 text-right">Aporte previsto</th>
              <th className="px-4 py-3 text-right">Aporte realizado</th>
              <th className="px-4 py-3 text-right">Dividendos reaplicados</th>
              <th className="px-4 py-3 text-right">Saldo final</th>
              <th className="px-4 py-3 text-left">Situação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visible.map((record) => (
              <tr key={record.id}>
                <td className="px-4 py-3 font-medium">{monthName(record.reference_month)}</td>
                <td className="px-4 py-3 text-right">{brl(record.planned_contribution)}</td>
                <td className="px-4 py-3 text-right">{brl(record.actual_contribution)}</td>
                <td className="px-4 py-3 text-right">{brl(record.reinvested_dividends)}</td>
                <td className="px-4 py-3 text-right font-medium">{brl(record.ending_balance)}</td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${record.is_confirmed ? "border-success/30 bg-success/10 text-success" : "border-warning/30 bg-warning/10 text-warning"}`}
                  >
                    {record.is_confirmed ? "Confirmado" : "Pendente"}
                  </span>
                </td>
              </tr>
            ))}
            {!visible.length && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  Nenhum fechamento mensal confirmado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ReserveSummary({
  balance,
  target,
  progress,
  protectedMonths,
}: {
  balance: number;
  target: number;
  progress: number;
  protectedMonths: number;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="text-sm font-semibold text-card-foreground">Reserva de emergência</h2>
      <p className="mt-5 text-2xl font-semibold text-foreground">{brl(balance)}</p>
      <p className="text-sm text-muted-foreground">de {brl(target || 0)}</p>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-success" style={{ width: `${progress}%` }} />
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="font-semibold text-foreground">{protectedMonths.toFixed(1)} meses</p>
          <p className="text-xs text-muted-foreground">protegidos</p>
        </div>
        <div>
          <p className="font-semibold text-foreground">{brl(Math.max(0, target - balance))}</p>
          <p className="text-xs text-muted-foreground">faltam</p>
        </div>
      </div>
    </section>
  );
}

function AssetTable({ assets, onEdit }: { assets: Asset[]; onEdit: (asset: Asset) => void }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Carteira de investimentos</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left">Investimento</th>
              <th className="px-4 py-3 text-left">Categoria</th>
              <th className="px-4 py-3 text-left">Liquidez</th>
              <th className="px-4 py-3 text-right">Saldo atualizado</th>
              <th className="px-4 py-3 text-right">Aporte mensal</th>
              <th className="w-14" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {assets.map((asset) => (
              <tr key={asset.id}>
                <td className="px-4 py-3">
                  <p className="font-medium">{asset.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {asset.institution || "Sem instituição"} · atualizado em{" "}
                    {formatDateBR(asset.balance_date)}
                  </p>
                </td>
                <td className="px-4 py-3">
                  {CATEGORY_LABELS[asset.category] ?? asset.category}
                  {asset.is_emergency_reserve && (
                    <span className="ml-2 inline-flex rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs text-primary">
                      Reserva
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {LIQUIDITY_LABELS[asset.liquidity] ?? asset.liquidity}
                </td>
                <td className="px-4 py-3 text-right font-medium">{brl(asset.current_balance)}</td>
                <td className="px-4 py-3 text-right">{brl(asset.monthly_contribution)}</td>
                <td>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onEdit(asset)}
                    aria-label="Editar"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            ))}
            {!assets.length && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  Cadastre o primeiro investimento para iniciar a projeção.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const MOVEMENT_LABELS: Record<string, string> = {
  aporte: "Aporte",
  resgate: "Resgate",
  rendimento: "Rendimento",
  dividendo: "Dividendo recebido",
  dividendo_reaplicado: "Dividendo reaplicado",
  ajuste: "Ajuste",
};

function MovementTable({
  movements,
  assets,
  onDeleted,
}: {
  movements: InvestmentMovement[];
  assets: Asset[];
  onDeleted: () => void;
}) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const visible = [...movements]
    .sort((a, b) => b.movement_date.localeCompare(a.movement_date))
    .slice(0, 50);

  async function remove(movement: InvestmentMovement) {
    const confirmed = window.confirm(
      `Excluir ${MOVEMENT_LABELS[movement.type]?.toLowerCase() ?? "esta movimentação"} de ${brl(movement.amount)}? O saldo do investimento será corrigido automaticamente.`,
    );
    if (!confirmed) return;
    setDeletingId(movement.id);
    const { error } = await supabase.rpc("delete_investment_movement", {
      target_movement_id: movement.id,
    });
    setDeletingId(null);
    if (error) {
      toast.error("Não foi possível excluir a movimentação", { description: error.message });
      return;
    }
    toast.success("Movimentação excluída e saldo recalculado");
    onDeleted();
  }

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Movimentações dos investimentos</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Aportes, resgates, rendimentos e dividendos registrados na carteira.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/30 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left">Data</th>
              <th className="px-4 py-3 text-left">Investimento</th>
              <th className="px-4 py-3 text-left">Movimentação</th>
              <th className="px-4 py-3 text-right">Valor</th>
              <th className="w-14" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visible.map((movement) => {
              const asset = assets.find((item) => item.id === movement.investment_id);
              const isOutflow = movement.type === "resgate";
              return (
                <tr key={movement.id}>
                  <td className="px-4 py-3">{formatDateBR(movement.movement_date)}</td>
                  <td className="px-4 py-3 font-medium">
                    {asset?.name ?? "Investimento removido"}
                  </td>
                  <td className="px-4 py-3">{MOVEMENT_LABELS[movement.type] ?? movement.type}</td>
                  <td
                    className={`px-4 py-3 text-right font-medium ${isOutflow ? "text-destructive" : "text-success"}`}
                  >
                    {isOutflow ? "−" : "+"} {brl(movement.amount)}
                  </td>
                  <td>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Excluir movimentação"
                      disabled={deletingId === movement.id}
                      onClick={() => remove(movement)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </td>
                </tr>
              );
            })}
            {!visible.length && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  Nenhuma movimentação registrada.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ReserveView({
  assets,
  balance,
  target,
  progress,
  protectedMonths,
  monthlyContribution,
  settings,
  settingsId,
  familyId,
  onSaved,
  onEdit,
}: {
  assets: Asset[];
  balance: number;
  target: number;
  progress: number;
  protectedMonths: number;
  monthlyContribution: number;
  settings: typeof defaultSettings;
  settingsId?: string;
  familyId: string | null;
  onSaved: () => void;
  onEdit: (asset: Asset) => void;
}) {
  const [cost, setCost] = useState(settings.essential_monthly_cost);
  const [months, setMonths] = useState(settings.reserve_months);
  const missing = Math.max(0, target - balance);
  const monthsToGoal = monthlyContribution > 0 ? Math.ceil(missing / monthlyContribution) : null;

  async function save() {
    if (!familyId) return;
    const payload = { family_id: familyId, essential_monthly_cost: cost, reserve_months: months };
    const result = settingsId
      ? await supabase.from("investment_settings").update(payload).eq("id", settingsId)
      : await supabase.from("investment_settings").insert(payload);
    if (result.error) toast.error("Não foi possível salvar a reserva");
    else {
      toast.success("Meta da reserva atualizada");
      onSaved();
    }
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard title="Reserva atual" value={brl(balance)} icon={Landmark} />
        <MetricCard title="Meta da reserva" value={brl(target)} icon={Target} />
        <MetricCard
          title="Meses protegidos"
          value={protectedMonths.toFixed(1)}
          icon={CheckCircle2}
        />
        <MetricCard title="Valor que falta" value={brl(missing)} icon={TrendingUp} />
        <MetricCard
          title="Previsão"
          value={
            monthsToGoal === null
              ? "Defina um aporte"
              : monthsToGoal === 0
                ? "Meta alcançada"
                : `${monthsToGoal} meses`
          }
          icon={CalendarClock}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Cobertura da reserva</h2>
            <span className="text-sm font-semibold text-success">{progress.toFixed(1)}%</span>
          </div>
          <div className="mt-5 h-4 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-success transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="mt-4 flex justify-between text-sm">
            <span>{brl(balance)} acumulados</span>
            <span className="text-muted-foreground">Meta {brl(target)}</span>
          </div>
          <p className="mt-6 text-sm text-muted-foreground">
            A reserva considera apenas investimentos marcados como reserva de emergência. Priorize
            liquidez imediata ou D+1 e baixo risco.
          </p>
        </section>
        <section className="space-y-4 rounded-xl border border-border bg-card p-4">
          <h2 className="text-sm font-semibold">Configuração da reserva</h2>
          <div className="space-y-2">
            <Label>Custo essencial mensal</Label>
            <CurrencyInput value={cost} onValueChange={setCost} />
          </div>
          <div className="space-y-2">
            <Label>Meses desejados</Label>
            <Input
              type="number"
              min="1"
              step="0.5"
              value={months}
              onChange={(e) => setMonths(Number(e.target.value))}
            />
          </div>
          <Button className="w-full" onClick={save}>
            Salvar meta
          </Button>
        </section>
      </div>
      <AssetTable assets={assets} onEdit={onEdit} />
    </>
  );
}

function AssetDialog({
  open,
  onOpenChange,
  asset,
  familyId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  asset: Asset | null;
  familyId: string | null;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [institution, setInstitution] = useState("");
  const [category, setCategory] = useState("renda_fixa");
  const [balance, setBalance] = useState(0);
  const [balanceDate, setBalanceDate] = useState(toISODate(new Date()));
  const [annualRate, setAnnualRate] = useState(10);
  const [monthlyContribution, setMonthlyContribution] = useState(0);
  const [liquidity, setLiquidity] = useState("d_1");
  const [isReserve, setIsReserve] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(asset?.name ?? "");
    setInstitution(asset?.institution ?? "");
    setCategory(asset?.category ?? "renda_fixa");
    setBalance(Number(asset?.current_balance ?? 0));
    setBalanceDate(asset?.balance_date ?? toISODate(new Date()));
    setAnnualRate(Number(asset?.annual_rate ?? 10));
    setMonthlyContribution(Number(asset?.monthly_contribution ?? 0));
    setLiquidity(asset?.liquidity ?? "d_1");
    setIsReserve(asset?.is_emergency_reserve ?? false);
  }, [asset, open]);

  function sync(nextOpen: boolean) {
    onOpenChange(nextOpen);
  }

  async function save() {
    if (!familyId || !name.trim()) return;
    const payload = {
      family_id: familyId,
      name: name.trim(),
      institution: institution.trim() || null,
      category,
      current_balance: balance,
      balance_date: balanceDate,
      annual_rate: annualRate,
      monthly_contribution: monthlyContribution,
      liquidity,
      is_emergency_reserve: isReserve || category === "reserva_emergencia",
    };
    const result = asset
      ? await supabase.from("investment_assets").update(payload).eq("id", asset.id)
      : await supabase.from("investment_assets").insert(payload);
    if (result.error) toast.error("Não foi possível salvar o investimento");
    else {
      toast.success(asset ? "Investimento atualizado" : "Investimento criado");
      onOpenChange(false);
      onSaved();
    }
  }

  return (
    <Dialog open={open} onOpenChange={sync}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{asset ? "Editar investimento" : "Novo investimento"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Nome</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Tesouro Selic, CDB..."
            />
          </div>
          <div className="space-y-2">
            <Label>Instituição</Label>
            <Input value={institution} onChange={(e) => setInstitution(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Categoria</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Saldo atualizado</Label>
            <CurrencyInput value={balance} onValueChange={setBalance} />
          </div>
          <div className="space-y-2">
            <Label>Data do saldo</Label>
            <Input
              type="date"
              value={balanceDate}
              onChange={(e) => setBalanceDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Rentabilidade estimada (% a.a.)</Label>
            <Input
              type="number"
              step="0.1"
              value={annualRate}
              onChange={(e) => setAnnualRate(Number(e.target.value))}
            />
          </div>
          <div className="space-y-2">
            <Label>Aporte mensal planejado</Label>
            <CurrencyInput value={monthlyContribution} onValueChange={setMonthlyContribution} />
          </div>
          <div className="space-y-2">
            <Label>Liquidez</Label>
            <Select value={liquidity} onValueChange={setLiquidity}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(LIQUIDITY_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border p-3 sm:col-span-2">
            <div>
              <p className="text-sm">Compor a reserva de emergência</p>
              <p className="text-xs text-muted-foreground">
                O saldo entrará no cálculo de meses protegidos.
              </p>
            </div>
            <Switch checked={isReserve} onCheckedChange={setIsReserve} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={save}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MovementDialog({
  open,
  onOpenChange,
  assets,
  familyId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assets: Asset[];
  familyId: string | null;
  onSaved: () => void;
}) {
  const [assetId, setAssetId] = useState("");
  const [type, setType] = useState("aporte");
  const [amount, setAmount] = useState(0);
  const [date, setDate] = useState(toISODate(new Date()));

  async function save() {
    if (!familyId || !assetId || amount <= 0) return;
    const { error } = await supabase.rpc("register_investment_movement", {
      target_investment_id: assetId,
      movement_kind: type,
      movement_amount: amount,
      occurred_on: date,
      movement_notes: null,
    });
    if (error)
      toast.error("Não foi possível registrar a movimentação", { description: error.message });
    else {
      toast.success("Movimentação registrada");
      setAmount(0);
      onOpenChange(false);
      onSaved();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova movimentação</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Investimento</Label>
            <Select value={assetId} onValueChange={setAssetId}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                {assets.map((asset) => (
                  <SelectItem key={asset.id} value={asset.id}>
                    {asset.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Tipo</Label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="aporte">Aporte</SelectItem>
                <SelectItem value="resgate">Resgate</SelectItem>
                <SelectItem value="rendimento">Rendimento</SelectItem>
                <SelectItem value="dividendo">Dividendo recebido fora da carteira</SelectItem>
                <SelectItem value="dividendo_reaplicado">Dividendo reaplicado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Valor</Label>
            <CurrencyInput value={amount} onValueChange={setAmount} />
          </div>
          <div className="space-y-2">
            <Label>Data</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={save}>Registrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MonthlyDialog({
  open,
  onOpenChange,
  familyId,
  defaultPlanned,
  defaultBalance,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  familyId: string | null;
  defaultPlanned: number;
  defaultBalance: number;
  onSaved: () => void;
}) {
  const [month, setMonth] = useState(toISODate(monthStart(new Date())).slice(0, 7));
  const [planned, setPlanned] = useState(defaultPlanned);
  const [actual, setActual] = useState(0);
  const [dividends, setDividends] = useState(0);
  const [withdrawals, setWithdrawals] = useState(0);
  const [balance, setBalance] = useState(defaultBalance);
  useEffect(() => {
    if (!open) return;
    setPlanned(defaultPlanned);
    setBalance(defaultBalance);
  }, [defaultBalance, defaultPlanned, open]);
  async function save() {
    if (!familyId) return;
    const payload = {
      family_id: familyId,
      reference_month: `${month}-01`,
      planned_contribution: planned,
      actual_contribution: actual,
      reinvested_dividends: dividends,
      withdrawals,
      ending_balance: balance,
      is_confirmed: true,
    };
    const { error } = await supabase
      .from("investment_monthly_records")
      .upsert(payload, { onConflict: "family_id,reference_month" });
    if (error) toast.error("Não foi possível confirmar o mês");
    else {
      toast.success("Fechamento mensal confirmado");
      onOpenChange(false);
      onSaved();
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirmar mês</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Mês</Label>
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Aporte previsto</Label>
            <CurrencyInput value={planned} onValueChange={setPlanned} />
          </div>
          <div className="space-y-2">
            <Label>Aporte realizado</Label>
            <CurrencyInput value={actual} onValueChange={setActual} />
          </div>
          <div className="space-y-2">
            <Label>Dividendos reaplicados</Label>
            <CurrencyInput value={dividends} onValueChange={setDividends} />
          </div>
          <div className="space-y-2">
            <Label>Resgates</Label>
            <CurrencyInput value={withdrawals} onValueChange={setWithdrawals} />
          </div>
          <div className="space-y-2">
            <Label>Saldo final real</Label>
            <CurrencyInput value={balance} onValueChange={setBalance} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={save}>Confirmar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
