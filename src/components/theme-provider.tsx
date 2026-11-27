import { useCallback, useEffect, useState } from "react";
import { DEFAULT_APPEARANCE, readAppearance, applyAppearance, persist, appearanceForTheme,
  clearAppearanceCache, EVENT, APPEARANCE_KEY, STORAGE_KEY, type Appearance, type Preset, type Theme } from "@/lib/appearance";
export * from "@/lib/appearance";

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
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === APPEARANCE_KEY || event.key === STORAGE_KEY) {
        clearAppearanceCache();
        sync();
      }
    };
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
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

export function useTheme() {
  const { appearance, update } = useAppearance();
  const setTheme = useCallback((next: Theme) => {
    update(appearanceForTheme(readAppearance(), next));
  }, [update]);
  return { theme: appearance.theme, setTheme };
}
