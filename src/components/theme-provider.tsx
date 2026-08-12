import { useCallback, useEffect, useState } from "react";

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

const STORAGE_KEY = "financas-theme";
const APPEARANCE_KEY = "financas-appearance";
const EVENT = "financas-appearance-change";

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

/** Preto ou branco conforme o contraste da cor de fundo. */
function contrastOn(hex: string) {
  const v = hex.replace("#", "");
  const full =
    v.length === 3
      ? v.split("").map((c) => c + c).join("")
      : v.padEnd(6, "0").slice(0, 6);
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? "#0b1220" : "#ffffff";
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

export function readAppearance(): Appearance {
  if (typeof window === "undefined") return DEFAULT_APPEARANCE;
  try {
    const raw = window.localStorage.getItem(APPEARANCE_KEY);
    if (raw) return { ...DEFAULT_APPEARANCE, ...JSON.parse(raw) } as Appearance;
  } catch {
    /* ignora json inválido */
  }
  const legacy = window.localStorage.getItem(STORAGE_KEY);
  const theme: Theme = legacy === "light" ? "light" : "dark";
  return { ...DEFAULT_APPEARANCE, theme, preset: theme === "light" ? "claro" : "azul-noite" };
}

/** Escreve as variáveis do tema no documento a partir das preferências. */
export function applyAppearance(a: Appearance) {
  const root = document.documentElement;
  root.classList.toggle("light", a.theme === "light");
  root.style.colorScheme = a.theme;

  const vars: [string, string | null][] = [
    ["--primary", a.accent],
    ["--ring", a.accent],
    ["--sidebar-primary", a.accent],
    ["--chart-1", a.accent],
    ["--primary-foreground", a.accent ? contrastOn(a.accent) : null],
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
  applyAppearance({ ...readAppearance(), theme });
}

function persist(a: Appearance) {
  window.localStorage.setItem(APPEARANCE_KEY, JSON.stringify(a));
  window.localStorage.setItem(STORAGE_KEY, a.theme);
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** Preferências de aparência persistidas no navegador. */
export function useAppearance() {
  const [appearance, setAppearance] = useState<Appearance>(DEFAULT_APPEARANCE);

  useEffect(() => {
    const sync = () => {
      const stored = readAppearance();
      setAppearance(stored);
      applyAppearance(stored);
    };
    sync();
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);

  const update = useCallback((patch: Partial<Appearance>) => {
    const next = { ...readAppearance(), ...patch };
    applyAppearance(next);
    setAppearance(next);
    persist(next);
  }, []);

  const applyPreset = useCallback((preset: Preset) => {
    update({
      preset: preset.id,
      theme: preset.theme,
      accent: preset.accent,
      foreground: preset.foreground,
      background: preset.background,
      surface: preset.surface,
    });
  }, [update]);

  const reset = useCallback(() => {
    applyAppearance(DEFAULT_APPEARANCE);
    setAppearance(DEFAULT_APPEARANCE);
    persist(DEFAULT_APPEARANCE);
  }, []);

  return { appearance, update, applyPreset, reset };
}

/** Compatibilidade: tema claro/escuro. */
export function useTheme() {
  const { appearance, update } = useAppearance();
  const setTheme = useCallback(
    (next: Theme) => {
      const preset = PRESETS.find((p) => p.theme === next);
      update(
        preset
          ? {
              theme: next,
              preset: preset.id,
              accent: preset.accent,
              foreground: preset.foreground,
              background: preset.background,
              surface: preset.surface,
            }
          : { theme: next },
      );
    },
    [update],
  );
  return { theme: appearance.theme, setTheme };
}
