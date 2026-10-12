import { configureAPNs, type APNsEnvironment } from "./apns";
import { configureWebPush, type WebPushEnvironment } from "./web-push";

export interface PushConfig extends APNsEnvironment, WebPushEnvironment {
  NOTIFICATIONS_ENABLED?: string;
}

// Worker bindings are immutable. Validate once per binding object, shared by API and cron.
const configurations = new WeakMap<PushConfig, ReturnType<typeof configure>>();
async function configure(env: PushConfig) {
  const enabled = env.NOTIFICATIONS_ENABLED === "true";
  if (!enabled) return { enabled, web: null, apns: null };
  const [web, apns] = await Promise.all([
    configureWebPush(env).catch(() => {
      console.warn(
        "Notifications: browser push unavailable; check VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT.",
      );
      return null;
    }),
    configureAPNs(env).catch(() => {
      console.warn(
        "Notifications: Apple push unavailable; check APNS_KEY_ID, APNS_TEAM_ID, APNS_PRIVATE_KEY, APNS_TOPIC and APNS_ENVIRONMENT.",
      );
      return null;
    }),
  ]);
  return { enabled, web, apns };
}

export function pushConfiguration(env: PushConfig) {
  let configuration = configurations.get(env);
  if (!configuration) {
    configuration = configure(env);
    configurations.set(env, configuration);
  }
  return configuration;
}

export async function notificationCapabilities(env: PushConfig) {
  const { web, apns } = await pushConfiguration(env);
  return {
    web: !!web,
    apns: !!apns,
    desktop: true,
    apnsEnvironment: apns?.environment ?? null,
    vapidPublicKey: web?.publicKey ?? null,
  };
}
