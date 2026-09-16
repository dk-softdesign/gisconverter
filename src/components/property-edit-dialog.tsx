import { useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";

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
import { coercePropertyValue, propertyValueToInputString } from "#/lib/property-value";

interface PropertyEditDialogProps {
  feature: GeoJSON.Feature | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (properties: Record<string, string | number | boolean | null>) => void;
}

interface DraftEntry {
  id: number;
  key: string;
  value: string;
}

function toDraftEntries(feature: GeoJSON.Feature | null): DraftEntry[] {
  if (!feature?.properties) return [];
  return Object.entries(feature.properties).map(([key, value], index) => ({
    id: index,
    key,
    value: propertyValueToInputString(value),
  }));
}

// Remounted with a fresh `key` each time a different feature is opened for
// editing (see index.tsx), so this component's own state only ever needs to
// initialize once from the feature it was opened with.
export function PropertyEditDialog({
  feature,
  open,
  onOpenChange,
  onSave,
}: PropertyEditDialogProps) {
  const [entries, setEntries] = useState<DraftEntry[]>(() => toDraftEntries(feature));
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const nextId = useRef(entries.length);

  function updateValue(id: number, value: string) {
    setEntries((prev) => prev.map((entry) => (entry.id === id ? { ...entry, value } : entry)));
  }

  function removeEntry(id: number) {
    setEntries((prev) => prev.filter((entry) => entry.id !== id));
  }

  function addEntry() {
    const key = newKey.trim();
    if (!key) return;
    setEntries((prev) => [...prev, { id: nextId.current++, key, value: newValue }]);
    setNewKey("");
    setNewValue("");
  }

  function handleSave() {
    const properties: Record<string, string | number | boolean | null> = {};
    for (const entry of entries) {
      const key = entry.key.trim();
      if (key) properties[key] = coercePropertyValue(entry.value);
    }
    onSave(properties);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit properties</DialogTitle>
          <DialogDescription>{feature ? `${feature.geometry.type} feature` : ""}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2 overflow-y-auto">
          {entries.map((entry) => (
            <div key={entry.id} className="flex items-center gap-2">
              <span className="w-32 shrink-0 truncate text-sm font-medium" title={entry.key}>
                {entry.key}
              </span>
              <Input
                value={entry.value}
                onChange={(e) => updateValue(entry.id, e.target.value)}
                className="flex-1"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0"
                onClick={() => removeEntry(entry.id)}
                aria-label={`Remove ${entry.key}`}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          {entries.length === 0 && (
            <p className="text-sm text-muted-foreground">No properties yet.</p>
          )}
          <div className="mt-1 flex items-center gap-2 border-t pt-3">
            <Input
              placeholder="New property"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              className="w-32 shrink-0"
            />
            <Input
              placeholder="Value"
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              className="flex-1"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="shrink-0"
              onClick={addEntry}
              disabled={!newKey.trim()}
              aria-label="Add property"
            >
              <Plus className="size-4" />
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
