import { cn } from "@index/ui/lib/utils";
import * as React from "react";
import { inputAppearance } from "./input";

function Textarea({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"textarea"> & { variant?: "default" | "surface" }) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content w-full resize-none border transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-1 aria-invalid:ring-destructive/20 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        inputAppearance[variant],
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
