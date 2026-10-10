import { useState, type RefObject } from "react";
import { Modal } from "@/components/app/primitives";
import { useLibraryActions } from "@/features/links/hooks/use-links";
import type { Group } from "@/lib/types";
import { GroupForm } from "./group-form";

export type CreateGroupProps = {
  onClose: () => void;
  /** Full created group, including its canonical slug. Called once after a successful write. */
  onCreated: (group: Group) => void;
};

/** Use inside a caller-owned save/share surface. The caller closes it after onCreated. */
export function CreateGroupForm({ onClose, onCreated }: CreateGroupProps) {
  const [created, setCreated] = useState(false);
  const { createGroup } = useLibraryActions();
  return (
    <GroupForm
      pending={created || createGroup.isPending}
      onClose={onClose}
      onSave={async (value) => {
        const group = await createGroup.mutateAsync(value);
        setCreated(true);
        onCreated(group);
      }}
    />
  );
}

/** Shared desktop dialog / mobile sheet. Mount to open; unmount onClose or onCreated. */
export function CreateGroup({
  onClose,
  onCreated,
  returnFocus,
}: CreateGroupProps & { returnFocus?: RefObject<HTMLElement | null> }) {
  const { createGroup } = useLibraryActions();
  const [created, setCreated] = useState(false);
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !createGroup.isPending) onClose();
      }}
      title="New group"
      returnFocus={returnFocus}
    >
      <GroupForm
        pending={created || createGroup.isPending}
        onClose={onClose}
        onSave={async (value) => {
          const group = await createGroup.mutateAsync(value);
          setCreated(true);
          onCreated(group);
        }}
      />
    </Modal>
  );
}
