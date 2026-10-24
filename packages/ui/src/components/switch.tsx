import type { ComponentProps } from "react";
import { cn } from "@index/ui/lib/utils";

/**
 * An on/off control. It stays a native checkbox, so labels, forms, keyboard and screen readers
 * behave as usual; `role="switch"` announces it as a switch.
 */
function Switch({ className, ...props }: Omit<ComponentProps<"input">, "type" | "role">) {
  return (
    <span
      data-slot="switch"
      className={cn("relative inline-flex h-5 w-8 flex-none has-disabled:opacity-50", className)}
    >
      <input
        type="checkbox"
        role="switch"
        className="peer absolute inset-0 size-full cursor-pointer appearance-none rounded-full bg-input transition-colors checked:bg-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-default"
        {...props}
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-0.5 left-0.5 size-4 rounded-full bg-background shadow-sm transition-transform peer-checked:translate-x-3"
      />
    </span>
  );
}

export { Switch };
