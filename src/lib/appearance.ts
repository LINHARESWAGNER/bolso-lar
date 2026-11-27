export type Theme = "dark" | "light";
export type Density = "compacto" | "confortavel";

export type Appearance = {
  theme: Theme;
  preset: string;
  accent: string | null;
  foreground: string | null;
  background: string | null;
  surface: string | null;
  radius: number;
  density: Density;
};

export const STORAGE_KEY = "financas-theme";
export const APPEARANCE_KEY = "financas-appearance";
export const EVENT = "financas-appearance-change";

export const DEFAULT_APPEARANCE: Appearance = {
  theme: "dark",
  preset: "azul-noite",
  accent: null,
  foreground: null,
  background: null,
  surface: null,
  radius: 0.75,
  density: "confortavel",
};

export type Preset = {
  id: string;
  label: string;
  theme: Theme;
  accent: string;
  foreground: string;
  background: string;
  surface: string;
};

export const PRESETS: Preset[] = [
  {
    id: "azul-noite",
    label: "Azul-noite",
    theme: "dark",
    accent: "#3b82f6",
    foreground: "#f5f7fa",
    background: "#111827",
    surface: "#1b2436",
  },
  {
    id: "grafite",
    label: "Grafite",
    theme: "dark",
    accent: "#94a3b8",
    foreground: "#f4f4f5",
    background: "#141416",
    surface: "#202024",
  },
  {
    id: "verde",
    label: "Verde",
    theme: "dark",
    accent: "#22c55e",
    foreground: "#f0fdf4",
    background: "#0f1a14",
    surface: "#17261e",
  },
  {
    id: "roxo",
    label: "Roxo",
    theme: "dark",
    accent: "#a855f7",
    foreground: "#faf5ff",
    background: "#16111f",
    surface: "#211a2e",
  },
  {
    id: "claro",
    label: "Claro suave",
    theme: "light",
    accent: "#2563eb",
    foreground: "#0f172a",
    background: "#f7f8fb",
    surface: "#ffffff",
  },
];

/** Escolhe o texto com maior contraste WCAG sobre a cor de destaque. */
function contrastOn(hex: string) {
  const full = hex.length === 4 ? hex.slice(1).split("").map(c => c + c).join("") : hex.slice(1);
  const rgb = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) / 255)
    .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * rgb[0]! + 0.7152 * rgb[1]! + 0.0722 * rgb[2]!;
  return (luminance + 0.05) / 0.05 > 1.05 / (luminance + 0.05) ? "#000000" : "#ffffff";
}

function mix(hex: string, target: string, ratio: number) {
  const parse = (h: string) => {
    const v = h.replace("#", "").padEnd(6, "0").slice(0, 6);
    return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
  };
  const a = parse(hex);
  const b = parse(target);
  const out = a.map((c, i) =>
    Math.round(c + ((b[i] ?? 0) - c) * ratio)
      .toString(16)
      .padStart(2, "0"),
  );
  return `#${out.join("")}`;
}

export function readStoredTheme(): Theme {
  return readAppearance().theme;
}

let sessionAppearance: Appearance | undefined;

export function normalizeAppearance(value: unknown, legacy: unknown = null): Appearance {
  const data = value && typeof value === "object" ? value as Partial<Appearance> : {};
  const theme = data.theme === "light" || data.theme === "dark" ? data.theme : legacy === "light" ? "light" : "dark";
  const next = { ...DEFAULT_APPEARANCE, theme, preset: theme === "light" ? "claro" : "azul-noite" } as Appearance;
  if (typeof data.preset === "string") next.preset = data.preset;
  for (const key of ["accent", "foreground", "background", "surface"] as const) {
    const color = data[key];
    if (typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color)) next[key] = color;
  }
  if (typeof data.radius === "number" && Number.isFinite(data.radius)) next.radius = Math.max(0, Math.min(2, data.radius));
  if (data.density === "compacto") next.density = data.density;
  return next;
}

export function readAppearance(): Appearance {
  if (typeof window === "undefined") return DEFAULT_APPEARANCE;
  if (sessionAppearance) return sessionAppearance;
  let legacy: string | null = null;
  try { legacy = window.localStorage.getItem(STORAGE_KEY); } catch { /* armazenamento indisponível */ }
  try {
    const raw = window.localStorage.getItem(APPEARANCE_KEY);
    return normalizeAppearance(raw ? JSON.parse(raw) : null, legacy);
  } catch { return normalizeAppearance(null, legacy); }
}

export function clearAppearanceCache() { sessionAppearance = undefined; }

export function appearanceForTheme(current: Appearance, theme: Theme): Appearance {
  if (current.theme === theme) return current;
  // Limpa cores do modo anterior para não misturar texto claro e fundo claro.
  return { ...current, theme, preset: theme === "light" ? "claro" : "azul-noite",
    accent: null, foreground: null, background: null, surface: null };
}

/** Escreve as variáveis do tema no documento a partir das preferências. */
export function applyAppearance(a: Appearance) {
  const root = document.documentElement;
  root.classList.toggle("light", a.theme === "light");
  root.classList.toggle("dark", a.theme === "dark");
  root.style.colorScheme = a.theme;

  const vars: [string, string | null][] = [
    ["--primary", a.accent],
    ["--ring", a.accent],
    ["--sidebar-primary", a.accent],
    ["--chart-1", a.accent],
    ["--primary-foreground", a.accent ? contrastOn(a.accent) : null],
    ["--sidebar-primary-foreground", a.accent ? contrastOn(a.accent) : null],
    ["--foreground", a.foreground],
    ["--card-foreground", a.foreground],
    ["--popover-foreground", a.foreground],
    ["--sidebar-foreground", a.foreground],
    ["--background", a.background],
    ["--sidebar", a.background ? mix(a.background, a.theme === "light" ? "#ffffff" : "#000000", 0.2) : null],
    ["--card", a.surface],
    ["--surface", a.surface],
    ["--popover", a.surface],
    ["--secondary", a.surface ? mix(a.surface, a.theme === "light" ? "#000000" : "#ffffff", 0.06) : null],
    ["--muted", a.surface ? mix(a.surface, a.theme === "light" ? "#000000" : "#ffffff", 0.06) : null],
    ["--accent", a.surface ? mix(a.surface, a.theme === "light" ? "#000000" : "#ffffff", 0.1) : null],
    ["--surface-2", a.surface ? mix(a.surface, a.theme === "light" ? "#000000" : "#ffffff", 0.08) : null],
    ["--border", a.surface ? mix(a.surface, a.theme === "light" ? "#000000" : "#ffffff", 0.16) : null],
    ["--input", a.surface ? mix(a.surface, a.theme === "light" ? "#000000" : "#ffffff", 0.16) : null],
    ["--sidebar-border", a.surface ? mix(a.surface, a.theme === "light" ? "#000000" : "#ffffff", 0.16) : null],
    ["--muted-foreground", a.foreground ? mix(a.foreground, a.background ?? (a.theme === "light" ? "#ffffff" : "#000000"), 0.45) : null],
  ];
  for (const [name, value] of vars) {
    if (value) root.style.setProperty(name, value);
    else root.style.removeProperty(name);
  }
  root.style.setProperty("--radius", `${a.radius}rem`);
  root.dataset["density"] = a.density;
}

export function applyTheme(theme: Theme) {
  applyAppearance(appearanceForTheme(readAppearance(), theme));
}

export function persist(a: Appearance) {
  sessionAppearance = a;
  try {
    window.localStorage.setItem(APPEARANCE_KEY, JSON.stringify(a));
    window.localStorage.setItem(STORAGE_KEY, a.theme);
  } catch { /* A preferência continua funcionando nesta sessão. */ }
  window.dispatchEvent(new CustomEvent(EVENT));
}
