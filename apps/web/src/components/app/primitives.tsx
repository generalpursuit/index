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
      className={"user-avatar " + (large ? "large" : "")}
      style={{ background: "hsl(" + hue + " 60% 33%)" }}
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
    <header className="page-heading">
      {back && <Back />}
      <h1>{children}</h1>
      <div className="heading-actions">{actions}</div>
    </header>
  );
}
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
        <DrawerContent className={"app-dialog app-sheet " + className} finalFocus={returnFocus}>
          <DrawerTitle className="dialog-title">{title}</DrawerTitle>
          <DrawerDescription className={description ? "muted" : "sr-only"}>
            {description ?? title}
          </DrawerDescription>
          {children}
        </DrawerContent>
      </Drawer>
    );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={"app-dialog " + className} finalFocus={returnFocus}>
        <DialogTitle className="dialog-title">{title}</DialogTitle>
        <DialogDescription className={description ? "muted" : "sr-only"}>
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
      <div className="loading-state" role="status" aria-label="Loading">
        <div />
        <div />
        <div />
      </div>
    );
  if (error && hasData && !("status" in error && [401, 403, 404].includes(Number(error.status))))
    return (
      <>
        {children}
        <p className="muted" role="status">
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
      <div className="empty-state" role="alert">
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
      className="load-more"
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
      <AlertDialogContent className="app-dialog">
        <AlertDialogTitle className="dialog-title">{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
        <div className="action-pair">
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
