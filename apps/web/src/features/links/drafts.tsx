import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { onAccountClear } from "@/lib/account-boundary";
import { LinkDrafts } from "./draft";

const Context = createContext<LinkDrafts | null>(null);
export function LinkDraftProvider({ children }: { children: ReactNode }) {
  const [drafts] = useState(() => new LinkDrafts());
  useEffect(() => {
    const unsubscribe = onAccountClear(() => drafts.clear());
    return () => {
      unsubscribe();
      drafts.clear();
    };
  }, [drafts]);
  return <Context.Provider value={drafts}>{children}</Context.Provider>;
}
export const useLinkDrafts = () => useContext(Context)!;
