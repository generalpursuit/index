export type DatabaseError = {
  code: "INTERNAL_SERVER_ERROR";
  message: string;
  cause: unknown;
};

export type ApplicationError =
  | DatabaseError
  | {
      code: "NOT_FOUND" | "BAD_REQUEST";
      message: string;
    };

export function databaseError(cause: unknown): DatabaseError {
  return { code: "INTERNAL_SERVER_ERROR", message: "Something went wrong.", cause };
}
