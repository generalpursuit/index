import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from "./alert-dialog";
import { useEffectEvent, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { Button } from "./button";
import { modalCenter, modalClassName, useModalPresentation } from "./modal";
import { isComposing, isConfirm } from "../lib/keys";

type ConfirmationProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  pending?: boolean;
  onConfirm: () => void;
  label?: string;
  /** What the question takes the place of while it is asked inside a modal. */
  children?: ReactNode;
  /** Where focus goes once it is answered, when what asked was a menu item. */
  returnFocus?: RefObject<HTMLElement | null>;
} & (
  | {
      /** Shows the action as one that destroys something. It can't be undone either. */
      destructive: true;
      reversible?: never;
    }
  | {
      destructive?: false;
      /** The action can be undone, so a stray Return may confirm it: focus starts on it. */
      reversible?: boolean;
    }
);

/**
 * Asks before an action. A page asks in a dialog; a modal never opens another dialog on top of
 * itself, so inside one the question takes the place of `children` until it is answered.
 *
 * Escape cancels and ⌘↩ confirms. Focus starts on Cancel, so a Return meant for something else
 * can't confirm what may not be undone; Return confirms once the action itself has focus. Only a
 * `reversible` action starts with focus, so Return confirms it at once.
 */
export function Confirmation(props: ConfirmationProps) {
  const confirm = useRef<HTMLButtonElement>(null);
  if (useModalPresentation()) return <ConfirmationInPlace {...props} />;
  const {
    open,
    onOpenChange,
    title,
    description,
    pending,
    onConfirm,
    destructive = false,
    reversible = false,
    label = "Confirm",
    children,
    returnFocus,
  } = props;
  return (
    <>
      {children}
      <AlertDialog open={open} onOpenChange={onOpenChange}>
        <AlertDialogContent
          finalFocus={returnFocus}
          initialFocus={reversible ? confirm : undefined}
          onKeyDown={(event) => answerKeys(event.nativeEvent, () => !pending && onConfirm())}
          className={
            modalClassName +
            ` ${modalCenter} rounded-[22px] max-w-[calc(100vw_-_24px)] overflow-y-auto p-7 [@media(width<=700px)]:p-6.25 gap-5`
          }
        >
          <AlertDialogTitle
            className={"dialog-title font-semibold tracking-[-0.035em] leading-[1.1]"}
          >
            {title}
          </AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
          <div
            className={
              "action-pair flex items-center justify-end gap-2.5 mt-1 [&_button]:min-h-9.5 [&_button]:p-[0_18px] [&_button]:rounded-full"
            }
          >
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              ref={confirm}
              variant={destructive ? "destructive" : "default"}
              disabled={pending}
              onClick={onConfirm}
            >
              {pending ? "Please wait…" : label}
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * Return held down from what asked doesn't answer the question that appears, and ⌘↩ confirms
 * from anywhere in it. Returns whether the key was the question's.
 */
function answerKeys(event: KeyboardEvent, confirm: () => void) {
  if (event.key !== "Enter" || isComposing(event)) return false;
  if (event.repeat) event.preventDefault();
  else if (isConfirm(event)) {
    event.preventDefault();
    confirm();
  } else return false;
  return true;
}

/**
 * The question as a row in place of what it asks about, with the footer's buttons. The rest of
 * the modal waits for the answer: it is inert, so nothing the question is about can change and
 * focus stays with it, and its keys (Escape, ⌘↩) answer the question before the modal hears them.
 * It is announced as it appears and focus moves to its Cancel, or to its action when that is
 * reversible; once answered, focus goes back to what asked, unless it has moved on.
 */
function ConfirmationInPlace({
  open,
  onOpenChange,
  title,
  description,
  pending,
  onConfirm,
  destructive = false,
  reversible = false,
  label = "Confirm",
  children,
  returnFocus,
}: ConfirmationProps) {
  const content = useRef<HTMLDivElement>(null),
    question = useRef<HTMLDivElement>(null),
    cancel = useRef<HTMLButtonElement>(null),
    confirm = useRef<HTMLButtonElement>(null),
    // Where focus was when the question appeared, while it is asked.
    returnTo = useRef<Element>(undefined);
  const keys = useEffectEvent((event: KeyboardEvent) => {
    if (event.key === "Escape" && !isComposing(event)) {
      event.preventDefault();
      if (!pending) onOpenChange(false);
    } else if (!answerKeys(event, () => !pending && onConfirm())) return;
    event.stopPropagation();
  });
  useLayoutEffect(() => {
    if (open) {
      returnTo.current = document.activeElement ?? document.body;
      const asked = question.current!,
        modal = asked.closest<HTMLElement>('[role="dialog"]');
      const waiting = modal ? waitFor(asked, modal) : [];
      let focused: HTMLElement | null = reversible ? confirm.current : cancel.current;
      focused?.focus();
      // Focus stays with the question, such as after a click on the inert rest of the modal;
      // it can still leave the modal, which closing it does.
      const focusin = (event: FocusEvent) => {
        const target = event.target as HTMLElement;
        if (asked.contains(target)) focused = target;
        else if (modal?.contains(target)) focused?.focus();
      };
      // Captured on the window, ahead of the modal's own keys, wherever focus is.
      const keydown = (event: KeyboardEvent) => keys(event);
      document.addEventListener("focusin", focusin);
      window.addEventListener("keydown", keydown, true);
      return () => {
        document.removeEventListener("focusin", focusin);
        window.removeEventListener("keydown", keydown, true);
        for (const element of waiting) element.inert = false;
      };
    }
    const back = returnTo.current;
    returnTo.current = undefined;
    if (!back || (document.activeElement && document.activeElement !== document.body)) return;
    const target =
      returnFocus?.current ??
      (back instanceof HTMLElement && content.current?.contains(back)
        ? back
        : content.current?.querySelector<HTMLElement>("a[href], button:not(:disabled), input"));
    target?.focus();
  }, [open, returnFocus, reversible]);
  return (
    <>
      {children !== undefined && (
        <div ref={content} className="contents" hidden={open}>
          {children}
        </div>
      )}
      {open && (
        <div
          ref={question}
          className="confirmation-in-place col-span-full flex w-full flex-wrap items-center gap-x-4 gap-y-3"
        >
          <div role="alert" className="min-w-0 flex-[1_1_16rem]">
            <p className="text-[14px] font-medium text-foreground">{title}</p>
            {description && (
              <p className="mt-0.5 text-[13px] text-subtle-foreground">{description}</p>
            )}
          </div>
          <div className="ml-auto flex items-center gap-2 [&_[data-slot=button]]:min-h-9.5 [&_[data-slot=button]]:rounded-full [&_[data-slot=button]]:px-4.5">
            <Button
              ref={cancel}
              type="button"
              variant="ghost"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              ref={confirm}
              type="button"
              variant={destructive ? "destructive" : "default"}
              disabled={pending}
              onClick={onConfirm}
            >
              {pending ? "Please wait…" : label}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Makes everything in `modal` around `question` inert, apart from the modal's title, which still
 * names it. Returns what it changed, to be released once the question is answered.
 */
function waitFor(question: HTMLElement, modal: HTMLElement) {
  const waiting: HTMLElement[] = [];
  for (let node = question; node.parentElement && node !== modal; node = node.parentElement)
    for (const sibling of Array.from(node.parentElement.children))
      if (
        sibling !== node &&
        sibling instanceof HTMLElement &&
        !sibling.inert &&
        !sibling.matches('[data-slot="modal-header"]')
      ) {
        sibling.inert = true;
        waiting.push(sibling);
      }
  return waiting;
}
