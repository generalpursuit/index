import { useSyncExternalStore } from "react";
import { installTheme, type ThemePreference, type ThemeSnapshot } from "./store";

const serverSnapshot: ThemeSnapshot = { preference: "system", resolved: "light" };
const subscribe = (listener: () => void) => installTheme(window).subscribe(listener);
const getSnapshot = () => installTheme(window).getSnapshot();
const getServerSnapshot = () => serverSnapshot;

export function useTheme() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return {
    ...snapshot,
    setPreference: (preference: ThemePreference) => installTheme(window).setPreference(preference),
  };
}
