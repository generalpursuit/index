"use client";

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { cn } from "@index/ui/lib/utils";
import { buttonVariants } from "./button";

// Muted pills; every toast button looks the same.
const toastButton = cn(buttonVariants({ variant: "secondary", size: "sm" }), "px-3 text-[13px]");

// Unstyled: Sonner's own card styles are unlayered CSS that utilities could not override.
// It still positions, stacks and animates the toasts.
const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
        close: <XIcon className="size-3" />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-(--width) items-center gap-2.5 rounded-[14px] bg-popover py-2.5 pr-2.5 pl-4 font-sans text-[14px] leading-5 text-popover-foreground shadow-(--menu-shadow) ring-1 ring-foreground/10 data-[expanded=false]:data-[front=false]:*:opacity-0",
          // Sonner centres its loading spinner absolutely inside the icon slot.
          icon: "relative flex size-4 flex-none items-center",
          content: "flex min-w-0 flex-1 flex-col gap-0.5 py-1",
          description: "text-[13px] text-muted-foreground",
          actionButton: toastButton,
          cancelButton: toastButton,
          closeButton: cn(
            toastButton,
            "absolute top-0 left-0 size-5 -translate-x-1/3 -translate-y-1/3 p-0 ring-1 ring-foreground/10",
          ),
          error: "[&_[data-icon]]:text-destructive",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
