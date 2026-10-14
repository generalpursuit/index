import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@index/ui/components/button";
import { Input } from "@index/ui/components/input";
import { importCurateeInputSchema } from "@index/api/features/imports/schemas";
import { useAPI } from "@/hooks/use-api";
import { accountMutationOptions } from "@/lib/account-boundary";
import { refreshLibrary } from "@/features/links/hooks/use-links";

/**
 * Brings the links on a curatee.co profile into Your links, each in the week it was saved there.
 * Importing the profile again adds only links that are new there.
 */
export function CurateeImport() {
  const api = useAPI(),
    cache = useQueryClient();
  const [username, setUsername] = useState(""),
    [invalid, setInvalid] = useState("");
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
          return refreshLibrary(cache, api);
        },
      }),
    ),
  );
  const error = invalid || importProfile.error?.message;
  return (
    <section
      className={
        "settings-box p-[20px_22px] border border-border rounded-[18px] [&_h2]:text-[16px] [&_h2]:font-medium [&_h2+p]:mt-1 [&_h2+p]:text-[13px] settings-curatee"
      }
      aria-labelledby="settings-curatee"
    >
      <h2 id="settings-curatee">Import from curatee</h2>
      <p className={"muted text-subtle-foreground"}>
        Add the links from a curatee.co profile, each in the week it was saved there.
      </p>
      <form
        className="mt-4 flex gap-2"
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
        <Button type="submit" className="h-auto flex-none px-4" disabled={importProfile.isPending}>
          {importProfile.isPending ? "Importing…" : "Import"}
        </Button>
      </form>
      {error && (
        <p
          id="settings-curatee-error"
          role="alert"
          className={"field-error select-text mt-2 text-[12px] text-destructive"}
        >
          {error}
        </p>
      )}
    </section>
  );
}
