import { apiFetch } from "@/lib/desktop";
import { ENV } from "@/env.public";
export type ChallengeStatus = {
  email: string;
  pending: boolean;
  delivery: string;
  retryAfter: number;
  expiresAt: string | null;
};
export type SecurityStatus = { verification: ChallengeStatus; emailChange: ChallengeStatus };
export class SecurityError extends Error {
  constructor(
    message: string,
    public retryAfter = 0,
  ) {
    super(message);
  }
}
export async function securityRequest<T = { success: boolean; retryAfter?: number }>(
  path:
    | "status"
    | "send-verification"
    | "correct-email"
    | "verify-email"
    | "request-reset"
    | "reset-password"
    | "request-email-change"
    | "confirm-email-change"
    | "change-password",
  body?: Record<string, string>,
): Promise<T> {
  const response = await apiFetch(
    `${ENV.VITE_SERVER_URL.replace(/\/$/, "")}/api/auth/security/${path}`,
    {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    },
  );
  const result = await response.json();
  if (!response.ok)
    throw new SecurityError(
      result.message || "Could not complete that. Please try again.",
      result.retryAfter ?? (response.status === 429 ? 60 : 0),
    );
  return result as T;
}
