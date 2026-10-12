import { Input as InputPrimitive } from "@base-ui/react/input";
import { cn } from "@index/ui/lib/utils";
import * as React from "react";

export type InputVariant = "default" | "surface" | "plain" | "composer";
export const inputAppearance: Record<InputVariant, string> = {
  default: "min-h-11 rounded-[10px] border-input bg-muted px-3.5 py-2.5 text-[15px]",
  surface: "min-h-11.5 rounded-[10px] border-border bg-surface px-3.5 py-[11px] text-base",
  plain: "h-8 rounded-none border-input bg-transparent px-2.5 py-1 text-xs",
  composer: "h-11.5 flex-1 rounded-full border-border bg-muted px-4 py-0 text-sm",
};

function Input({
  className,
  type,
  variant = "default",
  ...props
}: React.ComponentProps<"input"> & { variant?: InputVariant }) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "w-full min-w-0 border transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-xs file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        inputAppearance[variant],
        className,
      )}
      {...props}
    />
  );
}

export { Input };
