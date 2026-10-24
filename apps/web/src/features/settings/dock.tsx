import { useEffect, useState } from "react";
import { desktopInvoke, isDesktop } from "@/lib/desktop";

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
    <section
      className="settings-box rounded-[18px] border border-border p-[20px_22px]"
      aria-label="Dock"
    >
      <h2 className="text-[16px] font-medium">Dock</h2>
      <p className="mt-1 text-[13px] text-subtle-foreground">
        Turn off to keep Index only in the menu bar, out of the Dock and the app switcher. Saved on
        this Mac.
      </p>
      {status && (
        <label className="mt-4 flex items-center gap-2 text-[14px] has-disabled:opacity-60">
          <input
            type="checkbox"
            className="accent-primary"
            checked={status.visible}
            disabled={pending}
            onChange={async (event) => {
              const visible = event.target.checked;
              setPending(true);
              setError("");
              try {
                // Native code applies and saves the choice; the checkbox shows what AppKit did.
                setStatus(await desktopInvoke<DockStatus>("set_dock_visible", { visible }));
              } catch {
                setError("Could not change the Dock setting. Please try again.");
              } finally {
                setPending(false);
              }
            }}
          />
          Show in Dock
        </label>
      )}
      {error && (
        <p role="alert" className="mt-2 text-[13px] text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
