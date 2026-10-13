"use client";

import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer";
import { cn } from "cn";

import { Button } from "@index/ui/components/button";
import { XIcon } from "lucide-react";
import { useLayoutEffect, useRef, type ReactNode } from "react";

function Drawer({ ...props }: DrawerPrimitive.Root.Props) {
  return <DrawerPrimitive.Root data-slot="drawer" {...props} />;
}

// Mount with the portal so closed sheets have no viewport subscriptions. Do not
// position the frame with --drawer-keyboard-inset: Base UI clears it on input blur,
// moving a tapped footer button between pointerdown and click. Only actual browser
// viewport changes should resize the frame; the provider still handles field reveal.
function KeyboardViewport({ children }: { children: ReactNode }) {
  const element = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      const node = element.current;
      if (!node) return;
      // Leave deliberate pinch zoom under the browser's control.
      const zoomed = Math.abs(viewport.scale - 1) > 0.01;
      node.style.height = zoomed ? "" : `${viewport.height}px`;
      node.style.top = zoomed ? "" : `${Math.max(0, viewport.offsetTop)}px`;
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);
  return (
    <DrawerPrimitive.Viewport
      ref={element}
      className="fixed inset-x-0 top-0 z-50 flex h-dvh min-h-0 items-end justify-center pt-[max(calc(16px_+_var(--titlebar-inset)),_env(safe-area-inset-top,_0px))]"
      data-slot="drawer-viewport"
    >
      {children}
    </DrawerPrimitive.Viewport>
  );
}

// A bottom sheet: swipe down, the close button or the backdrop dismisses it.
function DrawerContent({ className, children, ...props }: DrawerPrimitive.Popup.Props) {
  const popup = useRef<HTMLDivElement>(null);
  return (
    <DrawerPrimitive.VirtualKeyboardProvider>
      <DrawerPrimitive.Portal>
        <DrawerPrimitive.Backdrop
          className={
            "fixed inset-0 z-50 bg-overlay opacity-[calc(1_*_(1_-_var(--drawer-swipe-progress)))] [transition:opacity_450ms_cubic-bezier(0.32,_0.72,_0,_1)] [&[data-starting-style]]:opacity-[0] [&[data-ending-style]]:opacity-[0] [&[data-swiping]]:duration-[0ms]"
          }
          data-slot="drawer-backdrop"
        />
        <KeyboardViewport>
          <DrawerPrimitive.Popup
            ref={popup}
            initialFocus={() => popup.current}
            data-slot="drawer-content"
            className={cn(className)}
            {...props}
          >
            <div
              className={"flex-none w-10 h-1 m-[0_auto_16px] rounded-[2px] bg-input"}
              data-slot="drawer-handle"
              aria-hidden="true"
            />
            <DrawerPrimitive.Content
              className={"flex flex-col gap-5 min-h-0 min-w-0"}
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
        </KeyboardViewport>
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
