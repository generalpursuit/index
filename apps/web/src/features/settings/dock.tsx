import { useEffect, useState } from "react";
import { desktopInvoke, isDesktop } from "@/lib/desktop";
import { SwitchRow } from "./rows";

type DockStatus = { supported: boolean; visible: boolean };

export function DockSettings() {
  return isDesktop ? <DesktopDockSettings /> : null;
}

/** Without its Dock icon, Index opens from the menu bar and leaves the app switcher. */
function DesktopDockSettings() {
  const [status, setStatus] = useState<DockStatus | null>(null),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void desktopInvoke<DockStatus>("dock_status").then(
      (value) => {
        if (active) setStatus(value);
      },
      () => {
        if (active) setError("Could not load your Dock setting.");
      },
    );
    return () => {
      active = false;
    };
  }, []);
  if (status?.supported === false || (!status && !error)) return null;
  return (
    <SwitchRow
      label="Show in Dock"
      description="Off keeps Index in the menu bar only, out of the Dock and the app switcher."
      checked={status?.visible ?? true}
      disabled={!status || pending}
      onChange={async (event) => {
        const visible = event.target.checked;
        setPending(true);
        setError("");
        try {
          // Native code applies and saves the choice; the switch shows what AppKit did.
          setStatus(await desktopInvoke<DockStatus>("set_dock_visible", { visible }));
        } catch {
          setError("Could not change the Dock setting. Please try again.");
        } finally {
          setPending(false);
        }
      }}
    >
      {error && (
        <span role="alert" className="block text-destructive">
          {error}
        </span>
      )}
    </SwitchRow>
  );
}
