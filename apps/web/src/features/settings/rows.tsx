import { useId, type ComponentProps, type ReactNode } from "react";
import { Switch } from "@index/ui/components/switch";
import { cn } from "@index/ui/lib/utils";
import { isDesktop } from "@/lib/desktop";

/** What device-only settings belong to, as in "Saved on this Mac only". */
export const thisDevice =
  isDesktop && typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent)
    ? "this Mac"
    : "this device";

/**
 * A labelled group of rows, like a section of iOS Settings: one bordered box, a row per setting.
 * The note sits beside the label; the footer explains the group below it.
 */
export function SettingsGroup({
  title,
  note,
  footer,
  className,
  children,
}: {
  title: string;
  note?: ReactNode;
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn("settings-section min-w-0", className)}>
      <div className="mb-1.75 flex flex-wrap items-baseline gap-x-2 px-1">
        <h2
          id={id}
          className="font-mono text-[11px] font-normal tracking-[0.07em] text-subtle-foreground uppercase"
        >
          {title}
        </h2>
        {note && <p className="text-[12px] text-subtle-foreground/80">{note}</p>}
      </div>
      <div className="settings-rows rounded-2xl border border-border divide-y divide-border/70">
        {children}
      </div>
      {footer && (
        <div className="mt-1.75 px-1 text-[12px] leading-4 text-subtle-foreground">{footer}</div>
      )}
    </section>
  );
}

/**
 * One setting: its name and an optional description on the left, the control on the right.
 * On narrow screens a wide control moves below the name.
 */
export function SettingsRow({
  label,
  description,
  htmlFor,
  descriptionId,
  className,
  children,
  ...props
}: {
  label: ReactNode;
  description?: ReactNode;
  /** The control the name labels, when it is a form field. */
  htmlFor?: string;
  descriptionId?: string;
  children?: ReactNode;
} & Omit<ComponentProps<"div">, "children">) {
  const Label = htmlFor ? "label" : "span";
  return (
    <div
      className={cn(
        "settings-row flex min-h-11.5 flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5",
        className,
      )}
      {...props}
    >
      <div className="min-w-0 flex-1 basis-28">
        <Label htmlFor={htmlFor} className="block text-[14px] leading-5 text-foreground">
          {label}
        </Label>
        {description && (
          <div id={descriptionId} className="mt-0.5 text-[12px] leading-4 text-subtle-foreground">
            {description}
          </div>
        )}
      </div>
      {children && <div className="flex flex-none items-center gap-2">{children}</div>}
    </div>
  );
}

/** A row that is one switch; the whole row toggles it. */
export function SwitchRow({
  label,
  description,
  children,
  className,
  ...input
}: {
  label: string;
  description?: ReactNode;
  /** Shown under the description, outside the switch's own description (status, errors). */
  children?: ReactNode;
  className?: string;
} & Omit<ComponentProps<typeof Switch>, "children" | "className">) {
  const id = useId();
  return (
    <SettingsRow
      label={label}
      htmlFor={id}
      description={
        (description || children) && (
          <>
            {description && <span id={id + "-description"}>{description}</span>}
            {children}
          </>
        )
      }
      // The name's label stretches over the row, so a click anywhere on it toggles the switch.
      className={cn("relative [&_label]:after:absolute [&_label]:after:inset-0", className)}
    >
      <Switch
        id={id}
        aria-describedby={description ? id + "-description" : undefined}
        className="relative"
        {...input}
      />
    </SettingsRow>
  );
}

/** A compact button for a row's action, such as Change or Turn on. */
export const rowButtonClassName = "h-7 px-3 text-[12px]";
