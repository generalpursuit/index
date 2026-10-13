import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from "./alert-dialog";
import { modalCenter, modalClassName } from "./modal";

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
          ` ${modalCenter} rounded-[22px] max-w-[calc(100vw_-_24px)] overflow-y-auto p-7 [@media(width<=700px)]:p-6.25 gap-5`
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
