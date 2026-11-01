/**
 * The keys the app's shortcuts share: Command on Apple platforms and Control elsewhere, Enter to
 * confirm and the text an input method is still composing, which owns its keys.
 */
type Keys = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "keyCode">;

const apple = () =>
  typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

/** Keys pressed while an input method composes text, such as the Enter that ends it, are its own.
 * Safari reports that Enter only as key 229. */
export const isComposing = (event: Keys & Pick<KeyboardEvent, "isComposing">) =>
  event.isComposing || event.keyCode === 229;

/** ⌘ on Apple platforms, Ctrl elsewhere, without Option/Alt. Shift is the caller's to check. */
export const hasCommand = (event: Keys) =>
  !event.altKey && (apple() ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey);

/** How the shortcut is named for assistive technology, as in `aria-keyshortcuts`. */
export const commandShortcut = (key: string) => (apple() ? "Meta+" : "Control+") + key;

/** ⌘↩ (Ctrl+Enter): confirms from anywhere in a modal or action, multi-line fields included. */
export const isConfirm = (event: Keys) =>
  event.key === "Enter" && !event.shiftKey && hasCommand(event);

/**
 * Submits `form` as its default button would. Unlike `requestSubmit()` alone, it does nothing
 * while that button is disabled, as when a save is already under way.
 */
export function submitForm(form: HTMLFormElement) {
  const submit = Array.from(form.elements).find(
    (element): element is HTMLButtonElement | HTMLInputElement =>
      (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) &&
      element.type === "submit",
  );
  if (submit?.disabled) return;
  form.requestSubmit(submit);
}
