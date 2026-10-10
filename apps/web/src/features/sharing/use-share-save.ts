import { useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAPI } from "@/hooks/use-api";
import {
  accountGeneration,
  accountMutationOptions,
  assertCurrentAccount,
} from "@/lib/account-boundary";

import { ShareAttempt } from "./share-attempt";
export function useShareSave() {
  const api = useAPI(),
    cache = useQueryClient(),
    attempt = useRef(new ShareAttempt());
  const mutation = useMutation(
    accountMutationOptions(
      api.links.share.mutationOptions({
        onSuccess: async () => {
          await Promise.all(
            [api.links.key(), api.feed.key(), api.groups.key(), api.profiles.key()].map(
              (queryKey) => cache.invalidateQueries({ queryKey }),
            ),
          );
        },
      }),
    ),
  );
  return {
    pending: mutation.isPending,
    save: async (url: string, groupId: string | null, saveAgain = false) => {
      const generation = accountGeneration();
      const result = await mutation.mutateAsync(
        attempt.current.request(url, groupId, generation, saveAgain),
      );
      assertCurrentAccount(generation);
      if (result.status === "saved") attempt.current.complete();
      return result;
    },
  };
}
