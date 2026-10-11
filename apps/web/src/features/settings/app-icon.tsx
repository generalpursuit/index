import { useEffect, useState } from "react";
import { desktopInvoke, isDesktop } from "@/lib/desktop";

type Icon = "ink" | "paper";
type IconStatus = { supported: boolean; icon: Icon };
const choices = [
  { id: "ink", name: "Ink" },
  { id: "paper", name: "Paper" },
] as const;

export function AppIconSettings() {
  return isDesktop ? <DesktopAppIconSettings /> : null;
}

function DesktopAppIconSettings() {
  const [status, setStatus] = useState<IconStatus | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setError(null);
    void desktopInvoke<IconStatus>("app_icon_status").then(
      (value) => {
        if (active) setStatus(value);
      },
      () => {
        if (active) setError("Could not load your app icon preference.");
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);

  async function choose(icon: Icon) {
    if (pending || icon === status?.icon) return;
    setPending(true);
    setError(null);
    try {
      // Native code applies and persists the choice. Keep the previous selection on failure.
      setStatus(await desktopInvoke<IconStatus>("set_app_icon", { icon }));
    } catch {
      setError("Could not change the app icon. Please try again.");
    } finally {
      setPending(false);
    }
  }

  if (status?.supported === false || (!status && !error)) return null;
  return (
    <section
      className="settings-box rounded-[18px] border border-border p-[20px_22px]"
      aria-label="App icon"
    >
      <h2 className="text-[16px] font-medium">App icon</h2>
      <p className="mt-1 text-[13px] text-subtle-foreground">
        Choose the Index icon in the Dock. Saved on this Mac.
      </p>
      {status && (
        <fieldset disabled={pending} className="mt-4 flex gap-3" aria-busy={pending}>
          <legend className="sr-only">App icon</legend>
          {choices.map(({ id, name }) => (
            <label key={id} className="relative cursor-pointer has-disabled:cursor-wait">
              <input
                type="radio"
                name="app-icon"
                value={id}
                checked={status.icon === id}
                onChange={() => void choose(id)}
                className="peer absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-wait"
              />
              <span className="flex min-w-24 flex-col items-center gap-2 rounded-xl border border-transparent p-3 text-[13px] peer-checked:border-foreground peer-checked:bg-muted peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-foreground peer-disabled:opacity-60">
                <img
                  src={`/app-icons/${id}.png`}
                  alt=""
                  width={64}
                  height={64}
                  className="rounded-[14px] border border-border"
                />
                {name}
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {pending && (
        <p role="status" className="mt-2 text-[13px] text-subtle-foreground">
          Changing icon…
        </p>
      )}
      {error && (
        <div className="mt-2 text-[13px]">
          <p role="alert" className="text-destructive">
            {error}
          </p>
          {!status && (
            <button
              type="button"
              className="mt-2 underline"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Try again
            </button>
          )}
        </div>
      )}
    </section>
  );
}
