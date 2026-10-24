import { useEffect, useState } from "react";
import { toast } from "sonner";
import { desktopInvoke, isDesktop } from "@/lib/desktop";
import { SwitchRow } from "./rows";

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
    <SwitchRow
      label="Launch at login"
      description="Keep Index in your menu bar after you log in."
      checked={enabled}
      disabled={!status || status.state === "not-found" || pending}
      onChange={async (event) => {
        const next = event.target.checked;
        setPending(true);
        setError("");
        try {
          setStatus(await desktopInvoke<LoginStatus>("launch_at_login_set", { enabled: next }));
        } catch {
          setError("Could not update Launch at login. Check System Settings.");
        } finally {
          setPending(false);
        }
      }}
    >
      {/* Links sit above the row's stretched label, so they don't toggle the switch. */}
      {status?.state === "requires-approval" && (
        <span className="block">
          Approval needed in System Settings.{" "}
          <button
            type="button"
            className="relative underline"
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
            className="relative ml-2 underline"
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
        </span>
      )}
      {status?.state === "not-found" && (
        <span className="block">Install Index in Applications to use Launch at login.</span>
      )}
      {error && (
        <span role="alert" className="block text-destructive">
          {error}
        </span>
      )}
    </SwitchRow>
  );
}
