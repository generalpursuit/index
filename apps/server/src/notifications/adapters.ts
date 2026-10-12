import type { DeliveryAdapter } from "@index/api/features/notifications/delivery";
import { createAPNsSender, type ProviderTokenCache } from "./apns";
import { createWebPushSender } from "./web-push";
import { pushConfiguration, type PushConfig } from "./config";

export async function createPushAdapter(
  env: PushConfig,
  network: typeof fetch = fetch,
  tokenCache?: ProviderTokenCache,
): Promise<DeliveryAdapter> {
  const config = await pushConfiguration(env);
  const web = config.web && createWebPushSender(config.web, network);
  const apns = config.apns && createAPNsSender(config.apns, network, tokenCache);
  return async (destination, alert) => {
    if (destination.kind === "desktop") return { status: "failed" };
    if (destination.kind === "web" && web) return web(destination, alert);
    if (destination.kind === "apns" && apns) return apns(destination, alert);
    return {
      status: "retry",
      reason: config.enabled ? "provider_configuration" : "provider_disabled",
    };
  };
}
