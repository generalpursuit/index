import { version } from "../../../../package.json";
import { ENV } from "@/env.public";
import type { authClient } from "@/lib/auth-client";
import { accountGeneration, assertCurrentAccount, onAccountClear } from "@/lib/account-boundary";
import { acceptDesktopSession, desktopInvoke, isDesktop } from "@/lib/desktop";
import { createContentPersistence } from "./persistence";
import { diskStorage } from "./storage";
import { queryClient } from "./client";

export type AccountSession = Pick<
  NonNullable<Awaited<ReturnType<typeof authClient.getSession>>["data"]>,
  "user"
>;
const persistence = createContentPersistence<
  AccountSession & { expiresAt: number; revision?: number }
>(queryClient, ENV.VITE_SERVER_URL.replace(/\/$/, ""), `${version}:content-2`, diskStorage);
const restoreBlock = `index.content.blocked.${ENV.VITE_SERVER_URL.replace(/\/$/, "")}`;
const peers =
  typeof BroadcastChannel !== "undefined" && !isDesktop
    ? new BroadcastChannel(`index.account.${ENV.VITE_SERVER_URL.replace(/\/$/, "")}`)
    : undefined;
let receiving = false;
let rememberedAccount: string | undefined;
onAccountClear(() => {
  rememberedAccount = undefined;
  // Erasure can fail independently of browser storage. Keep that disk cache unread
  // until a verified network session successfully binds its account again.
  try {
    localStorage.setItem(restoreBlock, "true");
  } catch {
    /* Storage may be disabled. */
  }
  if (!receiving) peers?.postMessage(null);
  return persistence.erase().catch(() => {});
});
if (peers)
  peers.onmessage = ({ data }) => {
    if (data && data === queryClient.getQueryData<AccountSession>(["session"])?.user.id) return;
    receiving = true;
    window.dispatchEvent(new Event("index:session-expired"));
    receiving = false;
  };

export async function rememberAccount(
  session: AccountSession | null,
  expiresAt: number,
  revision?: number,
) {
  const generation = accountGeneration();
  if (!session?.user.emailVerified) {
    await persistence.erase().catch(() => {});
    return;
  }
  const saved = await persistence
    .accept({ user: session.user, expiresAt, revision })
    .catch(() => false);
  assertCurrentAccount(generation);
  if (saved) {
    try {
      localStorage.removeItem(restoreBlock);
    } catch {
      /* Keep network-only behavior. */
    }
  }
  if (rememberedAccount !== session.user.id) {
    rememberedAccount = session.user.id;
    peers?.postMessage(session.user.id);
  }
}
export async function restoreAccount() {
  try {
    if (localStorage.getItem(restoreBlock)) return;
  } catch {
    return;
  }
  const revision = isDesktop ? await desktopInvoke<number>("session_revision") : undefined;
  const remembered = await persistence.restore(revision);
  if (remembered) {
    rememberedAccount = remembered.user.id;
    if (revision !== undefined) acceptDesktopSession(revision);
    queryClient.setQueryData(["session"], { user: remembered.user }, { updatedAt: 0 });
  }
}
