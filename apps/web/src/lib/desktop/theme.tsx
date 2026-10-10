import { useEffect } from "react";
import { useTheme } from "@index/ui/hooks/use-theme";
import { isDesktop } from "./index";

/** Keep native window chrome and the web content on the same device preference. */
export function DesktopTheme() {
  const { preference, resolved } = useTheme();
  useEffect(() => {
    if (!isDesktop || !window.__TAURI__) return;
    void window.__TAURI__.core.invoke("set_appearance", { preference, resolved }).catch(() => {
      // A missing bridge should not stop the web application or alter its preference.
      console.warn("The desktop window appearance could not be updated.");
    });
  }, [preference, resolved]);
  return null;
}
