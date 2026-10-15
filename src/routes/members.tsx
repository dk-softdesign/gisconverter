import { useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Check, Copy, Link2, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { AppHeader } from "#/components/app-header";
import { FormField } from "#/components/form-field";
import { Button } from "#/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import {
  deleteMemberFn,
  inviteMemberFn,
  listMembersFn,
  newSignInLinkFn,
  updateMemberFn,
} from "#/lib/auth-functions";
import { requireSignedIn } from "#/lib/auth-query";
import type { Member, Role } from "#/lib/auth-types";
import { cn } from "#/lib/utils";

export const Route = createFileRoute("/members")({
  beforeLoad: ({ context, location }) => requireSignedIn(context.auth, location, { admin: true }),
  loader: () => listMembersFn(),
  component: MembersPage,
});

const STATUS_LABEL: Record<Member["status"], string> = {
  active: "Active",
  invited: "Invited",
  disabled: "Disabled",
};

const STATUS_CLASS: Record<Member["status"], string> = {
  active: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  invited: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  disabled: "bg-muted text-muted-foreground",
};

function formatDate(timestamp: number | null): string {
  if (!timestamp) return "Never";
  return new Date(timestamp).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

// Invite links are built in the browser from its own origin, so they're
// right behind any proxy without the server having to know its public URL.
function inviteUrl(token: string): string {
  return `${window.location.origin}/invite/${token}`;
}

function MembersPage() {
  const { members, me } = Route.useLoaderData();
  const router = useRouter();
  const [inviteOpen, setInviteOpen] = useState(false);
  // The link to show after inviting someone or issuing a new sign-in link.
  const [issuedLink, setIssuedLink] = useState<{
    member: string;
    url: string;
    isReset: boolean;
  } | null>(null);

  const refresh = () => router.invalidate();

  return (
    <>
      <AppHeader user={me} />
      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-8">
        <Card>
          <CardHeader>
            <CardTitle>Members</CardTitle>
            <CardDescription>
              Everyone who can sign in. Admins can manage members; members can use the converter.
            </CardDescription>
            <CardAction>
              <Button type="button" onClick={() => setInviteOpen(true)}>
                <UserPlus />
                Invite member
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <div className="thin-scrollbar overflow-x-auto">
              <table className="w-full min-w-170 text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-2 pr-3 font-medium">Member</th>
                    <th className="py-2 pr-3 font-medium">Role</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 pr-3 font-medium">Last sign-in</th>
                    <th className="py-2 font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((member) => (
                    <MemberRow
                      key={member.id}
                      member={member}
                      isMe={member.id === me.id}
                      onChanged={refresh}
                      onLinkIssued={(url) =>
                        setIssuedLink({
                          member: member.name,
                          url,
                          isReset: member.status === "active",
                        })
                      }
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </main>

      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onInvited={(name, url) => {
          setInviteOpen(false);
          setIssuedLink({ member: name, url, isReset: false });
          void refresh();
        }}
      />
      <LinkDialog link={issuedLink} onClose={() => setIssuedLink(null)} />
    </>
  );
}

// Shows a server error as a toast; returns whether the call succeeded.
async function run(action: () => Promise<{ ok: true } | { ok: false; error: string }>) {
  try {
    const result = await action();
    if (!result.ok) toast.error(result.error);
    return result.ok;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Something went wrong.");
    return false;
  }
}

function MemberRow({
  member,
  isMe,
  onChanged,
  onLinkIssued,
}: {
  member: Member;
  isMe: boolean;
  onChanged: () => void;
  onLinkIssued: (url: string) => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  async function act(action: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setBusy(true);
    if (await run(action)) onChanged();
    setBusy(false);
  }

  async function issueLink() {
    setBusy(true);
    try {
      const result = await newSignInLinkFn({ data: { id: member.id } });
      if (result.ok) {
        onLinkIssued(inviteUrl(result.token));
        onChanged();
      } else {
        toast.error(result.error);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className={cn("border-b last:border-b-0", member.status === "disabled" && "opacity-60")}>
      <td className="py-2.5 pr-3">
        <div className="font-medium">
          {member.name}
          {isMe && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(you)</span>}
        </div>
        <div className="text-xs text-muted-foreground">{member.email}</div>
      </td>
      <td className="py-2.5 pr-3">
        <Select
          value={member.role}
          disabled={isMe || busy}
          onValueChange={(role) =>
            act(() => updateMemberFn({ data: { id: member.id, role: role as Role } }))
          }
        >
          <SelectTrigger size="sm" className="w-28" aria-label={`Role for ${member.name}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="member">Member</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
          </SelectContent>
        </Select>
      </td>
      <td className="py-2.5 pr-3">
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs font-medium",
            STATUS_CLASS[member.status],
          )}
        >
          {STATUS_LABEL[member.status]}
        </span>
        {member.status === "invited" && member.inviteExpiresAt && (
          <div className="mt-1 text-xs text-muted-foreground">
            {member.inviteExpired
              ? "Link expired"
              : `Link valid until ${formatDate(member.inviteExpiresAt)}`}
          </div>
        )}
      </td>
      <td className="py-2.5 pr-3 text-muted-foreground">{formatDate(member.lastLoginAt)}</td>
      <td className="py-2.5">
        {isMe ? null : confirmingDelete ? (
          <div className="flex justify-end gap-1.5">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() => act(() => deleteMemberFn({ data: { id: member.id } }))}
            >
              Delete {member.name.split(" ")[0]}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setConfirmingDelete(false)}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex justify-end gap-1.5">
            {member.status !== "disabled" && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={issueLink}
                title={
                  member.status === "invited"
                    ? "Create a new invite link (the old one stops working)"
                    : "Create a link to set a new password"
                }
              >
                <Link2 />
                {member.status === "invited" ? "New invite link" : "Reset password"}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() =>
                act(() =>
                  updateMemberFn({
                    data: { id: member.id, disabled: member.status !== "disabled" },
                  }),
                )
              }
            >
              {member.status === "disabled" ? "Enable" : "Disable"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-destructive"
              disabled={busy}
              onClick={() => setConfirmingDelete(true)}
              aria-label={`Delete ${member.name}`}
              title="Delete member"
            >
              <Trash2 />
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}

function InviteDialog({
  open,
  onOpenChange,
  onInvited,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInvited: (name: string, url: string) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite member</DialogTitle>
          <DialogDescription>
            You&apos;ll get a one-time link to send them. They choose their own password.
          </DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so the form starts empty every time. */}
        {open && <InviteForm onCancel={() => onOpenChange(false)} onInvited={onInvited} />}
      </DialogContent>
    </Dialog>
  );
}

function InviteForm({
  onCancel,
  onInvited,
}: {
  onCancel: () => void;
  onInvited: (name: string, url: string) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("member");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await inviteMemberFn({ data: { name, email, role } });
      if (result.ok) onInvited(name.trim(), inviteUrl(result.token));
      else setError(result.error);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <FormField id="invite-name" label="Name" value={name} onChange={setName} required />
      <FormField
        id="invite-email"
        label="Email"
        type="email"
        value={email}
        onChange={setEmail}
        required
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="invite-role" className="text-sm font-medium">
          Role
        </label>
        <Select value={role} onValueChange={(value) => setRole(value as Role)}>
          <SelectTrigger id="invite-role" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="member">Member — can use the converter</SelectItem>
            <SelectItem value="admin">Admin — can also manage members</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Inviting…" : "Create invite link"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function LinkDialog({
  link,
  onClose,
}: {
  link: { member: string; url: string; isReset: boolean } | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  // Keeps showing the last link while the dialog animates closed, instead of
  // flashing "undefined" once `link` is cleared.
  const [shown, setShown] = useState(link);
  if (link && link !== shown) setShown(link);

  async function copy() {
    if (!shown) return;
    try {
      await navigator.clipboard.writeText(shown.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // The clipboard API needs HTTPS (or localhost); the field is selectable
      // for copying by hand.
      toast("Couldn't copy automatically — select the link and copy it.");
    }
  }

  return (
    <Dialog open={link !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {shown?.isReset
              ? `Password link for ${shown.member}`
              : `Invite link for ${shown?.member}`}
          </DialogTitle>
          <DialogDescription>
            Send this link to {shown?.member}. It works once and expires in 7 days. It won&apos;t be
            shown again — you can always create a new one.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input
            readOnly
            value={shown?.url ?? ""}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Sign-in link"
            className="font-mono text-xs"
          />
          <Button type="button" variant="outline" onClick={copy}>
            {copied ? <Check /> : <Copy />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <DialogFooter>
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
