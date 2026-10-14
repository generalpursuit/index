export type DatabaseError = {
  code: "INTERNAL_SERVER_ERROR";
  message: string;
  cause: unknown;
};

export type ApplicationError =
  | DatabaseError
  | {
      code: "NOT_FOUND" | "BAD_REQUEST" | "CONFLICT";
      message: string;
    }
  // A service the request depends on failed or answered unexpectedly.
  | { code: "BAD_GATEWAY"; message: string; cause: unknown };

export function databaseError(cause: unknown): DatabaseError {
  return { code: "INTERNAL_SERVER_ERROR", message: "Something went wrong.", cause };
}

export const notFound = (resource: string) => ({
  code: "NOT_FOUND" as const,
  message: `${resource} not found.`,
});
