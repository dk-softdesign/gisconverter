import { useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { AuthPage } from "#/components/auth-page";
import { FormField } from "#/components/form-field";
import { SetPasswordForm } from "#/components/set-password-form";
import { setupFn } from "#/lib/auth-functions";

// First run only: creates the first admin. Once any user exists the server
// refuses (see createFirstAdmin) and this page redirects to /login.
export const Route = createFileRoute("/setup")({
  beforeLoad: ({ context }) => {
    if (!context.auth.needsSetup) throw redirect({ to: "/login" });
  },
  component: SetupPage,
});

function SetupPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  return (
    <AuthPage
      title="Set up GIS Converter"
      description="Create the first admin account. You can invite other members afterwards."
    >
      <SetPasswordForm
        submitLabel="Create admin account"
        onSubmit={async (password) => {
          const result = await setupFn({ data: { name, email, password } });
          if (!result.ok) return result.error;
          window.location.assign("/");
          return null;
        }}
      >
        <FormField
          id="name"
          label="Name"
          autoComplete="name"
          value={name}
          onChange={setName}
          required
        />
        <FormField
          id="email"
          label="Email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={setEmail}
          required
        />
      </SetPasswordForm>
    </AuthPage>
  );
}
