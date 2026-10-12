import { Button } from "./button";
import type { ReactNode, ComponentProps } from "react";

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
