import { Button } from "@index/ui/components/button";
import { useSyncExternalStore } from "react";
import { isDesktop } from "@/lib/desktop";
import { DesktopUpdateRequired } from "@/lib/desktop/updates";

// Listen from module load: the first API response can arrive before React mounts.
let required = false;
const listeners = new Set<() => void>();
window.addEventListener("index:update-required", () => {
  required = true;
  listeners.forEach((listener) => listener());
});
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => void listeners.delete(listener);
};

/** Blocks the app once the API rejects this release (426) until it updates. */
export function UpdateRequired() {
  if (!useSyncExternalStore(subscribe, () => required)) return null;
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="update-required-title"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background p-7.5 text-center"
    >
      <h1 id="update-required-title" className="text-2xl font-semibold tracking-[-0.035em]">
        Update Index
      </h1>
      <p className="text-sm text-subtle-foreground">
        This version of Index is no longer supported.
      </p>
      {isDesktop ? (
        <DesktopUpdateRequired />
      ) : (
        <Button onClick={() => location.reload()}>Reload</Button>
      )}
    </div>
  );
}
