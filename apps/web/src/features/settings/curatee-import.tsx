import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@index/ui/components/button";
import { Input } from "@index/ui/components/input";
import { Modal, ModalFooter } from "@index/ui/components/modal";
import { importCurateeInputSchema } from "@index/api/features/imports/schemas";
import { useAPI } from "@/hooks/use-api";
import { accountMutationOptions } from "@/lib/account-boundary";
import { refreshLibrary } from "@/features/links/hooks/use-links";
import { rowButtonClassName, SettingsRow } from "./rows";

/**
 * Brings the links on a curatee.co profile into Your links, each in the week it was saved there.
 * Importing the profile again adds only links that are new there.
 */
export function CurateeImport() {
  const api = useAPI(),
    cache = useQueryClient();
  const [username, setUsername] = useState(""),
    [invalid, setInvalid] = useState(""),
    [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const importProfile = useMutation(
    accountMutationOptions(
      api.imports.curatee.mutationOptions({
        onSuccess: ({ imported }) => {
          toast.success(
            imported === 0
              ? "No new links to import"
              : `Imported ${imported} ${imported === 1 ? "link" : "links"}`,
          );
          setUsername("");
          setOpen(false);
          return refreshLibrary(cache, api);
        },
      }),
    ),
  );
  const error = invalid || importProfile.error?.message;
  return (
    <SettingsRow
      label="Import from curatee"
      description="Adds the links from a curatee.co profile, each in the week it was saved there."
    >
      <Button
        ref={trigger}
        variant="outline"
        className={rowButtonClassName}
        aria-label="Import from curatee"
        onClick={() => setOpen(true)}
      >
        Import
      </Button>
      <Modal
        open={open}
        onOpenChange={(next) => {
          if (!importProfile.isPending) setOpen(next);
        }}
        title="Import from curatee"
        description="Add the links from a curatee.co profile, each in the week it was saved there. Importing again adds only new links."
        returnFocus={trigger}
      >
        <form
          className="flex flex-col gap-3"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            const input = importCurateeInputSchema.safeParse({ username });
            setInvalid(input.success ? "" : input.error.issues[0]!.message);
            if (input.success) importProfile.mutate(input.data);
          }}
        >
          <Input
            variant="surface"
            name="curatee-username"
            aria-label="curatee username"
            placeholder="curatee username"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={64}
            value={username}
            disabled={importProfile.isPending}
            aria-invalid={!!error}
            aria-describedby="settings-curatee-error"
            onChange={(event) => {
              setUsername(event.target.value);
              setInvalid("");
            }}
          />
          {error && (
            <p
              id="settings-curatee-error"
              role="alert"
              className={"field-error select-text text-[12px] text-destructive"}
            >
              {error}
            </p>
          )}
          <ModalFooter onCancel={() => setOpen(false)}>
            <Button type="submit" disabled={importProfile.isPending}>
              {importProfile.isPending ? "Importing…" : "Import"}
            </Button>
          </ModalFooter>
        </form>
      </Modal>
    </SettingsRow>
  );
}
