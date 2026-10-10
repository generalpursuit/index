import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@index/ui/components/button";
import { Input } from "@index/ui/components/input";
import { Field, FieldLabel } from "@index/ui/components/field";
import { authClient } from "@/lib/auth-client";
import { refreshSession, resetSession } from "@/lib/session";
import {
  SecurityError,
  securityRequest,
  type SecurityStatus,
  type ChallengeStatus,
} from "./security-api";

function useAction() {
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const [until, setUntil] = useState(0),
    [now, setNow] = useState(Date.now());
  const remaining = Math.max(0, Math.ceil((until - now) / 1000));
  useEffect(() => {
    if (!remaining) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [remaining]);
  const cooldown = (seconds: number) => {
    setNow(Date.now());
    setUntil(Date.now() + seconds * 1000);
  };
  const run = async (work: () => Promise<void>) => {
    setPending(true);
    setError("");
    try {
      await work();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not connect. Please try again.");
      if (error instanceof SecurityError && error.retryAfter) cooldown(error.retryAfter);
    } finally {
      setPending(false);
    }
  };
  return { pending, error, run, cooldown, remaining };
}
export function SecurityField({
  label,
  value,
  onChange,
  type = "text",
  autoComplete,
  code = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "email" | "password";
  autoComplete?: string;
  code?: boolean;
}) {
  const id = `security-${label.toLowerCase().replaceAll(" ", "-")}`;
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        autoCapitalize="none"
        required
        maxLength={code ? 6 : type === "password" ? 128 : 254}
        minLength={type === "password" ? 8 : undefined}
        inputMode={code ? "numeric" : undefined}
        pattern={code ? "[0-9]{6}" : undefined}
      />
    </Field>
  );
}
function Feedback({ error, children }: { error: string; children?: ReactNode }) {
  return (
    <>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {children && (
        <p role="status" className="text-sm text-muted-foreground">
          {children}
        </p>
      )}
    </>
  );
}
function DeliveryMessage({ status }: { status?: ChallengeStatus }) {
  return (
    <p role="status" className="text-sm text-muted-foreground">
      {status?.delivery === "failed"
        ? "We couldn’t send the email. Try resending after the cooldown."
        : status?.delivery === "none"
          ? "Request a code to verify this address."
          : "Check your inbox and spam folder. Delivery may take a few minutes. Only the latest code works, for 10 minutes."}
    </p>
  );
}
export function VerificationForm({
  email,
  onComplete,
}: {
  email: string;
  onComplete: () => Promise<void>;
}) {
  const action = useAction();
  const [status, setStatus] = useState<ChallengeStatus>(),
    [code, setCode] = useState("");
  const [correcting, setCorrecting] = useState(false),
    [newEmail, setNewEmail] = useState(email),
    [password, setPassword] = useState("");
  async function refresh() {
    const next = (await securityRequest<SecurityStatus>("status")).verification;
    setStatus(next);
    action.cooldown(next.retryAfter);
  }
  useEffect(() => {
    void action.run(refresh);
  }, []);
  return (
    <div className="form-stack">
      <h2 className="text-xl font-medium">Verify your email</h2>
      <p>
        Enter the six-digit code sent to{" "}
        <strong className="break-all">{status?.email ?? email}</strong>.
      </p>
      <DeliveryMessage status={status} />
      <form
        className="form-stack"
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            await securityRequest("verify-email", { code });
            setCode("");
            await resetSession();
            await onComplete();
          });
        }}
      >
        <SecurityField
          label="Verification code"
          value={code}
          onChange={setCode}
          autoComplete="one-time-code"
          code
        />
        <Button disabled={action.pending || code.length !== 6} type="submit">
          Verify email
        </Button>
      </form>
      <Button
        variant="outline"
        disabled={action.pending || action.remaining > 0}
        onClick={() =>
          void action.run(async () => {
            await securityRequest("send-verification", {});
            setCode("");
            await refresh();
          })
        }
      >
        {action.remaining ? `Resend in ${action.remaining}s` : "Resend code"}
      </Button>
      <Button variant="ghost" onClick={() => setCorrecting(!correcting)}>
        Correct email address
      </Button>
      {correcting && (
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              await securityRequest("correct-email", { email: newEmail.trim(), password });
              setPassword("");
              setCode("");
              setCorrecting(false);
              await refresh();
            });
          }}
        >
          <p className="text-sm text-muted-foreground">
            Confirm your signup password. We’ll verify the corrected address before replacing the
            original.
          </p>
          <SecurityField
            label="Correct email"
            type="email"
            value={newEmail}
            onChange={setNewEmail}
            autoComplete="email"
          />
          <SecurityField
            label="Signup password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
          />
          <Button type="submit" disabled={action.pending || action.remaining > 0}>
            Send to corrected address
          </Button>
        </form>
      )}
      <Feedback error={action.error} />
      <Button
        variant="ghost"
        disabled={action.pending}
        onClick={() =>
          void action.run(async () => {
            await authClient.signOut();
            await resetSession();
          })
        }
      >
        Sign out
      </Button>
    </div>
  );
}
export function RecoveryForm({ onBack }: { onBack: () => void }) {
  const action = useAction();
  const [email, setEmail] = useState(""),
    [code, setCode] = useState(""),
    [newPassword, setNewPassword] = useState(""),
    [confirm, setConfirm] = useState("");
  const [requested, setRequested] = useState(false),
    [done, setDone] = useState(false);
  return (
    <div className="form-stack">
      <h2 className="text-xl font-medium">Reset your password</h2>
      {done ? (
        <p role="status">
          Password reset. Sign in with your new password. Your other sessions have been signed out.
        </p>
      ) : (
        <>
          <form
            className="form-stack"
            onSubmit={(e) => {
              e.preventDefault();
              void action.run(async () => {
                const result = await securityRequest("request-reset", { email: email.trim() });
                setRequested(true);
                action.cooldown(result.retryAfter ?? 60);
              });
            }}
          >
            <SecurityField
              label="Recovery email"
              type="email"
              value={email}
              onChange={(value) => {
                setEmail(value);
                setCode("");
              }}
              autoComplete="email"
            />
            <Button type="submit" disabled={action.pending || action.remaining > 0}>
              {action.remaining
                ? `Resend in ${action.remaining}s`
                : requested
                  ? "Resend recovery code"
                  : "Send recovery code"}
            </Button>
          </form>
          {requested && (
            <>
              <p role="status" className="text-sm text-muted-foreground">
                If an account uses this address, a code is on its way. Check spam or retry after the
                cooldown. Codes expire in 10 minutes.
              </p>
              <form
                className="form-stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  void action.run(async () => {
                    if (newPassword !== confirm) throw new Error("Passwords do not match.");
                    await securityRequest("reset-password", {
                      email: email.trim(),
                      code,
                      newPassword,
                    });
                    setNewPassword("");
                    setConfirm("");
                    setCode("");
                    await authClient.signOut();
                    await resetSession();
                    setDone(true);
                  });
                }}
              >
                <SecurityField
                  label="Recovery code"
                  value={code}
                  onChange={setCode}
                  autoComplete="one-time-code"
                  code
                />
                <SecurityField
                  label="New password"
                  type="password"
                  value={newPassword}
                  onChange={setNewPassword}
                  autoComplete="new-password"
                />
                <SecurityField
                  label="Confirm new password"
                  type="password"
                  value={confirm}
                  onChange={setConfirm}
                  autoComplete="new-password"
                />
                <Button disabled={action.pending} type="submit">
                  Reset password
                </Button>
              </form>
            </>
          )}
        </>
      )}
      <Feedback error={action.error} />
      <Button variant="ghost" onClick={onBack} disabled={action.pending}>
        Back to sign in
      </Button>
    </div>
  );
}
export function AccountSecurity() {
  const action = useAction();
  const [mode, setMode] = useState<"password" | "email" | null>(null);
  const [password, setPassword] = useState(""),
    [newPassword, setNewPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [email, setEmail] = useState(""),
    [code, setCode] = useState("");
  const [pendingEmail, setPendingEmail] = useState<ChallengeStatus>(),
    [message, setMessage] = useState("");
  async function refresh() {
    const result = await securityRequest<SecurityStatus>("status");
    setPendingEmail(result.emailChange);
    action.cooldown(result.emailChange.retryAfter);
  }
  useEffect(() => {
    void action.run(refresh);
  }, []);
  return (
    <section className="settings-box form-stack" aria-label="Account security">
      <h2 className="text-lg font-medium">Account security</h2>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => {
            setMode("password");
            setPassword("");
            setMessage("");
          }}
        >
          Change password
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            setMode("email");
            setPassword("");
            setMessage("");
          }}
        >
          Change email
        </Button>
      </div>
      {mode && (
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              if (mode === "password") {
                if (newPassword !== confirm) throw new Error("Passwords do not match.");
                await securityRequest("change-password", {
                  currentPassword: password,
                  newPassword,
                });
                setNewPassword("");
                setConfirm("");
                setMode(null);
                setMessage("Password changed. Other sessions have been signed out.");
                await refreshSession();
              } else {
                await securityRequest("request-email-change", { email: email.trim(), password });
                await refresh();
                setCode("");
              }
              setPassword("");
            });
          }}
        >
          <SecurityField
            label="Current password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
          />
          {mode === "password" ? (
            <>
              <SecurityField
                label="New password"
                type="password"
                value={newPassword}
                onChange={setNewPassword}
                autoComplete="new-password"
              />
              <SecurityField
                label="Confirm new password"
                type="password"
                value={confirm}
                onChange={setConfirm}
                autoComplete="new-password"
              />
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                Your current email stays active until you verify the new address.
              </p>
              <SecurityField
                label="New email"
                type="email"
                value={email}
                onChange={setEmail}
                autoComplete="email"
              />
            </>
          )}
          <Button
            type="submit"
            disabled={action.pending || (mode === "email" && action.remaining > 0)}
          >
            {mode === "password"
              ? "Save password"
              : action.remaining
                ? `Resend in ${action.remaining}s`
                : "Send email change code"}
          </Button>
        </form>
      )}
      {pendingEmail?.pending && (
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              await securityRequest("confirm-email-change", { code });
              setCode("");
              setMode(null);
              setMessage("Email changed. Other sessions have been signed out.");
              await refresh();
              await refreshSession();
            });
          }}
        >
          <p>
            Verify <strong className="break-all">{pendingEmail.email}</strong>
          </p>
          <DeliveryMessage status={pendingEmail} />
          <SecurityField
            label="Email change code"
            value={code}
            onChange={setCode}
            autoComplete="one-time-code"
            code
          />
          <Button type="submit" disabled={action.pending}>
            Confirm new email
          </Button>
        </form>
      )}
      <Feedback error={action.error}>{message}</Feedback>
    </section>
  );
}
