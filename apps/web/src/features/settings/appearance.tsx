import { useId } from "react";
import { useTheme } from "@/lib/appearance/use-theme";
import type { ThemePreference } from "@/lib/appearance/store";
import { SettingsRow } from "./rows";

/** Native radios retain keyboard, touch and screen-reader behavior in pages and sheets. */
export function ThemeControl() {
  const id = useId();
  const { preference, setPreference } = useTheme();
  return (
    <SettingsRow label="Appearance">
      <div
        role="radiogroup"
        aria-label="Appearance"
        className="flex rounded-full border border-border p-0.5"
      >
        {(["system", "light", "dark"] as const).map((value: ThemePreference) => (
          <label key={value} className="relative cursor-pointer">
            <input
              type="radio"
              name={`${id}-theme`}
              value={value}
              checked={preference === value}
              onChange={() => setPreference(value)}
              className="peer absolute inset-0 size-full cursor-pointer opacity-0"
            />
            <span className="flex h-7 items-center rounded-full px-3 text-[12px] text-subtle-foreground peer-checked:bg-foreground peer-checked:text-background peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring hover:text-foreground peer-checked:hover:text-background">
              {value.charAt(0).toUpperCase() + value.slice(1)}
            </span>
          </label>
        ))}
      </div>
    </SettingsRow>
  );
}
