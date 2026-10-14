import { version } from "../../../../package.json";
import { ENV } from "@/env.public";
import type { authClient } from "@/lib/auth-client";
import { onAccountClear } from "@/lib/account-boundary";
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
>(queryClient, ENV.VITE_SERVER_URL.replace(/\/$/, ""), `${version}:content-1`, diskStorage);
onAccountClear(() => persistence.erase());

export async function rememberAccount(
  session: AccountSession | null,
  expiresAt: number,
  revision?: number,
) {
  if (!session?.user.emailVerified) {
    await persistence.erase();
    return;
  }
  await persistence.accept({ user: session.user, expiresAt, revision });
}
export async function restoreAccount() {
  const revision = isDesktop ? await desktopInvoke<number>("session_revision") : undefined;
  const remembered = await persistence.restore(revision);
  if (remembered) {
    if (revision !== undefined) acceptDesktopSession(revision);
    queryClient.setQueryData(["session"], { user: remembered.user }, { updatedAt: 0 });
  }
}
