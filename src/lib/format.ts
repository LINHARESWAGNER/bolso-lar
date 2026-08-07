export const brl = (value: number | null | undefined) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(
    Number(value ?? 0),
  );

export const brlCompact = (value: number | null | undefined) =>
  new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number(value ?? 0));

/** Parse a `YYYY-MM-DD` date string as a local date (no timezone shift). */
export function parseDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const parts = iso.slice(0, 10).split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  const d = parts[2];
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export function toISODate(date: Date): string {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

export function formatDateBR(iso: string | null | undefined): string {
  const d = parseDate(iso);
  return d ? d.toLocaleDateString("pt-BR") : "—";
}

export const MONTHS = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

export const monthLabel = (month: number, year: number) =>
  `${MONTHS[month - 1] ?? ""} de ${year}`;

export const shortMonth = (month: number) =>
  (MONTHS[month - 1] ?? "").slice(0, 3);