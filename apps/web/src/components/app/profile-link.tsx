import { Link } from "@tanstack/react-router";
import type { MouseEventHandler, ReactNode } from "react";

/** Tells the profile route whose profile it is, so its data loads while the path is checked. */
export function ProfileLink({
  person,
  ...props
}: {
  person: { id: string; username?: string | null };
  className?: string;
  children: ReactNode;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
  "aria-label"?: string;
}) {
  return (
    <Link
      to="/u/$username"
      params={{ username: person.username! }}
      state={{ userId: person.id }}
      {...props}
    />
  );
}
