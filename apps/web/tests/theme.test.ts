import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { installTheme, themeBootstrapScript } from "../src/lib/appearance/store";

function device(stored: string | null = null, dark = false, blocked = false) {
  const values = new Map(stored === null ? [] : [["index.theme", stored]]);
  const classes = new Set<string>();
  const events = new Map<string, (event: any) => void>();
  let systemChange = () => {};
  const media = {
    matches: dark,
    addEventListener: (_: string, fn: () => void) => {
      systemChange = fn;
    },
  };
  const root = {
    classList: {
      toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)),
    },
    style: { colorScheme: "" },
    dataset: {} as Record<string, string>,
  };
  const storage = {
    getItem: (key: string) => {
      if (blocked) throw new Error("Storage blocked");
      return values.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (blocked) throw new Error("Storage blocked");
      values.set(key, value);
    },
  };
  const target = {
    document: { documentElement: root },
    localStorage: storage,
    matchMedia: () => media,
    addEventListener: (event: string, fn: (event: any) => void) => events.set(event, fn),
  } as unknown as Window;
  return {
    target,
    root,
    values,
    classes,
    system: (isDark: boolean) => {
      media.matches = isDark;
      systemChange();
    },
    storage: (key: string | null, newValue: string | null) =>
      events.get("storage")?.({ key, newValue, storageArea: storage }),
  };
}

describe("device appearance", () => {
  test("the standalone bootstrap applies the saved preference synchronously", () => {
    const env = device("dark", false);
    new Function("window", themeBootstrapScript)(env.target);
    assert.equal(env.root.style.colorScheme, "dark");
    assert.equal(env.classes.has("dark"), true);
    assert.equal(installTheme(env.target), env.target.__INDEX_THEME__!);
  });
  for (const stored of [null, "invalid", "system"]) {
    test(`${stored} defaults to system and follows OS changes`, () => {
      const env = device(stored, true);
      const store = installTheme(env.target);
      assert.deepEqual(store.getSnapshot(), { preference: "system", resolved: "dark" });
      env.system(false);
      assert.deepEqual(store.getSnapshot(), { preference: "system", resolved: "light" });
    });
  }
  test("explicit preference persists, ignores OS changes and immediately returns to system", () => {
    const env = device(null, true);
    const store = installTheme(env.target);
    let updates = 0;
    const unsubscribe = store.subscribe(() => updates++);
    store.setPreference("light");
    const stable = store.getSnapshot();
    env.system(false);
    env.system(true);
    assert.equal(store.getSnapshot(), stable);
    assert.equal(env.values.get("index.theme"), "light");
    assert.equal(updates, 1);
    store.setPreference("system");
    assert.equal(store.getSnapshot().resolved, "dark");
    unsubscribe();
    store.setPreference("dark");
    assert.equal(updates, 2);
  });
  test("storage changes sync tabs and clearing storage restores system", () => {
    const env = device("light", true);
    const store = installTheme(env.target);
    env.storage("unrelated-account-cache", null);
    assert.equal(store.getSnapshot().preference, "light");
    env.storage("index.theme", "dark");
    assert.equal(store.getSnapshot().preference, "dark");
    env.storage(null, null);
    assert.deepEqual(store.getSnapshot(), { preference: "system", resolved: "dark" });
  });
  test("blocked storage keeps system and in-memory choices usable", () => {
    const env = device(null, true, true);
    const store = installTheme(env.target);
    assert.equal(store.getSnapshot().resolved, "dark");
    store.setPreference("light");
    assert.equal(env.root.style.colorScheme, "light");
  });
});
