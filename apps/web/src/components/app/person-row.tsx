import type { ReactNode } from "react";
import type { Person } from "@/lib/types";
import { placeholderProfile } from "@/data/placeholders";
import { ProfileLink } from "./profile-link";
import { UserAvatar } from "./user-avatar";

export function PersonRow({
  person,
  children,
  action,
  onOpen,
}: {
  person?: Person;
  children?: ReactNode;
  action?: ReactNode;
  onOpen?: () => void;
}) {
  const shown = person ?? placeholderProfile;
  return (
    <div
      className="person-row flex items-center justify-between gap-4 p-[13px_0] [&>.person-inline]:flex-1 [&_.person-label]:max-w-full [&>button]:shrink-0 [@media(width<=700px)]:gap-2.5 [@media(width<=700px)]:[&_.person-label_small]:max-w-45"
      data-placeholder={!person || undefined}
      aria-hidden={!person || undefined}
    >
      <ProfileLink
        person={shown}
        onClick={onOpen}
        className="person-inline flex items-center gap-3 min-w-0 [&_strong]:font-medium"
      >
        <UserAvatar person={shown} />
        {children ?? (
          <span className="person-label flex flex-col">
            <strong>{shown.name}</strong>
            <small>@{shown.username}</small>
          </span>
        )}
      </ProfileLink>
      {action}
    </div>
  );
}
export const PeoplePlaceholder = () => (
  <>
    {[0, 1, 2, 3].map((key) => (
      <PersonRow key={key} />
    ))}
  </>
);
