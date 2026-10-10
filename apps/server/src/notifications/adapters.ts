import { digest } from "@index/api/features/notifications/endpoints";
import type { DeliveryAdapter, DeliveryResult } from "@index/api/features/notifications/delivery";
import { validPushEndpoint } from "@index/api/features/notifications/endpoints";
import { apnsKey, encryptPush, signJWT, vapidKey } from "./crypto";
export interface PushConfig {
  NOTIFICATIONS_ENABLED?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  APNS_KEY_ID?: string;
  APNS_TEAM_ID?: string;
  APNS_PRIVATE_KEY?: string;
  APNS_TOPIC?: string;
  APNS_ENVIRONMENT?: string;
}
export function notificationCapabilities(env: PushConfig) {
  const enabled = env.NOTIFICATIONS_ENABLED === "true";
  const web =
    enabled &&
    !!(
      env.VAPID_PUBLIC_KEY &&
      env.VAPID_PRIVATE_KEY &&
      /^mailto:|^https:\/\//.test(env.VAPID_SUBJECT ?? "")
    );
  const apns =
    enabled &&
    !!(
      env.APNS_KEY_ID &&
      env.APNS_TEAM_ID &&
      env.APNS_PRIVATE_KEY &&
      env.APNS_TOPIC &&
      ["sandbox", "production"].includes(env.APNS_ENVIRONMENT ?? "")
    );
  return {
    web,
    apns,
    apnsEnvironment: apns ? (env.APNS_ENVIRONMENT as "sandbox" | "production") : null,
    desktop: true,
    vapidPublicKey: web ? env.VAPID_PUBLIC_KEY! : null,
  };
}
function outcome(response: Response): DeliveryResult {
  if (response.ok) return { status: "sent" };
  if ([404, 410].includes(response.status)) return { status: "dead" };
  if (response.status === 429 || response.status >= 500) {
    const value = response.headers.get("retry-after");
    const seconds =
      value && /^\d+$/.test(value)
        ? Number(value)
        : value
          ? (Date.parse(value) - Date.now()) / 1000
          : 0;
    return { status: "retry", retryAfter: Number.isFinite(seconds) ? Math.max(0, seconds) : 0 };
  }
  // Credential/configuration errors must not destroy a user's subscription.
  return { status: "retry" };
}
export function createPushAdapter(
  env: PushConfig,
  network: typeof fetch = fetch,
  tokenCache?: (key: string, create: () => Promise<string>) => Promise<string>,
): DeliveryAdapter {
  let localToken: { token: string; expiresAt: number } | undefined;
  const getToken = async () => {
    if (localToken && localToken.expiresAt > Date.now()) return localToken.token;
    const issue = () =>
      apnsKey(env.APNS_PRIVATE_KEY!).then((key) =>
        signJWT(
          key,
          { alg: "ES256", kid: env.APNS_KEY_ID },
          { iss: env.APNS_TEAM_ID, iat: Math.floor(Date.now() / 1000) },
        ),
      );
    const key = await digest(`${env.APNS_TEAM_ID}:${env.APNS_KEY_ID}:${env.APNS_PRIVATE_KEY}`);
    const token = tokenCache ? await tokenCache(key, issue) : await issue();
    // Keep only a short local cache; the durable cache owns the 45-minute rotation.
    localToken = { token, expiresAt: Date.now() + 60_000 };
    return token;
  };
  const capabilities = notificationCapabilities(env);
  return async (device, alert) => {
    const init = {
      method: "POST",
      redirect: "error" as const,
      signal: AbortSignal.timeout(10_000),
    };
    if (device.kind === "web") {
      if (!capabilities.web) return { status: "retry" };
      if (!device.endpoint || !validPushEndpoint(device.endpoint) || !device.p256dh || !device.auth)
        return { status: "dead" };
      const token = await signJWT(
        await vapidKey(env.VAPID_PUBLIC_KEY!, env.VAPID_PRIVATE_KEY!),
        { typ: "JWT", alg: "ES256" },
        {
          aud: new URL(device.endpoint).origin,
          exp: Math.floor(Date.now() / 1000) + 3600,
          sub: env.VAPID_SUBJECT,
        },
      );
      // Wake-up only: service worker resolves content with its current cookie + installation.
      // No preview, destination, user identity or credential survives in a queued push payload.
      const body = await encryptPush(device.p256dh, device.auth, JSON.stringify({ id: alert.id }));
      return outcome(
        await network(device.endpoint, {
          ...init,
          headers: {
            Authorization: `vapid t=${token}, k=${env.VAPID_PUBLIC_KEY}`,
            "Content-Encoding": "aes128gcm",
            "Content-Type": "application/octet-stream",
            TTL: "300",
            Topic: alert.id.replaceAll("-", ""),
            Urgency: "normal",
          },
          body,
        }),
      );
    }
    if (device.kind === "apns") {
      if (!capabilities.apns || device.environment !== env.APNS_ENVIRONMENT)
        return { status: "retry" };
      if (!device.endpoint || !/^[a-f0-9]{64,200}$/.test(device.endpoint))
        return { status: "dead" };
      const token = await getToken();
      const host =
        device.environment === "sandbox" ? "api.sandbox.push.apple.com" : "api.push.apple.com";
      const response = await network(`https://${host}/3/device/${device.endpoint}`, {
        ...init,
        headers: {
          authorization: `bearer ${token}`,
          "apns-topic": env.APNS_TOPIC!,
          "apns-push-type": "alert",
          "apns-priority": "10",
          "apns-expiration": "0",
          "apns-collapse-id": alert.id,
          "apns-id": alert.id,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          aps: { alert: { title: alert.title, body: alert.body }, sound: "default" },
          index: {
            id: alert.id,
            recipientId: alert.recipientId,
            path: alert.path,
            conversationId: alert.conversationId,
          },
        }),
      });
      if (response.status === 400) {
        const error = (await response.json().catch(() => null)) as { reason?: string } | null;
        if (["BadDeviceToken", "DeviceTokenNotForTopic"].includes(error?.reason ?? ""))
          return { status: "dead" };
      }
      return outcome(response);
    }
    return { status: "failed" };
  };
}
