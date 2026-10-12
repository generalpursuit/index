import { Avatar, AvatarFallback, AvatarImage } from "@index/ui/components/avatar";
import type { Person } from "@/lib/types";

export function UserAvatar({
  person,
  large = false,
}: {
  person: Pick<Person, "id" | "name" | "image">;
  large?: boolean;
}) {
  const hue = (Array.from(person.id).reduce((n, c) => n + c.charCodeAt(0), 0) * 37) % 360;
  return (
    <Avatar
      className={
        "user-avatar flex-none w-9 h-9 text-avatar-foreground [&_[data-slot='avatar-fallback']]:bg-transparent [&_[data-slot='avatar-fallback']]:text-avatar-foreground [&_[data-slot='avatar-fallback']]:text-[12px] [&.large]:w-22 [&.large]:h-22 [&.large_[data-slot='avatar-fallback']]:text-[26px] " +
        (large ? "large" : "")
      }
      style={{ background: "hsl(" + hue + " 60% var(--avatar-lightness))" }}
    >
      <AvatarImage src={person.image ?? undefined} alt="" />
      <AvatarFallback>
        {person.name
          .split(" ")
          .map((s) => s[0])
          .slice(0, 2)
          .join("")
          .toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}
