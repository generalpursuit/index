import { ENV } from "@/env.public";
import { isDesktop } from "@/lib/desktop";
import { accountGeneration, assertCurrentAccount } from "@/lib/account-boundary";
import { client } from "@/utils/orpc";
export type DeviceStatus = { permission: string; registered: boolean; supported: boolean };
type State = {
  installation: string;
  revision: number;
  config: { api: string; userId: string; sessionId: string } | null;
};
let worker: Promise<ServiceWorkerRegistration> | undefined;
let binding: State | null = null;
let cleanup: Promise<void> = Promise.resolve();
export const desktopInvoke = <T>(command: string, args?: Record<string, unknown>) =>
  window.__TAURI__!.core.invoke<T>(command, args);
export function supportedBrowser() {
  return (
    window.isSecureContext &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    "PushManager" in window
  );
}
function registration() {
  return (worker ??= navigator.serviceWorker.register("/notifications-sw.js").catch((error) => {
    worker = undefined;
    throw error;
  }));
}
async function stateMessage(
  type: "get" | "reset" | "bind",
  args: Record<string, unknown> = {},
): Promise<State> {
  const r = await registration();
  const active =
    r.active ??
    (await new Promise<ServiceWorker>((resolve, reject) => {
      const installing = r.installing ?? r.waiting;
      if (!installing) return reject(new Error("Notification worker is unavailable."));
      installing.addEventListener("statechange", () => {
        if (installing.state === "activated") resolve(installing);
        if (installing.state === "redundant")
          reject(new Error("Notification worker could not start."));
      });
    }));
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      reject(new Error("Notification worker did not respond."));
    }, 10_000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      channel.port1.close();
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data.state);
    };
    active.postMessage({ type, ...args }, [channel.port2]);
  });
}
function decodeKey(key: string) {
  return Uint8Array.from(atob(key.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
    c.charCodeAt(0),
  );
}
export async function deviceStatus(userId: string): Promise<DeviceStatus> {
  if (isDesktop) return desktopInvoke<DeviceStatus>("notification_status");
  if (!supportedBrowser())
    return { permission: "unsupported", registered: false, supported: false };
  const generation = accountGeneration(),
    state = await stateMessage("get");
  assertCurrentAccount(generation);
  binding = state;
  const permission = Notification.permission;
  let registered = false;
  if (state.config?.userId === userId) {
    registered = (
      await client.notifications.status({
        installation: state.installation,
        sessionId: state.config.sessionId,
      })
    ).registered;
    assertCurrentAccount(generation);
  }
  if (state.config && (state.config.userId !== userId || permission !== "granted" || !registered)) {
    await disableDevice();
    assertCurrentAccount(generation);
  }
  return { permission, registered: registered && permission === "granted", supported: true };
}
export async function enableDevice(userId: string) {
  const generation = accountGeneration();
  if (isDesktop) {
    await desktopInvoke("notification_start", { userId });
    assertCurrentAccount(generation);
    return;
  }
  if (!supportedBrowser()) throw new Error("Push notifications are not supported in this browser.");
  // User gesture reaches permission request directly; no prompt in mount/status effects.
  const permission = await Notification.requestPermission();
  assertCurrentAccount(generation);
  if (permission !== "granted")
    throw new Error(
      "Notifications are blocked. You can change permission in your browser settings.",
    );
  await cleanup;
  assertCurrentAccount(generation);
  const capabilities = await client.notifications.capabilities({});
  assertCurrentAccount(generation);
  if (!capabilities.web || !capabilities.vapidPublicKey)
    throw new Error("Browser push delivery is not configured yet.");
  const state = await stateMessage("get");
  assertCurrentAccount(generation);
  const r = await registration();
  const subscription =
    (await r.pushManager.getSubscription()) ??
    (await r.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeKey(capabilities.vapidPublicKey),
    }));
  assertCurrentAccount(generation);
  const json = subscription.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth)
    throw new Error("Browser did not provide a push subscription.");
  await client.notifications.register({
    kind: "web",
    installation: state.installation,
    sessionId: capabilities.sessionId,
    endpoint: json.endpoint,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
  });
  assertCurrentAccount(generation);
  binding = await stateMessage("bind", {
    revision: state.revision,
    config: {
      api: ENV.VITE_SERVER_URL.replace(/\/$/, ""),
      userId,
      sessionId: capabilities.sessionId,
    },
  });
  assertCurrentAccount(generation);
}
/** Clear the in-memory binding synchronously. Session IDs prevent stale removal from acting on a new login. */
export function disableDevice(): Promise<void> {
  const previous = binding;
  binding = null;
  if (isDesktop) return (cleanup = desktopInvoke<void>("notification_stop"));
  if (!supportedBrowser()) return Promise.resolve();
  const local = stateMessage("reset");
  const remote = previous?.config
    ? client.notifications.unregister({
        installation: previous.installation,
        sessionId: previous.config.sessionId,
      })
    : Promise.resolve();
  return (cleanup = Promise.allSettled([local, remote]).then(() => {}));
}
export function clearNotificationAccount() {
  if (isDesktop) {
    binding = null;
    cleanup = desktopInvoke<void>("notification_stop", { preserveClick: true }).catch(() => {});
  } else void disableDevice().catch(() => {});
}
export async function activeConversation(conversationId: string | null) {
  if (isDesktop) {
    await desktopInvoke("notification_active", { conversationId });
    return;
  }
  const current = binding;
  if (current?.config)
    await client.notifications.active({
      installation: current.installation,
      sessionId: current.config.sessionId,
      conversationId,
    });
}
