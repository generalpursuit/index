import { useEffect, useState } from "react";
import { Button } from "@index/ui/components/button";
import { rowButtonClassName, SettingsRow } from "@/features/settings/rows";
import { desktopInvoke, isDesktop, isMenuBar } from ".";

type ReleaseInfo = {
  channel: string;
  version: string;
  updatesEnabled: boolean;
  readyVersion: string | null;
};

/** Updates install silently in the background; Settings only offers to apply one sooner. */
export function DesktopUpdates() {
  const [release, setRelease] = useState<ReleaseInfo>();
  const [ready, setReady] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "checking" | "restarting" | "current">("idle");
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (!isDesktop || isMenuBar) return;
    let active = true;
    void desktopInvoke<ReleaseInfo>("desktop_release_info")
      .then((value) => {
        if (!active) return;
        setRelease(value);
        setReady(value.readyVersion);
      })
      .catch(() => {});
    const listener = window.__TAURI__?.event.listen<string>("index:update-ready", ({ payload }) => {
      if (active) setReady(payload);
    });
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
      const next = await desktopInvoke<string | null>("desktop_check_update");
      setReady(next);
      setState(next ? "idle" : "current");
    } catch (cause) {
      setError(String(cause));
      setState("idle");
    }
  }
  async function restart() {
    setError(undefined);
    setState("restarting");
    try {
      await desktopInvoke("desktop_restart_to_update");
    } catch (cause) {
      setError(String(cause));
      setState("idle");
    }
  }
  return (
    <SettingsRow
      role="group"
      aria-label="Desktop updates"
      label={release.channel === "staging" ? "Index Staging" : "Index"}
      description={
        <>
          Version {release.version}
          {ready && (
            <span className="block" role="status">
              Index {ready} is ready. It applies the next time Index opens.
            </span>
          )}
          {state === "current" && (
            <span className="block" role="status">
              You’re up to date.
            </span>
          )}
          {error && (
            <span className="block text-destructive" role="alert">
              {error}
            </span>
          )}
        </>
      }
    >
      {release.updatesEnabled && (
        <Button
          variant="outline"
          className={rowButtonClassName}
          disabled={state === "checking" || state === "restarting"}
          onClick={() => void (ready ? restart() : check())}
        >
          {state === "checking"
            ? "Checking…"
            : state === "restarting"
              ? "Restarting…"
              : ready
                ? "Restart now"
                : "Check for updates"}
        </Button>
      )}
    </SettingsRow>
  );
}

/** The API no longer supports this release: install the newest one and restart into it. */
export function DesktopUpdateRequired() {
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    desktopInvoke("desktop_restart_to_update").catch((cause) => {
      if (active) setError(String(cause));
    });
    return () => {
      active = false;
    };
  }, [attempt]);
  if (!error)
    return (
      <p className="text-sm text-subtle-foreground" role="status">
        Updating Index…
      </p>
    );
  return (
    <>
      <p className="text-sm text-destructive" role="alert">
        {error}
      </p>
      <Button
        onClick={() => {
          setError(undefined);
          setAttempt((value) => value + 1);
        }}
      >
        Try again
      </Button>
    </>
  );
}
