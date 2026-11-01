import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { commandShortcut, hasCommand, isComposing } from "@index/ui/lib/keys";
import { isDesktop } from "@/lib/desktop";

/** ⌘, (Ctrl+, elsewhere) opens Settings, as in other apps. */
export const settingsShortcut = commandShortcut(",");

// In the macOS app, the Settings… item of Index's menu has the shortcut (see app_menu.rs).
const nativeMenu = isDesktop && /Mac/.test(navigator.platform);

/**
 * Settings never takes the place of an open dialog, such as a modal, a question or one waiting
 * for its action, so nothing typed or under way there is lost. Until that is answered, the
 * shortcut and the app menu's Settings… do nothing; leaving a dialog stays its own decision.
 */
export const settingsWaits = () =>
  !!document.querySelector('[role="dialog"], [role="alertdialog"]');

/** Opens Settings on its shortcut while `enabled`: signed in, as the Settings link is shown. */
export function useSettingsShortcut(enabled: boolean) {
  const navigate = useNavigate();
  useEffect(() => {
    if (!enabled || nativeMenu) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "," || event.shiftKey || !hasCommand(event)) return;
      if (event.repeat || event.defaultPrevented || isComposing(event)) return;
      event.preventDefault();
      if (!settingsWaits()) void navigate({ to: "/settings" });
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [enabled, navigate]);
}
