import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { z } from "zod";
import { Button } from "@index/ui/components/button";
import { Input } from "@index/ui/components/input";
import { Field, FieldLabel, FieldError } from "@index/ui/components/field";
import { authClient } from "@/lib/auth-client";
import { resetSession, safeReturn } from "@/lib/session";
export const Route = createFileRoute("/login")({
  validateSearch: z.object({ next: z.string().optional().catch(undefined) }),
  component: Login,
});
function Login() {
  const [signUp, setSignUp] = useState(false),
    [error, setError] = useState(""),
    router = useRouter(),
    { next } = Route.useSearch();
  const form = useForm({
    defaultValues: { name: "", email: "", password: "" },
    validators: {
      onSubmit: z.object({
        name: signUp ? z.string().trim().min(2, "Enter your name.") : z.string(),
        email: z.email("Enter a valid email."),
        password: z.string().min(8, "Use at least 8 characters."),
      }),
    },
    onSubmit: async ({ value }) => {
      setError("");
      try {
        const result = signUp
          ? await authClient.signUp.email(value)
          : await authClient.signIn.email({ email: value.email, password: value.password });
        if (result.error) {
          setError(result.error.message ?? "Could not sign in.");
          return;
        }
        await resetSession();
        await router.invalidate();
        router.history.replace(safeReturn(next));
      } catch {
        setError("Could not connect. Please try again.");
      }
    },
  });
  return (
    <main className="auth-page">
      <div className="auth-form">
        <p className="wordmark">Index</p>
        <h1>{signUp ? "Make room for what matters." : "Good to see you."}</h1>
        <p className="muted">
          {signUp
            ? "Your links, and the people you find them through."
            : "Sign in to your collection."}
        </p>
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          {(["name", "email", "password"] as const)
            .filter((name) => name !== "name" || signUp)
            .map((name) => (
              <form.Field key={name} name={name}>
                {(field) => (
                  <Field>
                    <FieldLabel htmlFor={name}>{name[0]!.toUpperCase() + name.slice(1)}</FieldLabel>
                    <Input
                      id={name}
                      type={name === "password" ? "password" : name === "email" ? "email" : "text"}
                      autoComplete={
                        name === "password"
                          ? signUp
                            ? "new-password"
                            : "current-password"
                          : name === "email"
                            ? "email"
                            : "name"
                      }
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    <FieldError errors={field.state.meta.errors} />
                  </Field>
                )}
              </form.Field>
            ))}
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
          <form.Subscribe selector={(s) => s.isSubmitting}>
            {(pending) => (
              <Button type="submit" disabled={pending}>
                {pending ? "Please wait…" : signUp ? "Create account" : "Sign in"}
              </Button>
            )}
          </form.Subscribe>
        </form>
        <Button
          variant="ghost"
          onClick={() => {
            setError("");
            setSignUp(!signUp);
          }}
        >
          {signUp ? "Already have an account? Sign in" : "New here? Create an account"}
        </Button>
      </div>
    </main>
  );
}
