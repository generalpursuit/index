import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import { z } from "zod";
import { usernameSchema } from "@index/auth/username";
import { Button } from "@index/ui/components/button";
import { Input } from "@index/ui/components/input";
import { Field, FieldLabel, FieldError } from "@index/ui/components/field";
import wordmark from "@/assets/wordmark.svg";
import { authClient } from "@/lib/auth-client";
import { resetSession, safeReturn } from "@/lib/session";
export const Route = createFileRoute("/login")({
  validateSearch: z.object({ next: z.string().optional().catch(undefined) }),
  component: Login,
});
const defaultValues = { name: "", username: "", email: "", identifier: "", password: "" };
type LoginValues = typeof defaultValues;
type LoginField = {
  name: keyof LoginValues;
  label: string;
  type: "text" | "email" | "password";
  autoComplete: string;
  autoCapitalize?: "none";
};
const signInFields: LoginField[] = [
  {
    name: "identifier",
    label: "Email or username",
    type: "text",
    autoComplete: "username",
    autoCapitalize: "none",
  },
  { name: "password", label: "Password", type: "password", autoComplete: "current-password" },
];
const signUpFields: LoginField[] = [
  { name: "name", label: "Name", type: "text", autoComplete: "name" },
  {
    name: "username",
    label: "Username",
    type: "text",
    autoComplete: "username",
    autoCapitalize: "none",
  },
  { name: "email", label: "Email", type: "email", autoComplete: "email" },
  { name: "password", label: "Password", type: "password", autoComplete: "new-password" },
];
function authenticate(signUp: boolean, value: LoginValues) {
  const { name, username, email, password } = value;
  if (signUp) return authClient.signUp.email({ name, username, email, password });
  // Better Auth signs in by email and by username at separate endpoints.
  const identifier = value.identifier.trim();
  return identifier.includes("@")
    ? authClient.signIn.email({ email: identifier, password })
    : authClient.signIn.username({ username: identifier, password });
}
function Login() {
  const [signUp, setSignUp] = useState(false),
    [error, setError] = useState(""),
    router = useRouter(),
    { next } = Route.useSearch();
  const form = useForm({
    defaultValues,
    validators: {
      onSubmit: z.object({
        name: signUp ? z.string().trim().min(2, "Enter your name.") : z.string(),
        username: signUp ? usernameSchema : z.string(),
        email: signUp ? z.email("Enter a valid email.") : z.string(),
        identifier: signUp ? z.string() : z.string().trim().min(1, "Enter your email or username."),
        password: z.string().min(8, "Use at least 8 characters."),
      }),
    },
    onSubmit: async ({ value }) => {
      setError("");
      try {
        const result = await authenticate(signUp, value);
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
        <h1 className="auth-wordmark">
          <img src={wordmark} alt="Index" />
        </h1>
        <form
          className="form-stack"
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          {(signUp ? signUpFields : signInFields).map((input) => (
            <form.Field key={input.name} name={input.name}>
              {(field) => (
                <Field>
                  <FieldLabel htmlFor={input.name}>{input.label}</FieldLabel>
                  <Input
                    id={input.name}
                    type={input.type}
                    autoComplete={input.autoComplete}
                    autoCapitalize={input.autoCapitalize}
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
        <p className="auth-switch">
          {signUp ? "Already have an account? " : "New here? "}
          <button
            type="button"
            onClick={() => {
              setError("");
              setSignUp(!signUp);
            }}
          >
            {signUp ? "Sign in" : "Create an account"}
          </button>
        </p>
      </div>
    </main>
  );
}
