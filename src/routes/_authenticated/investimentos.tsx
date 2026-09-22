import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  AlertTriangle,
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
  ReferenceDot,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/ui-bits";
import { calculateInvestments } from "@/lib/investment-projection";
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

function monthName(iso: string) {
  const [year = 2026, month = 1] = iso.split("-").map(Number);
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
  const [chartRange, setChartRange] = useState<"1y" | "3y" | "5y" | "all">("5y");

  const settings = useMemo(
    () => ({
      ...defaultSettings,
      ...(savedSettings ?? {}),
      active_scenario: (savedSettings?.active_scenario ?? "base") as Scenario,
    }),
    [savedSettings],
  );
  const activeAssets = assets.filter((asset) => asset.is_active);
  const assetBalance = activeAssets.reduce((sum, asset) => sum + Number(asset.current_balance), 0);
  const projection = useMemo(
    () =>
      calculateInvestments(
        movements,
        monthlyRecords,
        assetBalance,
        scenarioRate(settings, settings.active_scenario),
        Number(settings.monthly_contribution),
        Number(settings.target_amount),
        settings.reinvest_dividends,
        monthKey(new Date()),
      ),
    [movements, monthlyRecords, assetBalance, settings],
  );
  const {
    balance: currentBalance,
    contributed: totalContributed,
    earnings: totalEarnings,
    withdrawn: totalWithdrawn,
  } = projection;
  const progress = settings.target_amount > 0 ? (currentBalance / settings.target_amount) * 100 : 0;

  // A reserva é uma finalidade do patrimônio investido, não uma carteira separada.
  // Em uma emergência, os investimentos elegíveis são resgatados para reforçar o caixa.
  const reserveBalance = currentBalance;
  const reserveTarget = Number(settings.essential_monthly_cost) * Number(settings.reserve_months);
  const protectedMonths =
    Number(settings.essential_monthly_cost) > 0
      ? reserveBalance / Number(settings.essential_monthly_cost)
      : 0;
  const reserveProgress =
    reserveTarget > 0 ? Math.min(100, (reserveBalance / reserveTarget) * 100) : 0;
  const lockedReserveAssets =
    reserveTarget > 0 && reserveBalance < reserveTarget
      ? activeAssets.filter(
          (asset) => asset.liquidity === "carencia" && Number(asset.current_balance) > 0,
        )
      : [];
  const lockedReserveBalance = lockedReserveAssets.reduce(
    (sum, asset) => sum + Number(asset.current_balance),
    0,
  );
  const chartPoints = useMemo(() => {
    if (chartRange === "all") return projection.points;
    const months = chartRange === "1y" ? 12 : chartRange === "3y" ? 36 : 60;
    return projection.points.slice(0, months + 1);
  }, [chartRange, projection.points]);

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
                  ? new Date(projection.reachedAt + "-01T00:00:00").toLocaleDateString("pt-BR", {
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
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-card-foreground">
                    Evolução patrimonial e projeção
                  </h2>
                  {projection.crossoverAt && (
                    <p className="mt-1 text-xs text-pink-400">
                      Rendimento mensal supera o aporte em {monthName(projection.crossoverAt)}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="investment-chart-range" className="text-xs text-muted-foreground">
                    Período
                  </Label>
                  <Select
                    value={chartRange}
                    onValueChange={(value) => setChartRange(value as typeof chartRange)}
                  >
                    <SelectTrigger id="investment-chart-range" className="h-8 w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1y">1 ano</SelectItem>
                      <SelectItem value="3y">3 anos</SelectItem>
                      <SelectItem value="5y">5 anos</SelectItem>
                      <SelectItem value="all">Todo o período</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="mt-4 h-[360px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={chartPoints}
                    margin={{ top: 10, right: 18, left: 12, bottom: 4 }}
                  >
                    <CartesianGrid stroke="var(--color-border)" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="key"
                      tickFormatter={monthName}
                      tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
                    />
                    <YAxis
                      width={76}
                      tickFormatter={(value) => brlCompact(value)}
                      tick={{ fill: "var(--color-muted-foreground)", fontSize: 11 }}
                    />
                    <Tooltip
                      labelFormatter={(value) => monthName(String(value))}
                      formatter={(value, name) => [brl(Number(value)), String(name)]}
                      contentStyle={{
                        background: "var(--color-card)",
                        borderColor: "var(--color-border)",
                      }}
                    />
                    <Legend />
                    {projection.crossoverAt && (
                      <ReferenceLine
                        x={projection.crossoverAt}
                        stroke="#f472b6"
                        strokeDasharray="4 4"
                      />
                    )}
                    {chartPoints
                      .filter((point) => point.saque > 0)
                      .map((point) => (
                        <ReferenceDot
                          key={point.key}
                          x={point.key}
                          y={point.realizado ?? 0}
                          r={6}
                          fill="#ef4444"
                          stroke="#fff"
                          label={{
                            value: `Saque ${brl(point.saque)}`,
                            fill: "#ef4444",
                            position: "top",
                            fontSize: 11,
                          }}
                        />
                      ))}
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
              <p className="mt-3 text-xs text-muted-foreground">
                Taxa mensal equivalente à anual; aporte no início do mês. Rendimentos futuros
                {settings.reinvest_dividends
                  ? " reaplicados ao patrimônio."
                  : " recebidos fora da carteira."}
                {projection.crossoverAt &&
                  ` Rendimento mensal supera o aporte em ${monthName(projection.crossoverAt)}.`}{" "}
                Fechamentos confirmados consolidam os valores do mês e alimentam os cards.
              </p>
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
            <MonthlyTable
              records={monthlyRecords}
              onAdd={() => setMonthlyOpen(true)}
              onDeleted={invalidate}
            />
            <ReserveSummary
              balance={reserveBalance}
              target={reserveTarget}
              progress={reserveProgress}
              protectedMonths={protectedMonths}
              lockedAssets={lockedReserveAssets}
              lockedBalance={lockedReserveBalance}
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
            assets={activeAssets}
            balance={reserveBalance}
            target={reserveTarget}
            progress={reserveProgress}
            protectedMonths={protectedMonths}
            lockedAssets={lockedReserveAssets}
            lockedBalance={lockedReserveBalance}
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

function MonthlyTable({
  records,
  onAdd,
  onDeleted,
}: {
  records: MonthlyRecord[];
  onAdd: () => void;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState<string | null>(null);
  async function remove(record: MonthlyRecord) {
    if (
      !window.confirm(
        `Excluir a confirmação de ${monthName(record.reference_month)}? Os totais e a projeção serão recalculados usando as movimentações disponíveis. As movimentações serão mantidas.`,
      )
    )
      return;
    setDeleting(record.id);
    const { error } = await supabase
      .from("investment_monthly_records")
      .delete()
      .eq("id", record.id)
      .eq("family_id", record.family_id);
    setDeleting(null);
    if (error)
      toast.error("Não foi possível excluir a confirmação", { description: error.message });
    else {
      toast.success("Confirmação excluída");
      onDeleted();
    }
  }
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
              <th className="px-4 py-3 text-right">Ações</th>
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
                <td className="px-4 py-3 text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Excluir confirmação de ${monthName(record.reference_month)}`}
                    disabled={deleting !== null}
                    onClick={() => remove(record)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </td>
              </tr>
            ))}
            {!visible.length && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
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
  lockedAssets,
  lockedBalance,
}: {
  balance: number;
  target: number;
  progress: number;
  protectedMonths: number;
  lockedAssets: Asset[];
  lockedBalance: number;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="text-sm font-semibold text-card-foreground">Reserva em investimentos</h2>
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
      <LiquidityWarning assets={lockedAssets} balance={lockedBalance} target={target} compact />
    </section>
  );
}

function LiquidityWarning({
  assets,
  balance,
  target,
  compact = false,
}: {
  assets: Asset[];
  balance: number;
  target: number;
  compact?: boolean;
}) {
  if (!assets.length) return null;
  const assetNames = assets.map((asset) => asset.name).join(", ");
  return (
    <div
      className={`rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-100 ${compact ? "mt-4 p-3" : "p-4"}`}
    >
      <div className="flex gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
        <div>
          <p className="text-sm font-medium">Parte da reserva tem carência</p>
          <p className="mt-1 text-xs leading-relaxed text-amber-100/80">
            {brl(balance)} em {assetNames} não pode ser resgatado imediatamente. Como o
            patrimônio ainda está abaixo da meta de {brl(target)}, priorize liquidez imediata ou
            D+1 para a parcela necessária em uma emergência.
          </p>
        </div>
      </div>
    </div>
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
  lockedAssets,
  lockedBalance,
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
  lockedAssets: Asset[];
  lockedBalance: number;
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
        <MetricCard title="Patrimônio para a reserva" value={brl(balance)} icon={Landmark} />
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
            Todo o patrimônio investido compõe a reserva. Em uma emergência, o investimento é
            resgatado para reforçar o caixa mensal. Priorize liquidez imediata ou D+1 e baixo
            risco.
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
      <LiquidityWarning assets={lockedAssets} balance={lockedBalance} target={target} />
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
  const [deleting, setDeleting] = useState(false);

  async function remove() {
    if (
      !asset ||
      !familyId ||
      !window.confirm(
        `Excluir o investimento "${asset.name}" e todas as suas movimentações? Esta exclusão é permanente. Os fechamentos mensais consolidados serão mantidos e podem ser excluídos separadamente na tabela Previsto × realizado.`,
      )
    )
      return;
    setDeleting(true);
    const { error } = await supabase
      .from("investment_assets")
      .delete()
      .eq("id", asset.id)
      .eq("family_id", familyId);
    setDeleting(false);
    if (error)
      toast.error("Não foi possível excluir o investimento", { description: error.message });
    else {
      toast.success("Investimento excluído");
      onOpenChange(false);
      onSaved();
    }
  }

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
          <p className="rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground sm:col-span-2">
            Todo investimento ativo compõe a reserva de emergência. A liquidez informa em quanto
            tempo o valor pode virar caixa caso seja necessário.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          {asset && (
            <Button variant="destructive" disabled={deleting} onClick={remove}>
              <Trash2 className="mr-2 h-4 w-4" />
              Excluir investimento
            </Button>
          )}
          <Button disabled={deleting} onClick={save}>
            Salvar
          </Button>
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
