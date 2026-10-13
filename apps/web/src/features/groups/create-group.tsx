import { useEffect, useRef, useState, type RefObject } from "react";
import { Modal } from "@index/ui/components/modal";
import { useGroupActions } from "@/features/groups/use-groups";
import type { Group } from "@/lib/types";
import { GroupForm } from "./group-form";

/** Shared desktop dialog / mobile sheet. Mount to open; unmount onClose or onCreated. */
export function CreateGroup({
  onClose,
  onCreated,
  returnFocus,
}: {
  onClose: () => void;
  /** Full created group, including its canonical slug. Called once after a successful write. */
  onCreated: (group: Group) => void;
  returnFocus?: RefObject<HTMLElement | null>;
}) {
  const { createGroup } = useGroupActions();
  const [created, setCreated] = useState(false);
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const pending = created || createGroup.isPending;
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
      title="New group"
      returnFocus={returnFocus}
    >
      <GroupForm
        pending={pending}
        onClose={onClose}
        onSave={async (value) => {
          const group = await createGroup.mutateAsync(value);
          // Account changes/navigation can unmount the caller while a request completes.
          if (!active.current) return;
          setCreated(true);
          onCreated(group);
        }}
      />
    </Modal>
  );
}
