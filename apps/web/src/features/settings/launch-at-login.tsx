import { useEffect, useState } from "react";
import { toast } from "sonner";
import { desktopInvoke, isDesktop } from "@/lib/desktop";

type LoginStatus = {
  supported: boolean;
  state: "off" | "enabled" | "requires-approval" | "not-found" | "unsupported";
};

export function LaunchAtLoginSettings() {
  return isDesktop ? <DesktopLaunchAtLogin /> : null;
}

/** macOS owns the login item: approval and failures never appear as enabled. */
function DesktopLaunchAtLogin() {
  const [status, setStatus] = useState<LoginStatus | null>(null),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const read = () =>
      void desktopInvoke<LoginStatus>("launch_at_login_status")
        .then((value) => {
          if (active) {
            setStatus(value);
            setError("");
          }
        })
        .catch(() => {
          if (active) setError("Could not read Launch at login.");
        });
    read();
    // Approval happens in System Settings; returning here shows its result.
    window.addEventListener("focus", read);
    return () => {
      active = false;
      window.removeEventListener("focus", read);
    };
  }, []);
  // Other platforms, older macOS and unbundled builds have no login item.
  if (status?.supported === false || (!status && !error)) return null;
  const enabled = status?.state === "enabled";
  return (
    <section
      className="settings-box rounded-[18px] border border-border p-[20px_22px]"
      aria-label="Launch at login"
    >
      <h2 className="text-[16px] font-medium">Launch at login</h2>
      <p className="mt-1 text-[13px] text-subtle-foreground">
        Keep Index in your menu bar after you log in to this Mac.
      </p>
      {status && (
        <label className="mt-4 flex items-center gap-2 text-[14px] has-disabled:opacity-60">
          <input
            type="checkbox"
            className="accent-primary"
            checked={enabled}
            disabled={status.state === "not-found" || pending}
            onChange={async (event) => {
              const next = event.target.checked;
              setPending(true);
              setError("");
              try {
                setStatus(
                  await desktopInvoke<LoginStatus>("launch_at_login_set", { enabled: next }),
                );
              } catch {
                setError("Could not update Launch at login. Check System Settings.");
              } finally {
                setPending(false);
              }
            }}
          />
          Launch at login
        </label>
      )}
      {status?.state === "requires-approval" && (
        <p className="mt-2 text-[13px] text-subtle-foreground">
          Approval needed in System Settings.{" "}
          <button
            type="button"
            className="underline"
            onClick={() =>
              void desktopInvoke("launch_at_login_settings").catch(() =>
                toast.error("Could not open System Settings. Try again."),
              )
            }
          >
            Open Login Items
          </button>
          <button
            type="button"
            className="ml-2 underline"
            disabled={pending}
            onClick={async () => {
              setPending(true);
              try {
                setStatus(
                  await desktopInvoke<LoginStatus>("launch_at_login_set", { enabled: false }),
                );
              } catch {
                setError("Could not cancel Launch at login.");
              } finally {
                setPending(false);
              }
            }}
          >
            Cancel request
          </button>
        </p>
      )}
      {status?.state === "not-found" && (
        <p className="mt-2 text-[13px] text-subtle-foreground">
          Install Index in Applications to use Launch at login.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-[13px] text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
