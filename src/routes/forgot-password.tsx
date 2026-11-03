import { useState } from "react";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";

import { AuthPage } from "#/components/auth-page";
import { FormField } from "#/components/form-field";
import { Button } from "#/components/ui/button";
import { requestPasswordResetFn } from "#/lib/auth-functions";

export const Route = createFileRoute("/forgot-password")({
  validateSearch: (search: Record<string, unknown>): { email?: string } => ({
    email: typeof search.email === "string" ? search.email : undefined,
  }),
  beforeLoad: ({ context }) => {
    if (context.auth.needsSetup) throw redirect({ to: "/setup" });
    if (context.auth.user) throw redirect({ to: "/" });
  },
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [email, setEmail] = useState(Route.useSearch().email ?? "");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const result = await requestPasswordResetFn({ data: { email } });
      if (result.ok) setSentTo(email.trim());
      else setError(result.error);
    } catch {
      setError("Something went wrong. Try again.");
    }
    setSubmitting(false);
  }

  const backToLogin = (
    <Button asChild variant="outline" className="w-full">
      <Link to="/login" className="text-foreground! no-underline">
        Back to sign in
      </Link>
    </Button>
  );

  if (sentTo) {
    return (
      <AuthPage
        title="Check your email"
        description={
          <>
            If <span className="font-medium text-foreground">{sentTo}</span> has an account, we've
            sent it a link to choose a new password. The link expires in 1 hour.
          </>
        }
      >
        <div className="flex flex-col gap-2">
          {backToLogin}
          <p className="text-xs text-muted-foreground">
            Nothing arrived? Check your spam folder, or ask an admin for a sign-in link.
          </p>
        </div>
      </AuthPage>
    );
  }

  return (
    <AuthPage
      title="Forgot your password?"
      description="Enter your email and we'll send you a link to choose a new one."
    >
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
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="submit" disabled={submitting}>
          {submitting ? "Sending…" : "Send reset link"}
        </Button>
        {backToLogin}
      </form>
    </AuthPage>
  );
}
