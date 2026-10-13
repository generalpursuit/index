import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from "./alert-dialog";
import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { Button } from "./button";
import { modalCenter, modalClassName, useModalPresentation } from "./modal";

type ConfirmationProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  pending?: boolean;
  onConfirm: () => void;
  destructive?: boolean;
  label?: string;
  /** What the question takes the place of while it is asked inside a modal. */
  children?: ReactNode;
  /** Where focus goes once it is answered, when what asked was a menu item. */
  returnFocus?: RefObject<HTMLElement | null>;
};

/**
 * Asks before an action. A page asks in a dialog; a modal never opens another dialog on top of
 * itself, so inside one the question takes the place of `children` until it is answered.
 */
export function Confirmation(props: ConfirmationProps) {
  if (useModalPresentation()) return <ConfirmationInPlace {...props} />;
  const {
    open,
    onOpenChange,
    title,
    description,
    pending,
    onConfirm,
    destructive = false,
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
 * The question as a row in place of what it asks about, with the footer's buttons. It is
 * announced as it appears, and focus moves to its Cancel; once answered, focus goes back to
 * where it was, unless it has moved on. Escape cancels it rather than closing the modal.
 */
function ConfirmationInPlace({
  open,
  onOpenChange,
  title,
  description,
  pending,
  onConfirm,
  destructive = false,
  label = "Confirm",
  children,
  returnFocus,
}: ConfirmationProps) {
  const content = useRef<HTMLDivElement>(null),
    cancel = useRef<HTMLButtonElement>(null),
    // Where focus was when the question appeared, while it is asked.
    returnTo = useRef<Element>(undefined);
  useLayoutEffect(() => {
    if (open) {
      returnTo.current = document.activeElement ?? document.body;
      cancel.current?.focus();
      return;
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
  }, [open, returnFocus]);
  return (
    <>
      {children !== undefined && (
        <div ref={content} className="contents" hidden={open}>
          {children}
        </div>
      )}
      {open && (
        <div
          className="confirmation-in-place col-span-full flex w-full flex-wrap items-center gap-x-4 gap-y-3"
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            if (!pending) onOpenChange(false);
          }}
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
