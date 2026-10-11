import { useEffect, useState } from "react";
import { Button } from "@index/ui/components/button";
import { toast } from "sonner";
import { desktopInvoke, isDesktop, isMenuBar } from ".";

type ReleaseInfo = { channel: string; version: string; updatesEnabled: boolean };
let info: Promise<ReleaseInfo> | undefined;
function releaseInfo() {
  return (info ??= desktopInvoke<ReleaseInfo>("desktop_release_info").catch((error) => {
    info = undefined;
    throw error;
  }));
}

export function DesktopReleaseIdentity() {
  const [staging, setStaging] = useState(false);
  useEffect(() => {
    if (!isDesktop) return;
    let active = true;
    async function check() {
      const value = await releaseInfo();
      if (active) setStaging(value.channel === "staging");
      if (!value.updatesEnabled || isMenuBar) return;
      const next = await desktopInvoke<{ version: string } | null>("desktop_check_update");
      if (active && next)
        toast.info(`Index ${next.version} is available`, {
          id: "desktop-update",
          description: "Open Settings to install and restart.",
        });
    }
    void check().catch(() => {});
    const timer = setInterval(() => void check().catch(() => {}), 4 * 60 * 60 * 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  if (!staging) return null;
  return (
    <div
      className="fixed right-3 top-2 z-50 pointer-events-none rounded-full bg-amber-200 px-2.5 py-1 text-xs font-medium text-amber-950"
      aria-label="Index Staging"
    >
      Staging
    </div>
  );
}

export function DesktopUpdates() {
  const [release, setRelease] = useState<ReleaseInfo>();
  const [available, setAvailable] = useState<string>();
  const [state, setState] = useState<"idle" | "checking" | "installing" | "current">("idle");
  const [progress, setProgress] = useState<number>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!isDesktop || isMenuBar) return;
    let active = true;
    void releaseInfo()
      .then((value) => {
        if (active) setRelease(value);
      })
      .catch(() => {});
    const listener = window.__TAURI__?.event.listen<number>(
      "index:update-progress",
      ({ payload }) => {
        if (active) setProgress(payload);
      },
    );
    return () => {
      active = false;
      void listener?.then((stop) => stop()).catch(() => {});
    };
  }, []);
  if (!release || isMenuBar) return null;
  async function check() {
    setError(undefined);
    setState("checking");
    try {
      const next = await desktopInvoke<{ version: string } | null>("desktop_check_update");
      setAvailable(next?.version);
      setState(next ? "idle" : "current");
    } catch (cause) {
      setError(String(cause));
      setState("idle");
    }
  }
  async function install() {
    setState("installing");
    setError(undefined);
    setProgress(undefined);
    try {
      await desktopInvoke("desktop_install_update", { version: available });
    } catch (cause) {
      setError(String(cause));
      setAvailable(undefined);
      setState("idle");
      toast.error("Update could not be installed");
    }
  }
  return (
    <section
      className="settings-box rounded-[18px] border border-border p-[20px_22px]"
      aria-label="Desktop updates"
    >
      <h2 className="text-base font-medium">
        {release.channel === "staging" ? "Index Staging" : "Index"}
      </h2>
      <p className="mt-1 text-sm text-subtle-foreground">Version {release.version}</p>
      {release.updatesEnabled && (
        <div className="mt-3 flex flex-col items-start gap-2">
          <Button
            variant="outline"
            disabled={state === "checking" || state === "installing"}
            onClick={() => void (available ? install() : check())}
          >
            {state === "checking"
              ? "Checking…"
              : state === "installing"
                ? `Installing${progress === undefined ? "…" : ` ${progress}%…`}`
                : available
                  ? `Install ${available} and restart`
                  : "Check for updates"}
          </Button>
          {state === "current" && (
            <p className="text-sm text-subtle-foreground" role="status">
              You’re up to date.
            </p>
          )}
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
