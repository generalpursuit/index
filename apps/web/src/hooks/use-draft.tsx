import { createContext, useContext, useState, type ReactNode } from "react";
type Store = { drafts: Record<string, unknown>; set: (key: string, value: unknown) => void };
const Context = createContext<Store | null>(null);
// Drafts survive route navigation, stay local, and are discarded on account changes.
export function DraftProvider({ children }: { children: ReactNode }) {
  const [drafts, setDrafts] = useState<Record<string, unknown>>({});
  return (
    <Context.Provider
      value={{ drafts, set: (key, value) => setDrafts((old) => ({ ...old, [key]: value })) }}
    >
      {children}
    </Context.Provider>
  );
}
export function useDraft<T>(key: string, initial: T): [T, (value: T) => void] {
  const store = useContext(Context)!;
  return [(store.drafts[key] as T | undefined) ?? initial, (value) => store.set(key, value)];
}
