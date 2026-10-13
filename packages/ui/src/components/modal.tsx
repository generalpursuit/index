import { Children, createContext, useContext, type ReactNode, type RefObject } from "react";
import { Button } from "./button";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "./dialog";
import { Drawer, DrawerContent, DrawerTitle, DrawerDescription } from "./drawer";
import { useMediaQuery } from "../hooks/use-media-query";

/** Surface and title typography shared by Modal and Confirmation. */
export const modalClassName =
  "app-dialog select-none bg-surface text-foreground border-border wrap-anywhere min-w-0 [&_.dialog-title]:font-serif [&_.dialog-title]:text-[26px] [&_.dialog-title]:font-bold [&_.dialog-title]:[font-variation-settings:'opsz'_60] [&_.dialog-title]:tracking-[-0.015em] [&_.dialog-title]:leading-[1.15]";

// Each replaces the dialog primitive's `sm:max-w-sm`, which would cap every size at small.
const modalSizes = {
  sm: "w-96 sm:max-w-[calc(100vw_-_32px)]",
  md: "w-150 sm:max-w-[calc(100vw_-_32px)]",
  lg: "w-162.5 sm:max-w-[calc(100vw_-_32px)]",
};
// Dialogs stay vertically centered; a bounded height keeps the header and actions on screen.
const dialogHeight = "max-h-[min(640px,_calc(100dvh_-_80px))]";
const fixedDialogHeight = "h-[min(640px,_calc(100dvh_-_80px))]";

const ModalPresentation = createContext<"dialog" | "sheet">("dialog");

/**
 * A titled dialog on larger screens and a swipeable bottom sheet on phones. The title row stays
 * put while the children scroll beneath it; put actions in a `ModalFooter` to pin them below.
 */
export function Modal({
  open,
  onOpenChange,
  title,
  hideTitle = false,
  description,
  children,
  className = "",
  size = "sm",
  fixedHeight = false,
  returnFocus,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  /** Keeps the title for assistive technology when the content shows its own heading. */
  hideTitle?: boolean;
  description?: string;
  children: ReactNode;
  className?: string;
  size?: keyof typeof modalSizes;
  /** For a list that loads or filters in place: the frame keeps its size while it changes. */
  fixedHeight?: boolean;
  returnFocus?: RefObject<HTMLElement | null>;
}) {
  const phone = useMediaQuery("(max-width: 700px)");
  const Title = phone ? DrawerTitle : DialogTitle;
  const Description = phone ? DrawerDescription : DialogDescription;
  // The insets are variables so the footer can reach the frame's edges from inside the body.
  const content = (
    <ModalPresentation.Provider value={phone ? "sheet" : "dialog"}>
      <div
        data-slot="modal-header"
        className={hideTitle ? "sr-only" : "flex flex-none flex-col gap-3 px-(--modal-inset) pb-4"}
      >
        <Title className="dialog-title pr-10">{title}</Title>
        <Description className={description ? "muted text-subtle-foreground" : "sr-only"}>
          {description ?? title}
        </Description>
      </div>
      <div
        data-slot="modal-body"
        className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-(--modal-inset) pt-1 pb-(--modal-bottom) has-[[data-slot=modal-footer]]:pb-0"
      >
        {children}
      </div>
    </ModalPresentation.Provider>
  );
  if (phone)
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent
          finalFocus={returnFocus}
          className={
            modalClassName +
            " app-sheet relative flex min-h-0 w-full! max-w-full! flex-col gap-5 overflow-hidden rounded-t-[22px] border-t border-border [outline:0] pt-2.5 [--modal-inset:20px] [--modal-bottom:calc(20px_+_env(safe-area-inset-bottom,_0px))] max-h-full! [transform:translateY(var(--drawer-swipe-movement-y,_0px))] [transition:transform_450ms_cubic-bezier(0.32,_0.72,_0,_1)] [&[data-starting-style]]:[transform:translateY(100%)] [&[data-ending-style]]:[transform:translateY(100%)] [&[data-ending-style]]:duration-[calc(var(--drawer-swipe-strength)_*_400ms)] [&_[data-slot=drawer-close]]:absolute [&_[data-slot=drawer-close]]:top-7.5 [&_[data-slot=drawer-close]]:right-3.5 " +
            (fixedHeight ? "h-full " : "") +
            className
          }
        >
          {content}
        </DrawerContent>
      </Drawer>
    );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        finalFocus={returnFocus}
        className={
          modalClassName +
          ` ${modalSizes[size]} ${dialogHeight} ${fixedHeight ? fixedDialogHeight : ""} flex flex-col gap-0 overflow-hidden rounded-[22px] p-0 pt-7 [--modal-inset:28px] [--modal-bottom:28px] [&_[data-slot='dialog-close']]:absolute [&_[data-slot='dialog-close']]:top-6.5 [&_[data-slot='dialog-close']]:right-5.5 ` +
          className
        }
      >
        {content}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The modal's action row, pinned below the scrolling body. `onCancel` adds a Cancel action to
 * dialogs only: sheets are dismissed by swiping or their close button, and their actions fill
 * the row.
 */
export function ModalFooter({
  onCancel,
  children,
}: {
  onCancel?: () => void;
  children?: ReactNode;
}) {
  const sheet = useContext(ModalPresentation) === "sheet";
  if (sheet && !Children.toArray(children).length) return null;
  return (
    <div
      data-slot="modal-footer"
      className={
        "sticky bottom-0 z-10 -mx-(--modal-inset) mt-auto flex flex-none items-center justify-end gap-2 bg-surface px-(--modal-inset) pt-3 pb-(--modal-bottom) " +
        (sheet
          ? "[&_[data-slot=button]]:min-h-11.5 [&_[data-slot=button]]:flex-1"
          : "[&_[data-slot=button]]:min-h-9.5 [&_[data-slot=button]]:px-4.5")
      }
    >
      {onCancel && !sheet && (
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      )}
      {children}
    </div>
  );
}
