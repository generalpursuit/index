import { useEffect, useState } from "react";
import { desktopInvoke, isDesktop } from "@/lib/desktop";
import { SettingsRow } from "./rows";

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
    <SettingsRow
      label="App icon"
      description={
        (pending || error) && (
          <>
            {pending && <span role="status">Changing icon…</span>}
            {error && (
              <span className="block">
                <span role="alert" className="text-destructive">
                  {error}
                </span>
                {!status && (
                  <button
                    type="button"
                    className="ml-2 underline"
                    onClick={() => setAttempt((value) => value + 1)}
                  >
                    Try again
                  </button>
                )}
              </span>
            )}
          </>
        )
      }
    >
      {status && (
        <fieldset disabled={pending} className="flex gap-2" aria-busy={pending}>
          <legend className="sr-only">App icon</legend>
          {choices.map(({ id, name }) => (
            <label
              key={id}
              className="relative cursor-pointer has-disabled:cursor-wait"
              title={name}
            >
              <input
                type="radio"
                name="app-icon"
                value={id}
                aria-label={name}
                checked={status.icon === id}
                onChange={() => void choose(id)}
                className="peer absolute inset-0 size-full cursor-pointer opacity-0 disabled:cursor-wait"
              />
              <img
                src={`/app-icons/${id}.png`}
                alt=""
                width={28}
                height={28}
                className="block rounded-[7px] border border-border outline-offset-2 peer-checked:outline-2 peer-checked:outline-foreground peer-focus-visible:outline-2 peer-focus-visible:outline-ring peer-disabled:opacity-60"
              />
            </label>
          ))}
        </fieldset>
      )}
    </SettingsRow>
  );
}
