import { useEffect, useRef, useState, type RefObject } from "react";
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
export function CreateGroupForm({
  onClose,
  onCreated,
  onPendingChange,
}: CreateGroupProps & {
  /** Lets the host block dismissal while the write is pending. */
  onPendingChange?: (pending: boolean) => void;
}) {
  const { pending, create } = useGroupCreation(onCreated);

  return (
    <GroupForm
      pending={pending}
      onClose={onClose}
      onSave={async (value) => {
        onPendingChange?.(true);
        try {
          await create(value);
        } finally {
          onPendingChange?.(false);
        }
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
  const { pending, create } = useGroupCreation(onCreated);
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
      title="New group"
      returnFocus={returnFocus}
    >
      <GroupForm pending={pending} onClose={onClose} onSave={create} />
    </Modal>
  );
}

function useGroupCreation(onCreated: CreateGroupProps["onCreated"]) {
  const { createGroup } = useLibraryActions();
  const [created, setCreated] = useState(false);
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  return {
    pending: created || createGroup.isPending,
    create: async (value: Parameters<typeof createGroup.mutateAsync>[0]) => {
      const group = await createGroup.mutateAsync(value);
      // Account changes/navigation can unmount the caller while a request completes.
      if (!active.current) return;
      setCreated(true);
      onCreated(group);
    },
  };
}
