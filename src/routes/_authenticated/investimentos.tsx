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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/ui-bits";
import { projectPortfolio, FREQUENCIES, type ComparisonRow } from "@/lib/portfolio-projection";
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

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthName(iso: string) {
  const [year = 2026, month = 1] = iso.split("-").map(Number);
  return `${shortMonth(month)}/${String(year).slice(2)}`;
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
  const [importing, setImporting] = useState(false);
  const [selectedInvestment, setSelectedInvestment] = useState("all");
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
  const legacyPending = monthlyRecords.some((r) => r.is_confirmed && !r.migrated_investment_id);
  const legacyAsset = activeAssets.find(
    (a) => a.name.trim().toUpperCase() === "CDB" && a.institution?.toUpperCase().includes("XP"),
  );
  async function importTests() {
    if (!legacyAsset || importing) return;
    setImporting(true);
    const { error } = await supabase.rpc("import_legacy_investment_tests", {
      target_investment_id: legacyAsset.id,
    });
    setImporting(false);
    if (error) toast.error("Não foi possível associar os testes", { description: error.message });
    else {
      toast.success("Registros associados ao CDB da XP");
      invalidate();
    }
  }
  const selectedAssets =
    selectedInvestment === "all"
      ? activeAssets
      : activeAssets.filter((a) => a.id === selectedInvestment);
  const projection = useMemo(
    () =>
      projectPortfolio(
        activeAssets,
        movements,
        Number(settings.target_amount),
        monthKey(new Date()),
      ),
    [assets, movements, settings.target_amount],
  );
  const chartProjection =
    selectedInvestment === "all"
      ? projection
      : projectPortfolio(
          selectedAssets,
          movements.filter((m) => m.investment_id === selectedInvestment),
          Number(settings.target_amount),
          monthKey(new Date()),
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
    if (chartRange === "all") return chartProjection.points;
    const months = chartRange === "1y" ? 12 : chartRange === "3y" ? 36 : 60;
    return chartProjection.points.slice(0, months + 1);
  }, [chartRange, chartProjection.points]);

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
              <ArrowUpFromLine className="mr-2 h-4 w-4" /> Registrar operação
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
        {legacyPending && (
          <div className="mb-4 rounded-xl border border-amber-500/40 p-4">
            <p className="text-sm">
              Os fechamentos de teste antigos ainda não estão vinculados à carteira. Associe-os ao
              CDB da XP para incluí-los no realizado e no histórico. Os valores serão conciliados
              sem duplicação.
            </p>
            <Button className="mt-2" disabled={!legacyAsset || importing} onClick={importTests}>
              {importing ? "Associando..." : "Associar testes ao CDB da XP"}
            </Button>
            {!legacyAsset && (
              <p className="mt-2 text-xs">
                Cadastre o investimento CDB na instituição XP para continuar.
              </p>
            )}
          </div>
        )}
        <TabsList>
          <TabsTrigger value="carteira">Carteira e projeção</TabsTrigger>
          <TabsTrigger value="reserva">Reserva de emergência</TabsTrigger>
        </TabsList>

        <TabsContent value="carteira" className="mt-5 space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard title="Patrimônio atual" value={brl(currentBalance)} icon={TrendingUp} />
            <MetricCard
              title="Aportes registrados"
              value={brl(totalContributed)}
              icon={WalletCards}
            />
            <MetricCard title="Rendimentos" value={brl(totalEarnings)} icon={ArrowUpFromLine} />
            <MetricCard title="Resgates" value={brl(totalWithdrawn)} icon={ArrowDownToLine} />
            <MetricCard
              title="Rentabilidade da carteira"
              value={`Prevista: ${projection.plannedReturn === null ? "Sem dados" : projection.plannedReturn.toFixed(2) + "%"}`}
              subtitle={`Realizada: ${projection.actualReturn === null ? "Sem dados" : projection.actualReturn.toFixed(2) + "%"} · ${monthName(projection.returnStart)} a ${monthName(projection.returnEnd)} · retorno acumulado ponderado pelos aportes`}
              icon={TrendingUp}
            />
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
                  {chartProjection.crossoverAt && (
                    <p className="mt-1 text-xs text-pink-400">
                      Rendimento mensal supera o aporte em {monthName(chartProjection.crossoverAt)}
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
              <Select value={selectedInvestment} onValueChange={setSelectedInvestment}>
                <SelectTrigger className="mt-3">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os investimentos</SelectItem>
                  {activeAssets.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                    {chartProjection.crossoverAt && (
                      <ReferenceLine
                        x={chartProjection.crossoverAt}
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
                      name="Aportes previstos acumulados"
                      stroke="#38bdf8"
                      strokeWidth={1.5}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="rendimentos"
                      name="Rendimentos previstos acumulados"
                      stroke="#a78bfa"
                      strokeWidth={1.8}
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="distribuidos"
                      name="Rendimentos previstos fora da carteira"
                      stroke="#f59e0b"
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Cada investimento usa sua taxa e calendário de aportes. Aportes previstos no início
                do mês; taxa mensal equivalente à anual. Após a data fim, o saldo previsto fica
                constante. Realizado calculado somente pelos registros manuais. Valores previstos
                não alteram o patrimônio real.
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
            <ComparisonTable
              rows={chartProjection.rows}
              actualThrough={chartProjection.returnEnd}
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
            monthlyContribution={activeAssets.reduce(
              (sum, a) =>
                sum +
                (a.contribution_frequency === "mensal"
                  ? a.monthly_contribution
                  : a.contribution_frequency === "semestral"
                    ? a.monthly_contribution / 6
                    : a.contribution_frequency === "anual"
                      ? a.monthly_contribution / 12
                      : 0),
              0,
            )}
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
  settingsId?: string | undefined;
  onSaved: () => void;
}) {
  const [target, setTarget] = useState(settings.target_amount);
  async function save() {
    if (!familyId || target <= 0) return;
    const payload = { family_id: familyId, target_amount: target };
    const result = settingsId
      ? await supabase.from("investment_settings").update(payload).eq("id", settingsId)
      : await supabase.from("investment_settings").insert(payload);
    if (result.error)
      toast.error("Não foi possível salvar a meta", { description: result.error.message });
    else {
      toast.success("Meta atualizada");
      onSaved();
    }
  }
  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-4">
      <h2 className="text-sm font-semibold">Meta da carteira</h2>
      <Label>Meta patrimonial</Label>
      <CurrencyInput value={target} onValueChange={setTarget} />
      <Button onClick={save}>Salvar meta</Button>
      <p className="text-sm text-muted-foreground">
        Configure taxa, datas, frequência de aporte e reaplicação em cada investimento. O gráfico
        soma todos os planos.
      </p>
      <p className="text-xs text-muted-foreground">
        Rentabilidade: comparação acumulada no período informado, ponderada pelo tempo dos aportes e
        resgates (Modified Dietz, base mensal). Ajustes de saldo não são rendimentos. Dividendos
        recebidos fora da carteira também compõem o retorno.
      </p>
      <p className="text-xs text-muted-foreground">
        Ambiente de testes: as operações não alteram contas, receitas ou despesas.
      </p>
    </section>
  );
}

function ComparisonTable({
  rows,
  actualThrough,
}: {
  rows: ComparisonRow[];
  actualThrough: string;
}) {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const years = [...new Set(rows.map((r) => r.key.slice(0, 4)))];
  const visible = rows.filter((r) => r.key.startsWith(year));
  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-4">
        <h2 className="font-semibold">Previsto × realizado — por investimento</h2>
        <Select value={year} onValueChange={setYear}>
          <SelectTrigger className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {years.map((y) => (
              <SelectItem key={y} value={y}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full whitespace-nowrap text-sm">
          <thead>
            <tr>
              {[
                "Mês",
                "Investimento",
                "Aporte previsto",
                "Aporte realizado",
                "Rendimentos totais",
                "Dividendos reaplicados*",
                "Resgates",
                "Saldo previsto",
                "Saldo realizado",
              ].map((t) => (
                <th className="p-3 text-left" key={t}>
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr className="border-t border-border" key={r.key + r.investmentId}>
                <td className="p-3">{monthName(r.key)}</td>
                <td className="p-3">{r.name}</td>
                {[
                  r.planned,
                  r.actual,
                  r.earnings,
                  r.dividends,
                  r.withdrawals,
                  r.projected,
                  r.balance,
                ].map((v, i) => (
                  <td className="p-3 text-right" key={i}>
                    {r.key > actualThrough && i !== 0 && i !== 5 ? "—" : brl(v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="p-3 text-xs text-muted-foreground">
        * Já incluídos nos rendimentos totais. O realizado reflete apenas as operações registradas.
        Meses futuros sem registros não representam confirmação de saldo.
      </p>
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
            {brl(balance)} em {assetNames} não pode ser resgatado imediatamente. Como o patrimônio
            ainda está abaixo da meta de {brl(target)}, priorize liquidez imediata ou D+1 para a
            parcela necessária em uma emergência.
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
              <th className="px-4 py-3 text-right">Aporte planejado</th>
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
                <td className="px-4 py-3">{CATEGORY_LABELS[asset.category] ?? asset.category}</td>
                <td className="px-4 py-3">
                  {LIQUIDITY_LABELS[asset.liquidity] ?? asset.liquidity}
                </td>
                <td className="px-4 py-3 text-right font-medium">{brl(asset.current_balance)}</td>
                <td className="px-4 py-3 text-right">
                  {brl(asset.monthly_contribution)} · {FREQUENCIES[asset.contribution_frequency]}
                </td>
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
  rendimento: "Rendimento incorporado",
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
  const visible = [...movements].sort((a, b) => b.movement_date.localeCompare(a.movement_date));

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
  settingsId?: string | undefined;
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
            resgatado para reforçar o caixa mensal. Priorize liquidez imediata ou D+1 e baixo risco.
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
  const [endDate, setEndDate] = useState("");
  const [frequency, setFrequency] = useState("mensal");
  const [reinvest, setReinvest] = useState(true);
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
    setBalance(Number(asset?.initial_balance ?? 0));
    setBalanceDate(asset?.plan_start_date ?? toISODate(new Date()));
    setAnnualRate(Number(asset?.annual_rate ?? 10));
    setMonthlyContribution(Number(asset?.monthly_contribution ?? 0));
    setLiquidity(asset?.liquidity ?? "d_1");
    setEndDate(asset?.plan_end_date ?? "");
    setFrequency(asset?.contribution_frequency ?? "mensal");
    setReinvest(asset?.reinvest_earnings ?? true);
  }, [asset, open]);

  function sync(nextOpen: boolean) {
    onOpenChange(nextOpen);
  }

  async function save() {
    if (!familyId || !name.trim()) return;
    if (
      !balanceDate ||
      !endDate ||
      endDate < balanceDate ||
      annualRate <= -100 ||
      balance < 0 ||
      monthlyContribution < 0
    ) {
      toast.error("Confira as datas, os valores e a taxa (maior que -100%).");
      return;
    }
    const payload = {
      family_id: familyId,
      name: name.trim(),
      institution: institution.trim() || null,
      category,
      current_balance: asset
        ? Number(asset.current_balance) + balance - Number(asset.initial_balance)
        : balance,
      initial_balance: balance,
      plan_start_date: balanceDate,
      plan_end_date: endDate,
      contribution_frequency: frequency,
      reinvest_earnings: reinvest,
      balance_date: asset?.balance_date ?? balanceDate,
      annual_rate: annualRate,
      monthly_contribution: monthlyContribution,
      liquidity,
    };
    const result = asset
      ? await supabase.from("investment_assets").update(payload).eq("id", asset.id)
      : await supabase.from("investment_assets").insert(payload);
    if (result.error)
      toast.error("Não foi possível salvar o investimento", { description: result.error.message });
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
            <Label>Saldo inicial</Label>
            <CurrencyInput value={balance} onValueChange={setBalance} />
          </div>
          <div className="space-y-2">
            <Label>Início do plano / primeiro aporte</Label>
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
            <Label>Valor por aporte planejado</Label>
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
          <div className="space-y-2">
            <Label>Data fim</Label>
            <Input
              type="date"
              min={balanceDate}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>Frequência do aporte</Label>
            <Select value={frequency} onValueChange={setFrequency}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(FREQUENCIES).map(([v, l]) => (
                  <SelectItem key={v} value={v}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-3 sm:col-span-2">
            <Label>Reaplicar rendimentos previstos</Label>
            <Switch checked={reinvest} onCheckedChange={setReinvest} />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Conta de origem/destino</Label>
            <Input disabled value="Disponível futuramente — sem integração com contas" />
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
    if (!familyId || !assetId || amount <= 0 || !date) {
      toast.error("Informe investimento, valor e data.");
      return;
    }
    const selected = assets.find((a) => a.id === assetId);
    if (!selected || date < selected.plan_start_date) {
      toast.error("A operação não pode ser anterior ao início do investimento.");
      return;
    }
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
          <DialogTitle>Registrar operação realizada</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Conta de origem/destino</Label>
            <Input disabled value="Disponível futuramente" />
          </div>
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
                <SelectItem value="rendimento">Rendimento incorporado ao saldo</SelectItem>
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
