import { useId } from "react";
import { useTheme } from "../hooks/use-theme";
import type { ThemePreference } from "../lib/theme";

/** Native radios retain keyboard, touch and screen-reader behavior in pages and sheets. */
export function ThemeControl() {
  const id = useId();
  const { preference, setPreference } = useTheme();
  return (
    <fieldset className="min-w-0" aria-describedby={`${id}-description`}>
      <legend className="text-base font-medium">Appearance</legend>
      <p id={`${id}-description`} className="mt-1 text-[13px] text-muted-foreground">
        Choose how Index looks on this device.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {(["system", "light", "dark"] as const).map((value: ThemePreference) => (
          <label key={value} className="relative cursor-pointer">
            <input
              type="radio"
              name={`${id}-theme`}
              value={value}
              checked={preference === value}
              onChange={() => setPreference(value)}
              className="peer sr-only"
            />
            <span className="flex min-h-11 items-center rounded-full border border-border px-4 text-sm text-muted-foreground peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:outline-2 peer-focus-visible:outline-offset-3 peer-focus-visible:outline-ring hover:bg-accent">
              {value.charAt(0).toUpperCase() + value.slice(1)}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
