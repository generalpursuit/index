import { Button } from "@index/ui/components/button";
import { LockKeyhole, LockKeyholeOpen } from "lucide-react";

export const groupPrivacyDescription = (locked: boolean) =>
  locked
    ? "Only you can see this group and its links."
    : "Visible to anyone who can see your profile.";

/** A pressed lock means private. Existing groups confirm before persisting a change. */
export function GroupLockControl({
  locked,
  onChange,
  name = "group",
  alwaysPrivate = false,
  disabled = false,
  describedBy,
}: {
  locked: boolean;
  onChange: (locked: boolean) => void;
  name?: string;
  alwaysPrivate?: boolean;
  disabled?: boolean;
  describedBy?: string;
}) {
  const privateGroup = alwaysPrivate || locked;
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-11 shrink-0 rounded-full text-foreground"
      aria-label={alwaysPrivate ? `${name}: Always private` : `Lock ${name}`}
      aria-pressed={privateGroup}
      aria-describedby={describedBy}
      title={alwaysPrivate ? "Always private" : privateGroup ? "Locked" : "Unlocked"}
      disabled={disabled || alwaysPrivate}
      onClick={() => onChange(!privateGroup)}
    >
      {privateGroup ? <LockKeyhole aria-hidden="true" /> : <LockKeyholeOpen aria-hidden="true" />}
    </Button>
  );
}
