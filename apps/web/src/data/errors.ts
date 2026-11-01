import { ORPCError, ResponseError } from "@orpc/client";

/**
 * Whether a call failed with one of these HTTP statuses, whether or not the response carried
 * an oRPC error, such as the client-version gate's 426. False when no response arrived.
 */
export function failedWith(error: unknown, ...statuses: number[]) {
  const failure =
    error instanceof ORPCError && error.cause instanceof ResponseError ? error.cause : error;
  return failure instanceof ResponseError && statuses.includes(failure.response.status);
}
