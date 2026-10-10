import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from "@index/ui/components/alert-dialog";
import { Button } from "@index/ui/components/button";
import { Avatar, AvatarFallback, AvatarImage } from "@index/ui/components/avatar";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@index/ui/components/dialog";
import { Drawer, DrawerContent, DrawerTitle, DrawerDescription } from "@index/ui/components/drawer";
import { ChevronLeft } from "lucide-react";
import { useBack } from "@/hooks/use-back";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { Person } from "@/lib/types";
import type { ReactNode, ComponentProps, RefObject } from "react";

export function IconButton({
  label,
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, "children"> & { label: string; children: ReactNode }) {
  return (
    <Button variant="ghost" size="icon" title={label} aria-label={label} {...props}>
      {children}
    </Button>
  );
}
export function UserAvatar({
  person,
  large = false,
}: {
  person: Pick<Person, "id" | "name" | "image">;
  large?: boolean;
}) {
  const hue = (Array.from(person.id).reduce((n, c) => n + c.charCodeAt(0), 0) * 37) % 360;
  return (
    <Avatar
      className={
        "user-avatar flex-none w-9 h-9 text-avatar-foreground [&_[data-slot='avatar-fallback']]:bg-transparent [&_[data-slot='avatar-fallback']]:text-avatar-foreground [&_[data-slot='avatar-fallback']]:text-[12px] [&.large]:w-22 [&.large]:h-22 [&.large_[data-slot='avatar-fallback']]:text-[26px] " +
        (large ? "large" : "")
      }
      style={{ background: "hsl(" + hue + " 60% var(--avatar-lightness))" }}
    >
      <AvatarImage src={person.image ?? undefined} alt="" />
      <AvatarFallback>
        {person.name
          .split(" ")
          .map((s) => s[0])
          .slice(0, 2)
          .join("")
          .toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}
export function Back({ fallback = "/" }: { fallback?: string }) {
  const back = useBack(fallback);
  return (
    <IconButton label="Back" onClick={back}>
      <ChevronLeft />
    </IconButton>
  );
}
export function Heading({
  children,
  back = false,
  actions,
}: {
  children: ReactNode;
  back?: boolean;
  actions?: ReactNode;
}) {
  return (
    <header
      className={
        "page-heading flex items-center gap-3 mb-8 min-w-0 [&_h1]:flex-1 [&_h1]:min-w-0 [&_h1]:self-start [@media(width<=700px)]:mb-6.5 [@media(width<=700px)]:gap-1"
      }
    >
      {back && <Back />}
      <h1>{children}</h1>
      <div
        className={"heading-actions flex gap-1 items-center ml-auto [@media(width<=700px)]:gap-0.5"}
      >
        {actions}
      </div>
    </header>
  );
}
const modalClassName =
  "app-dialog select-none bg-surface text-foreground border-border [&_button]:cursor-pointer [&_button:disabled]:cursor-default [&_[data-slot='button']]:rounded-full [&_.dialog-title]:pr-10 [&_.dialog-title]:font-serif [&_.dialog-title]:text-[26px] [&_.dialog-title]:font-bold [&_.dialog-title]:[font-variation-settings:'opsz'_60] [&_.dialog-title]:tracking-[-0.015em] [&_.dialog-title]:leading-[1.15] [&_[data-slot='dialog-header']]:gap-3 [&_[data-slot='dialog-close']]:absolute [&_[data-slot='dialog-close']]:top-6.5 [&_[data-slot='dialog-close']]:right-5.5 [&_[data-slot='drawer-close']]:absolute [&_[data-slot='drawer-close']]:top-6.5 [&_[data-slot='drawer-close']]:right-5.5 [&_[data-slot='button']:disabled]:opacity-[0.4] [&_input:not([type='radio'])]:min-h-11 [&_input:not([type='radio'])]:p-[10px_14px] [&_input:not([type='radio'])]:bg-muted [&_input:not([type='radio'])]:border-input [&_input:not([type='radio'])]:rounded-[10px] [&_input:not([type='radio'])]:text-[15px] [&_textarea]:min-h-11 [&_textarea]:p-[10px_14px] [&_textarea]:bg-muted [&_textarea]:border-input [&_textarea]:rounded-[10px] [&_textarea]:text-[15px] wrap-anywhere min-w-0";

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  className = "",
  returnFocus,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
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
          " rounded-[22px] max-h-[calc(100dvh_-_40px)] overflow-y-auto p-7 gap-5 " +
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
export function QueryState({
  pending,
  hasData = false,
  error,
  retry,
  children,
}: {
  pending?: boolean;
  hasData?: boolean;
  error?: Error | null;
  retry?: () => void;
  children?: ReactNode;
}) {
  if (pending && !hasData)
    return (
      <div
        className={
          "loading-state grid gap-4 p-[24px_0] w-full [&>div]:h-12 [&>div]:bg-surface [&>div]:rounded-[12px] [&>div]:[animation:loading-pulse_1.5s_ease-in-out_infinite]"
        }
        role="status"
        aria-label="Loading"
      >
        <div />
        <div />
        <div />
      </div>
    );
  if (error && hasData && !("status" in error && [401, 403, 404].includes(Number(error.status))))
    return (
      <>
        {children}
        <p className={"muted text-subtle-foreground"} role="status">
          Couldn’t refresh. Showing saved content.{" "}
          {retry && (
            <button type="button" onClick={retry}>
              Try again
            </button>
          )}
        </p>
      </>
    );
  if (error)
    return (
      <div
        className={
          "empty-state [&[role='alert']>p]:select-text text-muted-foreground p-[32px_12px] text-center [&_p]:mb-3.5 [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-[4px]"
        }
        role="alert"
      >
        <p>{error.message || "Something went wrong."}</p>
        {retry && (
          <Button variant="outline" onClick={retry}>
            Try again
          </Button>
        )}
      </div>
    );
  return children;
}
export function More({
  hasNext,
  isFetching,
  fetch,
}: {
  hasNext?: boolean;
  isFetching?: boolean;
  fetch: () => unknown;
}) {
  return hasNext ? (
    <Button
      variant="ghost"
      className={"load-more m-[8px_auto] flex"}
      disabled={isFetching}
      onClick={() => void fetch()}
    >
      {isFetching ? "Loading…" : "Load more"}
    </Button>
  ) : null;
}

export function Confirmation({
  open,
  onOpenChange,
  title,
  description,
  pending,
  onConfirm,
  destructive = false,
  label = "Confirm",
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description: string;
  pending?: boolean;
  onConfirm: () => void;
  destructive?: boolean;
  label?: string;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        className={
          modalClassName +
          " rounded-[22px] max-h-[calc(100dvh_-_40px)] max-w-[calc(100vw_-_24px)] overflow-y-auto p-7 [@media(width<=700px)]:p-6.25 gap-5"
        }
      >
        <AlertDialogTitle
          className={"dialog-title font-semibold tracking-[-0.035em] leading-[1.1]"}
        >
          {title}
        </AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
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
  );
}
