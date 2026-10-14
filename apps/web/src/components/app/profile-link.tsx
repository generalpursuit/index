import { useQueryClient } from "@tanstack/react-query";
import { useAPI } from "@/hooks/use-api";
import { seedPerson } from "@/data/seeding";
import type { Person } from "@/lib/types";
import { Link } from "@tanstack/react-router";
import type { MouseEventHandler, ReactNode } from "react";

/** Tells the profile route whose profile it is, so its data loads while the path is checked. */
export function ProfileLink({
  person,
  ...props
}: {
  person: { id: string; username?: string | null };
  className?: string;
  tabIndex?: number;
  children: ReactNode;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
  "aria-label"?: string;
}) {
  const cache = useQueryClient(),
    api = useAPI();
  const prepare = () => {
    if ("name" in person) seedPerson(cache, api, person as Person);
  };
  return (
    <Link
      to="/u/$username"
      params={{ username: person.username! }}
      state={{ userId: person.id }}
      onPointerEnter={prepare}
      onFocus={prepare}
      onPointerDown={prepare}
      {...props}
    />
  );
}
