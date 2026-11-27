import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_APPEARANCE, normalizeAppearance, appearanceForTheme, applyAppearance, readAppearance, persist, clearAppearanceCache } from "./appearance.ts";

test("migra preferência antiga e rejeita valores inválidos", () => {
  assert.equal(normalizeAppearance(null, "light").theme, "light");
  const result = normalizeAppearance({ theme: "invalid", foreground: "url(x)", radius: -5 });
  assert.equal(result.theme, "dark");
  assert.equal(result.foreground, null);
  assert.equal(result.radius, 0);
});

test("trocar modo remove cores incompatíveis e mantém densidade e raio", () => {
  const current = { ...DEFAULT_APPEARANCE, foreground: "#ffffff", background: "#000000", density: "compacto" as const, radius: 1 };
  const light = appearanceForTheme(current, "light");
  assert.equal(light.foreground, null);
  assert.equal(light.background, null);
  assert.equal(light.density, "compacto");
  assert.equal(light.radius, 1);
  assert.equal(appearanceForTheme(light, "dark").theme, "dark");
  assert.equal(appearanceForTheme(current, "dark"), current);
});

test("aplica ambos os modos, remove overrides e mantém controles com contraste", () => {
  const classes = new Set<string>();
  const vars = new Map<string, string>();
  const root = { classList: { toggle(name: string, enabled: boolean) { enabled ? classes.add(name) : classes.delete(name); } },
    style: { colorScheme: "", setProperty(name: string, value: string) { vars.set(name, value); }, removeProperty(name: string) { vars.delete(name); } }, dataset: {} };
  const original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { documentElement: root } });
  try {
    applyAppearance({ ...DEFAULT_APPEARANCE, accent: "#22c55e", foreground: "#ffffff" });
    assert.equal(classes.has("dark"), true);
    assert.equal(vars.get("--primary-foreground"), "#000000");
    assert.equal(vars.get("--sidebar-primary-foreground"), "#000000");
    applyAppearance(appearanceForTheme(DEFAULT_APPEARANCE, "light"));
    assert.deepEqual([...classes], ["light"]);
    assert.equal(root.style.colorScheme, "light");
    assert.equal(vars.has("--foreground"), false);
    applyAppearance(DEFAULT_APPEARANCE);
    assert.deepEqual([...classes], ["dark"]);
  } finally {
    if (original) Object.defineProperty(globalThis, "document", original);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

test("persiste, recarrega e funciona com armazenamento bloqueado ou JSON corrompido", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  const storage = new Map<string, string>();
  let blocked = false;
  let events = 0;
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    localStorage: { getItem(key: string) { if (blocked) throw Error("blocked"); return storage.get(key) ?? null; },
      setItem(key: string, value: string) { if (blocked) throw Error("blocked"); storage.set(key, value); } },
    dispatchEvent() { events++; },
  } });
  try {
    clearAppearanceCache();
    storage.set("financas-theme", "light");
    storage.set("financas-appearance", "{broken");
    assert.equal(readAppearance().theme, "light");
    persist(DEFAULT_APPEARANCE);
    clearAppearanceCache();
    assert.equal(readAppearance().theme, "dark");
    blocked = true;
    clearAppearanceCache();
    assert.doesNotThrow(() => readAppearance());
    persist(appearanceForTheme(DEFAULT_APPEARANCE, "light"));
    assert.equal(readAppearance().theme, "light");
    assert.equal(events, 2);
  } finally {
    clearAppearanceCache();
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
