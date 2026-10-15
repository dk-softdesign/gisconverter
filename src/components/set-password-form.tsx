import { useState } from "react";

import { FormField } from "#/components/form-field";
import { Button } from "#/components/ui/button";
import { MIN_PASSWORD_LENGTH } from "#/lib/auth-types";

// New password + confirmation, used by first-run setup and invite links.
// `onSubmit` returns an error message to show, or null on success.
export function SetPasswordForm({
  submitLabel,
  children,
  onSubmit,
}: {
  submitLabel: string;
  children?: React.ReactNode;
  onSubmit: (password: string) => Promise<string | null>;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setError("The passwords don't match.");
      return;
    }
    setSubmitting(true);
    setError(null);
    let problem: string | null;
    try {
      problem = await onSubmit(password);
    } catch {
      problem = "Something went wrong. Try again.";
    }
    // On success the page navigates away, so stay "submitting".
    if (problem) {
      setError(problem);
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {children}
      <FormField
        id="password"
        label="Password"
        hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        type="password"
        autoComplete="new-password"
        value={password}
        onChange={setPassword}
        minLength={MIN_PASSWORD_LENGTH}
        required
      />
      <FormField
        id="confirm-password"
        label="Repeat password"
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={setConfirm}
        required
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={submitting}>
        {submitting ? "Saving…" : submitLabel}
      </Button>
    </form>
  );
}
