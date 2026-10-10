/* No session tokens or content caches. Only installation proof, binding and bounded dedupe IDs. */
const DB = "index-notifications-v1";
async function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("state");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function mutate(change) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("state", "readwrite"),
      store = tx.objectStore("state");
    let result;
    const request = store.get("device");
    request.onsuccess = () => {
      const state = request.result || {
        installation: btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
          .replaceAll("+", "-")
          .replaceAll("/", "_")
          .replace(/=+$/, ""),
        revision: 0,
        config: null,
        seen: [],
      };
      try {
        result = change(state);
        store.put(state, "device");
      } catch {
        tx.abort();
      }
    };
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(tx.error);
    };
  });
}
async function closeAlerts() {
  for (const n of await self.registration.getNotifications()) n.close();
}
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
let stateOperations = Promise.resolve();
self.addEventListener("message", (event) => {
  const message = event.data;
  if (!event.ports[0] || !["get", "bind", "reset"].includes(message?.type)) return;
  // Serialize complete resets (including unsubscribe) with binds from every tab.
  const operation = stateOperations.then(async () => {
    try {
      const state = await mutate((state) => {
        if (message.type === "reset") {
          state.revision++;
          state.config = null;
          state.seen = [];
        }
        if (message.type === "bind") {
          if (state.revision !== message.revision) throw new Error("Account changed");
          const u = new URL(message.config.api);
          if (
            u.protocol !== "https:" &&
            !(u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname))
          )
            throw new Error("Invalid API");
          state.config = message.config;
        }
        return state;
      });
      if (message.type === "reset") {
        await closeAlerts();
        await (await self.registration.pushManager.getSubscription())?.unsubscribe();
      }
      event.ports[0].postMessage({ state });
    } catch {
      event.ports[0].postMessage({ error: "Notification state could not be updated." });
    }
  });
  stateOperations = operation.catch(() => {});
  event.waitUntil(operation);
});
async function resolveAlert(state, id, opening = false) {
  if (!state.config) return null;
  const response = await fetch(state.config.api + "/api/v1/me/notifications/resolve", {
    method: "POST",
    credentials: "include",
    redirect: "error",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      installation: state.installation,
      sessionId: state.config.sessionId,
      id,
      opening,
    }),
  });
  if (!response.ok) return null;
  const alert = await response.json();
  const current = await mutate((s) => s);
  if (
    current.revision !== state.revision ||
    current.config?.sessionId !== state.config.sessionId ||
    alert?.recipientId !== state.config.userId
  )
    return null;
  if (!/^\/(messages|l|u)\/[a-zA-Z0-9_-]+$/.test(alert.path)) return null;
  return alert;
}
self.addEventListener("push", (event) =>
  event.waitUntil(
    (async () => {
      try {
        const id = event.data?.json()?.id;
        if (typeof id !== "string") return;
        const state = await mutate((s) => s);
        if (!state.config || state.seen.includes(id)) return;
        const alert = await resolveAlert(state, id);
        if (!alert) return;
        const display = await mutate((s) => {
          if (s.revision !== state.revision || s.seen.includes(id)) return false;
          s.seen = [...s.seen.slice(-255), id];
          return true;
        });
        if (display)
          await self.registration.showNotification(alert.title, {
            body: alert.body,
            tag: id,
            data: { id, revision: state.revision },
            icon: "/favicon.ico",
          });
        // A sign-out racing showNotification must close the result as well.
        if ((await mutate((s) => s)).revision !== state.revision) await closeAlerts();
      } catch {
        /* Failed auth/network never falls back to a stale private payload. */
      }
    })(),
  ),
);
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      try {
        const state = await mutate((s) => s);
        if (event.notification.data?.revision !== state.revision) return;
        const alert = await resolveAlert(state, event.notification.data.id, true);
        if (!alert) return;
        // Same-origin readable route performs authorization again before navigation.
        const url = new URL(alert.path, self.location.origin).href;
        const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        const existing = windows.find((w) => new URL(w.url).origin === self.location.origin);
        if (existing) {
          await existing.navigate(url);
          await existing.focus();
        } else await self.clients.openWindow(url);
      } catch {
        /* Remain closed if access or the session was revoked. */
      }
    })(),
  );
});
self.addEventListener("pushsubscriptionchange", (event) =>
  event.waitUntil(
    (async () => {
      // Re-enrollment needs a current verified session and a visible user action.
      await mutate((s) => {
        s.config = null;
        s.revision++;
        return null;
      });
      await closeAlerts();
    })(),
  ),
);
