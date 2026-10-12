import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { onAccountClear } from "@/lib/account-boundary";
import { MessageDraft } from "./draft";

const Context = createContext<Map<string, MessageDraft> | null>(null);
export function MessageDraftProvider({ children }: { children: ReactNode }) {
  const [drafts] = useState(() => new Map<string, MessageDraft>());
  useEffect(() => {
    const clear = () => {
      for (const draft of drafts.values()) draft.discard();
      drafts.clear();
    };
    const unsubscribe = onAccountClear(clear);
    return unsubscribe;
  }, [drafts]);
  return <Context.Provider value={drafts}>{children}</Context.Provider>;
}
export function useMessageDraft(id: string) {
  const drafts = useContext(Context)!;
  let owner = drafts.get(id);
  if (!owner) drafts.set(id, (owner = new MessageDraft(id)));
  const draft = useSyncExternalStore(owner.subscribe, owner.getSnapshot);
  return { draft, owner };
}
