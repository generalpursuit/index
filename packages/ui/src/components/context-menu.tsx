"use client";

import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu";
import { cn } from "@index/ui/lib/utils";

/** Opens on right click or long press anywhere in its trigger. */
function ContextMenu({ ...props }: ContextMenuPrimitive.Root.Props) {
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />;
}

function ContextMenuTrigger({ ...props }: ContextMenuPrimitive.Trigger.Props) {
  return <ContextMenuPrimitive.Trigger data-slot="context-menu-trigger" {...props} />;
}

function ContextMenuContent({ className, ...props }: ContextMenuPrimitive.Popup.Props) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Positioner className="isolate z-50 outline-none">
        <ContextMenuPrimitive.Popup
          data-slot="context-menu-content"
          className={cn(
            // The same surface, states and motion as the dropdown menu.
            "z-50 max-h-(--available-height) origin-(--transform-origin) overflow-x-hidden overflow-y-auto duration-100 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:overflow-hidden data-closed:fade-out-0 data-closed:zoom-out-95 min-w-40 max-w-[min(320px,_var(--available-width))] p-1.5 border border-border rounded-[12px] bg-card text-muted-foreground [box-shadow:var(--menu-shadow)]",
            className,
          )}
          {...props}
        />
      </ContextMenuPrimitive.Positioner>
    </ContextMenuPrimitive.Portal>
  );
}

function ContextMenuItem({ className, ...props }: ContextMenuPrimitive.Item.Props) {
  return (
    <ContextMenuPrimitive.Item
      data-slot="context-menu-item"
      className={cn(
        "relative flex cursor-default items-center outline-hidden select-none data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 min-h-9 p-[0_12px_0_34px] rounded-[8px] text-[14px] whitespace-nowrap [transition:background_100ms_ease,_color_100ms_ease] [&>svg]:absolute [&>svg]:left-2.5 [&>svg]:w-3.75 [&>svg]:h-3.75 [&>svg]:text-subtle-foreground [&[data-highlighted]]:bg-muted [&[data-highlighted]]:text-foreground [&[data-highlighted]>svg]:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem };
