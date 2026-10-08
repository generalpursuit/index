import { usernameClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { apiFetch } from "./desktop";

import { ENV } from "../env.public";

export const authClient = createAuthClient({
  baseURL: ENV.VITE_SERVER_URL,
  fetchOptions: { customFetchImpl: apiFetch },
  plugins: [usernameClient()],
});
