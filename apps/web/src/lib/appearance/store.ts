export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";
export type ThemeSnapshot = { preference: ThemePreference; resolved: ResolvedTheme };
export interface ThemeStore {
  getSnapshot(): ThemeSnapshot;
  subscribe(listener: () => void): () => void;
  setPreference(preference: ThemePreference): void;
}

declare global {
  interface Window {
    __INDEX_THEME__?: ThemeStore;
  }
}

/**
 * Also serialized into a blocking, same-origin script before the stylesheet. Keep this
 * function self-contained: no imports or module constants may be captured by its body.
 * Theme is device chrome, deliberately independent of session/query/draft lifecycles.
 */
export function installTheme(target: Window): ThemeStore {
  if (target.__INDEX_THEME__) return target.__INDEX_THEME__;
  const key = "index.theme";
  const media = target.matchMedia("(prefers-color-scheme: dark)");
  const normalize = (value: unknown): ThemePreference =>
    value === "light" || value === "dark" ? value : "system";
  let preference: ThemePreference = "system";
  try {
    preference = normalize(target.localStorage.getItem(key));
  } catch {
    // Private/restricted storage still gets a working, in-memory preference.
  }
  let snapshot: ThemeSnapshot;
  const listeners = new Set<() => void>();
  function apply() {
    const resolved = preference === "system" ? (media.matches ? "dark" : "light") : preference;
    const root = target.document.documentElement;
    root.classList.toggle("dark", resolved === "dark");
    root.classList.toggle("light", resolved === "light");
    root.style.colorScheme = resolved;
    root.dataset.themePreference = preference;
    if (snapshot?.preference === preference && snapshot.resolved === resolved) return;
    snapshot = { preference, resolved };
    listeners.forEach((listener) => listener());
  }
  const store: ThemeStore = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setPreference(value) {
      preference = normalize(value);
      try {
        target.localStorage.setItem(key, preference);
      } catch {
        /* Keep the local choice. */
      }
      apply();
    },
  };
  media.addEventListener("change", apply);
  target.addEventListener("storage", (event) => {
    if (event.key !== key && event.key !== null) return;
    // Ignore sessionStorage events, which do not carry a device preference.
    try {
      if (event.storageArea && event.storageArea !== target.localStorage) return;
    } catch {
      return;
    }
    preference = normalize(event.newValue);
    apply();
  });
  target.__INDEX_THEME__ = store;
  apply();
  return store;
}

export const themeBootstrapScript = `(${installTheme.toString()})(window);`;
