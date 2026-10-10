export type SecurityEmail = {
  to: string;
  code: string;
  purpose: "verify" | "reset" | "change-email";
  id: string;
};
export type EmailTransport = (email: SecurityEmail) => Promise<void>;
export type DeliveryConfig = {
  RESEND_API_KEY?: string;
  AUTH_EMAIL_FROM?: string;
  CORS_ORIGIN: string;
};

/** Server-only delivery. Capture transport is injected only by disposable test/local harnesses. */
export function resendTransport(config: DeliveryConfig): EmailTransport {
  return async ({ to, code, purpose, id }) => {
    if (!config.RESEND_API_KEY || !config.AUTH_EMAIL_FROM)
      throw new Error("Email delivery is not configured.");
    const action =
      purpose === "reset"
        ? "reset your password"
        : purpose === "change-email"
          ? "verify your new email"
          : "verify your email";
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `index-auth-${id}`,
      },
      body: JSON.stringify({
        from: config.AUTH_EMAIL_FROM,
        to: [to],
        subject: `Your Index code: ${code}`,
        text: `Use ${code} to ${action} in Index. This code expires in 10 minutes and can be used once.\n\nReturn to the app or ${config.CORS_ORIGIN}/login. Your password remains your sign-in method. If you did not request this, ignore this email.`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    // Never include provider bodies, recipient addresses, credentials or codes in logs/errors.
    if (!response.ok) throw new Error("Email delivery failed.");
  };
}
