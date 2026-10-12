import { importPKCS8, SignJWT } from "jose";
import type {
  DeliveryDestination,
  DeliveryResult,
} from "@index/api/features/notifications/delivery";
import type { Alert } from "@index/api/features/notifications/schemas";
import { digest } from "@index/api/features/notifications/endpoints";
import { requestPush, responseOutcome } from "./transport";

export interface APNsEnvironment {
  APNS_KEY_ID?: string;
  APNS_TEAM_ID?: string;
  APNS_PRIVATE_KEY?: string;
  APNS_TOPIC?: string;
  APNS_ENVIRONMENT?: string;
}
export type ProviderTokenCache = (key: string, issue: () => Promise<string>) => Promise<string>;

export async function configureAPNs(env: APNsEnvironment) {
  const {
    APNS_KEY_ID: keyId,
    APNS_TEAM_ID: teamId,
    APNS_PRIVATE_KEY: pem,
    APNS_TOPIC: topic,
    APNS_ENVIRONMENT: environment,
  } = env;
  if (!keyId && !teamId && !pem && !topic && !environment) return null;
  if (!keyId || !/^[A-Z0-9]{10}$/.test(keyId) || !teamId || !/^[A-Z0-9]{10}$/.test(teamId))
    throw new Error("Invalid APNs key or team identifier");
  if (!topic || !/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(topic))
    throw new Error("Invalid APNs topic");
  if (environment !== "sandbox" && environment !== "production")
    throw new Error("Invalid APNs environment");
  if (!pem) throw new Error("Missing APNs signing key");
  const key = await importPKCS8(pem, "ES256");
  // A PKCS#8 import can accept another EC curve; signing checks ES256 usability.
  await new SignJWT({}).setProtectedHeader({ alg: "ES256" }).sign(key);
  const cacheKey = await digest(`${teamId}:${keyId}:${pem}`);
  return { keyId, teamId, topic, environment, key, cacheKey } as const;
}

export function createAPNsSender(
  config: NonNullable<Awaited<ReturnType<typeof configureAPNs>>>,
  network: typeof fetch,
  tokenCache?: ProviderTokenCache,
) {
  let localToken: { token: string; expiresAt: number } | undefined;
  const getToken = async () => {
    if (localToken && localToken.expiresAt > Date.now()) return localToken.token;
    const issue = () =>
      new SignJWT({})
        .setProtectedHeader({ alg: "ES256", kid: config.keyId })
        .setIssuer(config.teamId)
        .setIssuedAt()
        .sign(config.key);
    const token = tokenCache ? await tokenCache(config.cacheKey, issue) : await issue();
    // The durable cache owns 45-minute rotation; consult it again after a minute.
    localToken = { token, expiresAt: Date.now() + 60_000 };
    return token;
  };
  return async (
    destination: Extract<DeliveryDestination, { kind: "apns" }>,
    alert: Alert,
  ): Promise<DeliveryResult> => {
    if (destination.environment !== config.environment)
      return { status: "retry", reason: "provider_configuration" };
    if (!destination.token || !/^[a-f0-9]{64,200}$/.test(destination.token))
      return { status: "dead", reason: "invalid_destination" };
    const host =
      config.environment === "sandbox" ? "api.sandbox.push.apple.com" : "api.push.apple.com";
    const response = await requestPush(network, `https://${host}/3/device/${destination.token}`, {
      headers: {
        authorization: `bearer ${await getToken()}`,
        "apns-topic": config.topic,
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
    if (!response) return { status: "retry", reason: "network_error" };
    if (response.status === 400) {
      const error = (await response.json().catch(() => null)) as { reason?: string } | null;
      if (error?.reason === "BadDeviceToken" || error?.reason === "DeviceTokenNotForTopic")
        return { status: "dead", reason: "invalid_destination" };
      // Keep Apple response text out of logs and durable job outcomes.
      return { status: "retry", reason: "provider_configuration" };
    }
    return responseOutcome(response);
  };
}
