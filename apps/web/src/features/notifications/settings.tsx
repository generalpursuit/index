import { useEffect, useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Preferences } from "@index/api/features/notifications/schemas";
import { Button } from "@index/ui/components/button";
import { useAPI, useViewer } from "@/hooks/use-api";
import {
  accountGeneration,
  assertCurrentAccount,
  accountMutationOptions,
} from "@/lib/account-boundary";
import { isDesktop } from "@/lib/desktop";
import {
  deviceStatus,
  enableDevice,
  disableDevice,
  homeScreenRequired,
  type DeviceStatus,
} from "./device";
// A profile gets a follow request while private and a follow while public, never both for
// the same follow, so one row controls both keys and shows on only when both are on.
const rows: { label: string; description: string; keys: (keyof Preferences)[] }[] = [
  { label: "Messages", description: "New messages in your conversations", keys: ["message"] },
  { label: "Comments", description: "When someone comments on your links", keys: ["comment"] },
  { label: "Mentions", description: "When someone mentions you in a comment", keys: ["mention"] },
  {
    label: "Followers",
    description: "New followers, or follow requests while your profile is private",
    keys: ["follow", "request"],
  },
  {
    label: "Accepted follow requests",
    description: "When someone approves your request to follow them",
    keys: ["accepted"],
  },
  {
    label: "Show message and comment previews",
    description:
      "Previews are hidden by default. Enabling them may show private text on your lock screen.",
    keys: ["previews"],
  },
];
export function NotificationSettings() {
  const api = useAPI(),
    viewer = useViewer(),
    cache = useQueryClient(),
    id = useId();
  const prefs = useQuery(api.notifications.preferences.queryOptions({ input: {} }));
  const capabilities = useQuery(api.notifications.capabilities.queryOptions({ input: {} }));
  const [status, setStatus] = useState<DeviceStatus>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const preferenceKey = api.notifications.preferences.queryKey({ input: {} });
  const update = useMutation(
    accountMutationOptions(
      api.notifications.updatePreferences.mutationOptions({
        onMutate: (patch) => {
          void cache.cancelQueries({ queryKey: preferenceKey });
          const previous = cache.getQueryData<typeof prefs.data>(preferenceKey);
          if (previous) cache.setQueryData(preferenceKey, { ...previous, ...patch });
          return previous;
        },
        onError: (_error, _patch, previous) => {
          if (previous) cache.setQueryData(preferenceKey, previous);
        },
        onSuccess: (value) =>
          cache.setQueryData(api.notifications.preferences.queryKey({ input: {} }), value),
      }),
    ),
  );
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      if (viewer)
        void deviceStatus(viewer.id)
          .then((s) => {
            if (alive) setStatus(s);
          })
          .catch(() => {
            if (alive) setError("Could not check notification registration. Try again.");
          });
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      alive = false;
      window.removeEventListener("focus", refresh);
    };
  }, [viewer?.id]);
  const configured = isDesktop ? capabilities.data?.desktop : capabilities.data?.web;
  async function changeDevice() {
    if (!viewer) return;
    const generation = accountGeneration();
    setBusy(true);
    setError(undefined);
    try {
      if (status?.registered) await disableDevice();
      else await enableDevice(viewer.id);
      assertCurrentAccount(generation);
      const next = await deviceStatus(viewer.id);
      assertCurrentAccount(generation);
      setStatus(next);
    } catch (error) {
      if (generation !== accountGeneration()) return;
      if (error instanceof Error && error.name !== "AbortError") setError(error.message);
      if (viewer)
        void deviceStatus(viewer.id)
          .then((next) => {
            if (generation === accountGeneration()) setStatus(next);
          })
          .catch(() => {});
    } finally {
      if (generation === accountGeneration()) setBusy(false);
    }
  }
  const permission = status?.permission;
  const checking = !status || (status.supported && capabilities.isPending);
  // Only an explicit answer means push is off; after a failed check, enabling reports the cause.
  // A registered device keeps its button so it can still be turned off.
  const serverOff = configured === false && !status?.registered;
  return (
    <section
      aria-label="Notifications"
      className="rounded-[18px] border border-border p-5 space-y-4"
    >
      <div>
        <h2 className="font-medium">Notifications</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose alerts for your account. Your in-app activity is always kept. No notification
          emails are sent.
        </p>
      </div>
      <div className="rounded-xl bg-muted p-3 space-y-2">
        <h3 className="text-sm font-medium">This device</h3>
        <p role="status" className="text-sm text-muted-foreground">
          {checking
            ? "Checking device permission…"
            : !status.supported
              ? homeScreenRequired()
                ? "Add Index to your Home Screen to turn on notifications."
                : "Push notifications are not supported on this device or browser."
              : serverOff
                ? "Notifications aren't available on this server yet."
                : permission === "denied"
                  ? "Blocked in system or browser settings."
                  : status.registered
                    ? "Enabled on this device."
                    : permission === "granted"
                      ? "Permission allowed. Alerts are off on this device."
                      : "Alerts are off. Permission has not been requested."}
        </p>
        {!checking && status.supported && !serverOff && (
          <Button
            type="button"
            variant="outline"
            disabled={busy || (!status.registered && permission === "denied")}
            onClick={() => void changeDevice()}
          >
            {busy
              ? "Updating…"
              : status.registered
                ? "Turn off on this device"
                : "Enable on this device"}
          </Button>
        )}
      </div>
      {prefs.data && (
        <fieldset disabled={update.isPending} className="space-y-3">
          <legend className="mb-2 text-sm font-medium">Account preferences</legend>
          {rows.map(({ label, description, keys }) => (
            <div key={label}>
              <label className="flex items-center justify-between gap-4 text-sm cursor-pointer">
                <span>{label}</span>
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  aria-describedby={`${id}-${keys[0]}`}
                  checked={keys.every((key) => prefs.data[key])}
                  onChange={(e) => {
                    const checked = e.currentTarget.checked;
                    update.mutate(Object.fromEntries(keys.map((key) => [key, checked])));
                  }}
                />
              </label>
              <p id={`${id}-${keys[0]}`} className="mt-0.5 text-xs text-muted-foreground">
                {description}
              </p>
            </div>
          ))}
        </fieldset>
      )}
      {(error || prefs.error || capabilities.error || update.error) && (
        <p role="alert" className="text-sm text-destructive">
          {error || prefs.error?.message || capabilities.error?.message || update.error?.message}
        </p>
      )}
    </section>
  );
}
