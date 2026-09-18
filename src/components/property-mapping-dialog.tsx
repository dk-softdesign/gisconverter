import { useMemo, useState } from "react";

import { Button } from "#/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import type { GisSchema } from "#/lib/gis-schemas";
import { suggestPropertyMatches, type MatchConfidence } from "#/lib/property-matching";
import { cn } from "#/lib/utils";

interface PropertyMappingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  layerLabel: string;
  schemaLabel: string;
  schema: GisSchema;
  sourceKeys: string[];
  featureCount: number;
  onApply: (renameMap: Record<string, string>) => void;
}

const SKIP_VALUE = "__skip__";

const CONFIDENCE_LABEL: Record<MatchConfidence, string> = {
  exact: "Already matches",
  alias: "Matched by source field alias",
  name: "Matched by name",
  fuzzy: "Fuzzy match — please confirm",
  none: "No match found",
};

const CONFIDENCE_CLASS: Record<MatchConfidence, string> = {
  exact: "text-muted-foreground",
  alias: "text-emerald-600 dark:text-emerald-400",
  name: "text-emerald-600 dark:text-emerald-400",
  fuzzy: "text-amber-600 dark:text-amber-400",
  none: "text-muted-foreground",
};

// Remounted with a fresh `key` each time it's opened for a given layer (same
// pattern as PropertyEditDialog/BulkEditDialog), so suggestions are always
// recomputed from the layer's current property keys.
export function PropertyMappingDialog({
  open,
  onOpenChange,
  layerLabel,
  schemaLabel,
  schema,
  sourceKeys,
  featureCount,
  onApply,
}: PropertyMappingDialogProps) {
  const suggestions = useMemo(
    () => suggestPropertyMatches(sourceKeys, schema),
    [sourceKeys, schema],
  );
  const rows = useMemo(() => suggestions.filter((s) => s.confidence !== "exact"), [suggestions]);

  const [selections, setSelections] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((row) => [row.sourceKey, row.targetKey ?? SKIP_VALUE])),
  );

  const schemaProperties = useMemo(
    () => Object.entries(schema.properties).sort(([, a], [, b]) => (a.index ?? 0) - (b.index ?? 0)),
    [schema],
  );

  const targetCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const target of Object.values(selections)) {
      if (target === SKIP_VALUE) continue;
      counts.set(target, (counts.get(target) ?? 0) + 1);
    }
    return counts;
  }, [selections]);

  const hasConflict = [...targetCounts.values()].some((count) => count > 1);
  const renameCount = Object.values(selections).filter((v) => v !== SKIP_VALUE).length;

  function handleApply() {
    const renameMap: Record<string, string> = {};
    for (const [sourceKey, targetKey] of Object.entries(selections)) {
      if (targetKey !== SKIP_VALUE) renameMap[sourceKey] = targetKey;
    }
    onApply(renameMap);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Match property names — {layerLabel}</DialogTitle>
          <DialogDescription>
            Rename properties on {featureCount} feature{featureCount === 1 ? "" : "s"} to match the{" "}
            {schemaLabel} schema. Suggestions are based on the schema&apos;s source-field aliases
            and names — review and adjust before applying.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 overflow-y-auto">
          {rows.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Every property on this layer already matches the schema — nothing to rename.
            </p>
          )}
          {rows.map((row) => {
            const selected = selections[row.sourceKey] ?? SKIP_VALUE;
            const conflicted = selected !== SKIP_VALUE && (targetCounts.get(selected) ?? 0) > 1;
            return (
              <div key={row.sourceKey} className="flex flex-col gap-1 rounded-lg border p-2.5">
                <div className="flex items-center gap-2">
                  <span
                    className="w-36 shrink-0 truncate text-sm font-medium"
                    title={row.sourceKey}
                  >
                    {row.sourceKey}
                  </span>
                  <Select
                    value={selected}
                    onValueChange={(value) =>
                      setSelections((prev) => ({ ...prev, [row.sourceKey]: value }))
                    }
                  >
                    <SelectTrigger className={cn("flex-1", conflicted && "border-destructive")}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SKIP_VALUE}>Don&apos;t rename</SelectItem>
                      {schemaProperties.map(([key, def]) => (
                        <SelectItem key={key} value={key}>
                          {def.title ? `${def.title} (${key})` : key}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <span className={cn("text-xs", CONFIDENCE_CLASS[row.confidence])}>
                  {conflicted
                    ? "Assigned to the same property as another field — pick a different one or skip."
                    : CONFIDENCE_LABEL[row.confidence]}
                </span>
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={renameCount === 0 || hasConflict} onClick={handleApply}>
            Rename {renameCount} propert{renameCount === 1 ? "y" : "ies"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
