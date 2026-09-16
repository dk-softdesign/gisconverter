import { useState } from "react";

import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { coercePropertyValue } from "#/lib/property-value";

interface BulkEditDialogProps {
  open: boolean;
  count: number;
  existingKeys: string[];
  onOpenChange: (open: boolean) => void;
  onApply: (key: string, value: string | number | boolean | null) => void;
}

// Remounted with a fresh `key` each time it's opened (see index.tsx), so its
// own key/value draft state always starts blank.
export function BulkEditDialog({
  open,
  count,
  existingKeys,
  onOpenChange,
  onApply,
}: BulkEditDialogProps) {
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");

  function handleApply() {
    const trimmedKey = key.trim();
    if (!trimmedKey) return;
    onApply(trimmedKey, coercePropertyValue(value));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit {count} selected features</DialogTitle>
          <DialogDescription>
            Set one property to the same value on all selected features.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium" htmlFor="bulk-edit-key">
              Property
            </label>
            <Input
              id="bulk-edit-key"
              list="bulk-edit-existing-keys"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="e.g. status"
              autoComplete="off"
            />
            <datalist id="bulk-edit-existing-keys">
              {existingKeys.map((existingKey) => (
                <option key={existingKey} value={existingKey}>
                  {existingKey}
                </option>
              ))}
            </datalist>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium" htmlFor="bulk-edit-value">
              Value
            </label>
            <Input id="bulk-edit-value" value={value} onChange={(e) => setValue(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={!key.trim()} onClick={handleApply}>
            Apply to {count}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
