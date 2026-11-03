import { createFileRoute, Link } from "@tanstack/react-router";

import { AuthPage } from "#/components/auth-page";
import { SetPasswordForm } from "#/components/set-password-form";
import { Button } from "#/components/ui/button";
import { acceptInviteFn, getInviteFn } from "#/lib/auth-functions";

// The one-time link an admin hands out, both for new members and for
// resetting a forgotten password.
export const Route = createFileRoute("/invite/$token")({
  loader: ({ params }) => getInviteFn({ data: { token: params.token } }),
  component: InvitePage,
});

function InvitePage() {
  const invite = Route.useLoaderData();
  const { token } = Route.useParams();

  if (!invite) {
    return (
      <AuthPage
        title="Link not valid"
        description="This link has expired or has already been used. Request a new one, or ask an admin."
      >
        <div className="flex flex-col gap-2">
          <Button asChild className="w-full">
            <Link to="/forgot-password" className="text-primary-foreground! no-underline">
              Send a new link
            </Link>
          </Button>
          <Button asChild variant="outline" className="w-full">
            <Link to="/login" className="text-foreground! no-underline">
              Go to sign in
            </Link>
          </Button>
        </div>
      </AuthPage>
    );
  }

  return (
    <AuthPage
      title={invite.isReset ? "Choose a new password" : `Welcome, ${invite.name}`}
      description={
        <>
          {invite.isReset ? "Set a new password for " : "Choose a password for "}
          <span className="font-medium text-foreground">{invite.email}</span>.
        </>
      }
    >
      <SetPasswordForm
        submitLabel={invite.isReset ? "Save password and sign in" : "Create account"}
        onSubmit={async (password) => {
          const result = await acceptInviteFn({ data: { token, password } });
          if (!result.ok) return result.error;
          window.location.assign("/");
          return null;
        }}
      />
    </AuthPage>
  );
}
