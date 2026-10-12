import { randomInt } from "node:crypto";
import { account, user } from "@index/db/schema/auth";
import { authChallenge } from "@index/db/schema/auth-security";
import { and, eq, sql } from "drizzle-orm";
import type { PgAsyncDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { APIError } from "better-auth/api";
import type { EmailTransport, SecurityEmail } from "./delivery";

type DB = Pick<PgAsyncDatabase<PgQueryResultHKT>, "select" | "update">;
type Identity = {
  user: { id: string; email: string; emailVerified: boolean };
  session: { id: string };
};
type Passwords = {
  verify(input: { hash: string; password: string }): Promise<boolean>;
  hash(password: string): Promise<string>;
};
export type SecurityOptions = {
  sendEmail: EmailTransport;
  backgroundTask?: (task: Promise<unknown>) => void;
};
const invalidCode = () =>
  new APIError("BAD_REQUEST", {
    code: "INVALID_CODE",
    message: "That code is incorrect, expired, or already used. Request a new code if needed.",
  });
const limited = () =>
  new APIError("TOO_MANY_REQUESTS", {
    code: "TRY_LATER",
    message: "Too many attempts. Wait before trying again.",
    retryAfter: 60,
  });

export function securityService(db: DB, secret: string, options: SecurityOptions) {
  async function digest(value: string) {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
    return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
  }
  const challengeKey = (purpose: string, identity: string) =>
    digest(`challenge:${purpose}:${identity}`);
  async function limit(scope: string, max: number, seconds = 3600) {
    const key = await digest(`limit:${scope}`);
    const [result] = await db
      .select({ ok: sql<boolean>`index_auth_limit(${key},${max},${seconds})` })
      .from(sql`(select 1) as auth_op`);
    return result?.ok === true;
  }
  async function throttle(scope: string, max: number, seconds = 3600) {
    if (!(await limit(scope, max, seconds))) throw limited();
  }
  async function issue(
    purpose: SecurityEmail["purpose"],
    email: string,
    identity?: Identity,
    passwordHash?: string,
  ) {
    const found =
      purpose === "reset"
        ? (await db.select().from(user).where(eq(user.email, email)).limit(1))[0]
        : identity?.user;
    const key = await challengeKey(purpose, purpose === "reset" ? email : identity!.user.id);
    // Both real and unknown reset addresses take identical challenge/rate-limit paths.
    if (
      !(await limit(`send:${key}`, 1, 60)) ||
      !(await limit(`send-hour:${key}`, 5)) ||
      !(await limit(`recipient:${email}`, 10))
    ) {
      if (purpose === "reset") return { success: true as const, retryAfter: 60 };
      throw limited();
    }
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const nonce = crypto.randomUUID();
    const hash = await digest(`${key}:${nonce}:${code}`);
    const [result] = await db
      .select({
        ok: sql<boolean>`index_auth_issue(${key},${found?.id ?? null},${identity?.session.id ?? null},${purpose},${email},${found?.email ?? email},${nonce},${hash},${passwordHash ?? null})`,
      })
      .from(sql`(select 1) as auth_op`);
    if (!result?.ok) {
      if (purpose === "reset") return { success: true as const, retryAfter: 60 };
      throw limited();
    }
    const delivery = (async () => {
      try {
        if (found) await options.sendEmail({ to: email, code, purpose, id: nonce });
        await db
          .update(authChallenge)
          .set({ delivery: "sent" })
          .where(and(eq(authChallenge.key, key), eq(authChallenge.nonce, nonce)));
      } catch {
        await db
          .update(authChallenge)
          .set({ delivery: "failed" })
          .where(and(eq(authChallenge.key, key), eq(authChallenge.nonce, nonce)));
      }
    })();
    // Recovery never waits on a provider request (including failures). Worker waitUntil
    // keeps delivery alive after its uniform response; local tests inject a capture.
    if (purpose === "reset") {
      options.backgroundTask?.(delivery);
      void delivery.catch(() => {});
    } else {
      await delivery;
    }
    return { success: true as const, retryAfter: 60 };
  }
  async function status(identity: Identity, purpose: "verify" | "change-email" = "verify") {
    const key = await challengeKey(purpose, identity.user.id);
    const [row] = await db
      .select()
      .from(authChallenge)
      .where(and(eq(authChallenge.key, key), eq(authChallenge.sessionId, identity.session.id)))
      .limit(1);
    return {
      email: row?.email ?? identity.user.email,
      pending: !!row && !row.consumed,
      delivery: row?.delivery ?? "none",
      retryAfter: row
        ? Math.max(0, Math.ceil((row.sentAt.getTime() + 60_000 - Date.now()) / 1000))
        : 0,
      expiresAt: row?.expiresAt.toISOString() ?? null,
    };
  }
  async function consume(
    purpose: SecurityEmail["purpose"],
    identity: string,
    code: string,
    sessionId?: string,
    passwordHash?: string,
  ) {
    const key = await challengeKey(purpose, identity);
    await throttle(`guess:${key}`, 25);
    const [row] = await db
      .select({ nonce: authChallenge.nonce })
      .from(authChallenge)
      .where(eq(authChallenge.key, key))
      .limit(1);
    const hash = await digest(`${key}:${row?.nonce ?? "missing"}:${code}`);
    const [result] = await db
      .select({
        result: sql<string>`index_auth_consume(${key},${hash},${sessionId ?? null},${passwordHash ?? null})`,
      })
      .from(sql`(select 1) as auth_op`);
    if (result?.result === "unavailable")
      throw new APIError("CONFLICT", {
        message: "That address cannot be used. Choose another address.",
      });
    if (result?.result !== "ok") throw invalidCode();
    return { success: true };
  }
  async function maintain() {
    if (!(await limit("maintenance", 1, 300))) return;
    const cleanup = db
      .select({ count: sql<number>`index_auth_cleanup()` })
      .from(sql`(select 1) as auth_op`)
      .then(() => {});
    // Housekeeping never changes an auth response, but waitUntil retains the task.
    const safeCleanup = cleanup.catch(() => {});
    if (options.backgroundTask) options.backgroundTask(safeCleanup);
    else await safeCleanup;
  }
  async function confirmCurrentPassword(
    identity: Identity,
    password: string,
    passwords: Passwords,
  ) {
    await throttle(`password:${identity.user.id}`, 10);
    const [credential] = await db
      .select()
      .from(account)
      .where(and(eq(account.userId, identity.user.id), eq(account.providerId, "credential")))
      .limit(1);
    if (!credential?.password || !(await passwords.verify({ hash: credential.password, password })))
      throw new APIError("BAD_REQUEST", { message: "Current password is incorrect." });
    // The exact checked hash is part of the database compare-and-set. A password
    // reset racing confirmation must invalidate this operation, not be overwritten.
    return credential.password;
  }
  function requireVerified(identity: Identity) {
    if (!identity.user.emailVerified)
      throw new APIError("FORBIDDEN", {
        code: "EMAIL_NOT_VERIFIED",
        message: "Verify your email first.",
      });
  }
  async function resendVerification(identity: Identity) {
    if (identity.user.emailVerified)
      throw new APIError("BAD_REQUEST", { message: "Email is already verified." });
    // Resume a corrected address instead of silently returning to the mistaken one.
    const pending = await status(identity);
    return issue("verify", pending.email, identity);
  }
  async function correctEmail(
    identity: Identity,
    email: string,
    password: string,
    passwords: Passwords,
  ) {
    if (identity.user.emailVerified)
      throw new APIError("BAD_REQUEST", { message: "Use Change email in Settings." });
    const hash = await confirmCurrentPassword(identity, password, passwords);
    return issue("verify", email, identity, hash);
  }
  async function requestEmailChange(
    identity: Identity,
    email: string,
    password: string,
    passwords: Passwords,
  ) {
    requireVerified(identity);
    const hash = await confirmCurrentPassword(identity, password, passwords);
    return issue("change-email", email, identity, hash);
  }
  async function resetPassword(
    email: string,
    code: string,
    password: string,
    passwords: Passwords,
  ) {
    const hash = await passwords.hash(password);
    return consume("reset", email, code, undefined, hash);
  }
  async function changePassword(
    identity: Identity,
    currentPassword: string,
    newPassword: string,
    passwords: Passwords,
  ) {
    requireVerified(identity);
    const previousHash = await confirmCurrentPassword(identity, currentPassword, passwords);
    const hash = await passwords.hash(newPassword);
    const [result] = await db
      .select({
        ok: sql<boolean>`index_auth_password(${identity.user.id},${identity.session.id},${previousHash},${hash})`,
      })
      .from(sql`(select 1) as auth_op`);
    if (!result?.ok)
      throw new APIError("BAD_REQUEST", {
        message: "Your session changed. Sign in and try again.",
      });
    return { success: true };
  }
  return {
    digest,
    throttle,
    issue,
    status,
    consume,
    maintain,
    resendVerification,
    correctEmail,
    requestEmailChange,
    resetPassword,
    changePassword,
  };
}
