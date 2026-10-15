import { useState } from "react";
import { toast } from "sonner";

import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { FormField } from "#/components/form-field";
import { changePasswordFn } from "#/lib/auth-functions";
import { MIN_PASSWORD_LENGTH } from "#/lib/auth-types";

interface ChangePasswordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ChangePasswordDialog({ open, onOpenChange }: ChangePasswordDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>
            You stay signed in here; other browsers and devices are signed out.
          </DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so the fields start empty every time. */}
        {open && <ChangePasswordForm onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function ChangePasswordForm({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (next !== confirm) {
      setError("The new passwords don't match.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await changePasswordFn({ data: { current, next } });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast("Password changed");
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <FormField
        id="current-password"
        label="Current password"
        type="password"
        autoComplete="current-password"
        value={current}
        onChange={setCurrent}
        required
      />
      <FormField
        id="new-password"
        label="New password"
        hint={`At least ${MIN_PASSWORD_LENGTH} characters.`}
        type="password"
        autoComplete="new-password"
        value={next}
        onChange={setNext}
        minLength={MIN_PASSWORD_LENGTH}
        required
      />
      <FormField
        id="confirm-password"
        label="Repeat new password"
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={setConfirm}
        required
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Change password"}
        </Button>
      </DialogFooter>
    </form>
  );
}
