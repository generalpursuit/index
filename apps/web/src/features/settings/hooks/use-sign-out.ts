import { useMutation } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { authClient } from "@/lib/auth-client";
import { resetSession } from "@/lib/session";

export function useSignOut() {
  const router = useRouter();
  return useMutation({
    mutationFn: async () => {
      const result = await authClient.signOut();
      if (result.error) throw new Error(result.error.message || "Could not sign out. Try again.");
    },
    onSuccess: async () => {
      await resetSession();
      await router.invalidate();
      await router.navigate({ to: "/login", replace: true });
    },
  });
}
