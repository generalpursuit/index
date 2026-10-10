"use client";

import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer";
import { cn } from "cn";

import { Button } from "@index/ui/components/button";
import { XIcon } from "lucide-react";

function Drawer({ ...props }: DrawerPrimitive.Root.Props) {
  return <DrawerPrimitive.Root data-slot="drawer" {...props} />;
}

// A bottom sheet: swipe down, the close button or the backdrop dismisses it.
function DrawerContent({ className, children, ...props }: DrawerPrimitive.Popup.Props) {
  return (
    <DrawerPrimitive.VirtualKeyboardProvider>
      <DrawerPrimitive.Portal>
        <DrawerPrimitive.Backdrop
          className={
            "fixed inset-0 z-50 bg-overlay opacity-[calc(1_*_(1_-_var(--drawer-swipe-progress)))] [transition:opacity_450ms_cubic-bezier(0.32,_0.72,_0,_1)] [&[data-starting-style]]:opacity-[0] [&[data-ending-style]]:opacity-[0] [&[data-swiping]]:duration-[0ms]"
          }
          data-slot="drawer-backdrop"
        />
        <DrawerPrimitive.Viewport
          className={"fixed inset-0 z-50 flex items-end justify-center"}
          data-slot="drawer-viewport"
        >
          <DrawerPrimitive.Popup data-slot="drawer-content" className={cn(className)} {...props}>
            <div
              className={"flex-none w-10 h-1 m-[0_auto_16px] rounded-[2px] bg-input"}
              data-slot="drawer-handle"
              aria-hidden="true"
            />
            <DrawerPrimitive.Content
              className={"flex flex-col gap-5 min-h-0"}
              data-slot="drawer-body"
            >
              {children}
            </DrawerPrimitive.Content>
            <DrawerPrimitive.Close
              data-slot="drawer-close"
              render={<Button variant="ghost" size="icon-sm" />}
            >
              <XIcon />
              <span className="sr-only">Close</span>
            </DrawerPrimitive.Close>
          </DrawerPrimitive.Popup>
        </DrawerPrimitive.Viewport>
      </DrawerPrimitive.Portal>
    </DrawerPrimitive.VirtualKeyboardProvider>
  );
}

function DrawerTitle({ className, ...props }: DrawerPrimitive.Title.Props) {
  return <DrawerPrimitive.Title data-slot="drawer-title" className={cn(className)} {...props} />;
}

function DrawerDescription({ className, ...props }: DrawerPrimitive.Description.Props) {
  return (
    <DrawerPrimitive.Description
      data-slot="drawer-description"
      className={cn(className)}
      {...props}
    />
  );
}

export { Drawer, DrawerContent, DrawerTitle, DrawerDescription };
