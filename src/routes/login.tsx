import { useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { AuthPage } from "#/components/auth-page";
import { FormField } from "#/components/form-field";
import { Button } from "#/components/ui/button";
import { loginFn } from "#/lib/auth-functions";
import { safeRedirectPath } from "#/lib/auth-query";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  beforeLoad: ({ context, search }) => {
    if (context.auth.needsSetup) throw redirect({ to: "/setup" });
    if (context.auth.user) throw redirect({ href: safeRedirectPath(search.redirect) });
  },
  component: LoginPage,
});

function LoginPage() {
  const redirectTo = safeRedirectPath(Route.useSearch().redirect);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await loginFn({ data: { email, password } });
      if (!result.ok) {
        setError(result.error);
        setSubmitting(false);
        return;
      }
      // A full load so every route and cached query starts from the new
      // session.
      window.location.assign(redirectTo);
    } catch {
      setError("Something went wrong. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <AuthPage title="Sign in" description="Use the email and password for your account.">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <FormField
          id="email"
          label="Email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={setEmail}
          required
        />
        <FormField
          id="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          required
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </Button>
        <p className="text-xs text-muted-foreground">
          No account, or forgot your password? Ask an admin for a sign-in link.
        </p>
      </form>
    </AuthPage>
  );
}
