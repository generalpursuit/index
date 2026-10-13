import { Dialog, DialogContent, DialogTitle, DialogDescription } from "./dialog";
import { Drawer, DrawerContent, DrawerTitle, DrawerDescription } from "./drawer";
import { useMediaQuery } from "../hooks/use-media-query";
import type { ReactNode, RefObject } from "react";

export const modalClassName =
  "app-dialog select-none bg-surface text-foreground border-border [&_.dialog-title]:pr-10 [&_.dialog-title]:font-serif [&_.dialog-title]:text-[26px] [&_.dialog-title]:font-bold [&_.dialog-title]:[font-variation-settings:'opsz'_60] [&_.dialog-title]:tracking-[-0.015em] [&_.dialog-title]:leading-[1.15] [&_[data-slot='dialog-header']]:gap-3 [&_[data-slot='dialog-close']]:absolute [&_[data-slot='dialog-close']]:top-6.5 [&_[data-slot='dialog-close']]:right-5.5 [&_[data-slot='drawer-close']]:absolute [&_[data-slot='drawer-close']]:top-6.5 [&_[data-slot='drawer-close']]:right-5.5 wrap-anywhere min-w-0";

// Each replaces the dialog primitive's `sm:max-w-sm`, which would cap every size at small.
const modalSizes = {
  sm: "w-96 sm:max-w-[calc(100vw_-_32px)]",
  md: "w-150 sm:max-w-[calc(100vw_-_32px)]",
  lg: "w-162.5 sm:max-w-[calc(100vw_-_32px)]",
};
// Centered in the page below any window controls over its top (see --titlebar-inset).
export const modalCenter =
  "top-[calc(50%_+_var(--titlebar-inset)_/_2)] max-h-[calc(100dvh_-_40px_-_var(--titlebar-inset))]";
// A list that changes length grows downward from a fixed top instead of re-centering.
const modalPositions = {
  center: modalCenter,
  top: "top-[calc(12dvh_+_var(--titlebar-inset))] translate-y-0 max-h-[calc(88dvh_-_20px_-_var(--titlebar-inset))]",
};

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  className = "",
  size = "sm",
  position = "center",
  returnFocus,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  size?: keyof typeof modalSizes;
  position?: keyof typeof modalPositions;
  returnFocus?: RefObject<HTMLElement | null>;
}) {
  // Phones get a bottom sheet that can be swiped away; larger screens a centered dialog.
  const phone = useMediaQuery("(max-width: 700px)");
  if (phone)
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent
          finalFocus={returnFocus}
          className={
            modalClassName +
            " app-sheet relative flex min-h-0 w-full! max-w-full! flex-col gap-5 overflow-hidden rounded-t-[22px] border-t border-border [outline:0] p-[10px_20px_calc(20px_+_env(safe-area-inset-bottom,_0px))] [&.app-sheet]:pb-[calc(20px_+_env(safe-area-inset-bottom,_0px))] max-h-full! [transform:translateY(var(--drawer-swipe-movement-y,_0px))] [transition:transform_450ms_cubic-bezier(0.32,_0.72,_0,_1)] [&_[data-slot=drawer-body]]:flex-1 [&_[data-slot=drawer-body]]:min-h-0 [&_[data-slot=drawer-body]]:overflow-y-auto [&_[data-slot=drawer-body]]:overscroll-contain [&[data-starting-style]]:[transform:translateY(100%)] [&[data-ending-style]]:[transform:translateY(100%)] [&[data-ending-style]]:duration-[calc(var(--drawer-swipe-strength)_*_400ms)] [&_[data-slot=drawer-close]]:top-7.5 [&_[data-slot=drawer-close]]:right-3.5 [&_.modal-cancel]:hidden [&_.modal-actions_[data-slot=button]]:flex-1 [&_.modal-actions_[data-slot=button]]:min-h-11.5 " +
            className
          }
        >
          <DrawerTitle className={"dialog-title font-semibold tracking-[-0.035em] leading-[1.1]"}>
            {title}
          </DrawerTitle>
          <DrawerDescription className={description ? "muted text-subtle-foreground" : "sr-only"}>
            {description ?? title}
          </DrawerDescription>
          {children}
        </DrawerContent>
      </Drawer>
    );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        finalFocus={returnFocus}
        className={
          modalClassName +
          ` ${modalSizes[size]} ${modalPositions[position]} rounded-[22px] overflow-y-auto p-7 gap-5 ` +
          className
        }
      >
        <DialogTitle className={"dialog-title font-semibold tracking-[-0.035em] leading-[1.1]"}>
          {title}
        </DialogTitle>
        <DialogDescription className={description ? "muted text-subtle-foreground" : "sr-only"}>
          {description ?? title}
        </DialogDescription>
        {children}
      </DialogContent>
    </Dialog>
  );
}
