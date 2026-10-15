import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Eye, ListChecks, Save, Search } from "lucide-react";

import { SearchableSelect } from "#/components/searchable-select";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { Input } from "#/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "#/components/ui/popover";
import type { GisSchema } from "#/lib/gis-schemas";
import { suggestPropertyMatches, type MatchConfidence } from "#/lib/property-matching";
import { propertyValueToInputString } from "#/lib/property-value";
import { cn } from "#/lib/utils";
import { setUserDataFn } from "#/lib/auth-functions";
import type { JsonValue } from "#/lib/auth-types";

interface PropertyMappingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  layerLabel: string;
  schemaLabel: string;
  schemaId: string;
  schema: GisSchema;
  sourceKeys: string[];
  features: GeoJSON.Feature[];
  onApply: (renameMap: Record<string, string>) => void;
  // Progress saved earlier for this layer+schema, fetched before opening.
  saved: SavedMapping | null;
}

const SKIP_VALUE = "__skip__";
// Older saved progress may still hold this; it's restored as "Don't rename".
const LEGACY_REMOVE_VALUE = "__remove__";
const VALUE_SAMPLE_LIMIT = 8;
export interface SavedMapping {
  selections: Record<string, string>;
  reviewed: string[];
}

// Saved per member on the server (user_data), one slot per layer+schema,
// overwritten on every explicit save — a resume point, not a version history.
export function savedMappingKey(schemaId: string, layerLabel: string): string {
  return `mapping:${schemaId}:${layerLabel}`;
}

export function parseSavedMapping(raw: JsonValue): SavedMapping | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const { selections, reviewed } = raw;
  if (!selections || typeof selections !== "object" || Array.isArray(selections)) return null;
  if (!Array.isArray(reviewed)) return null;
  return {
    selections: selections as Record<string, string>,
    reviewed: reviewed.filter((key): key is string => typeof key === "string"),
  };
}

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

interface SchemaPropertyOption {
  key: string;
  label: string;
  enum?: string[];
}

// Remounted with a fresh `key` each time it's opened for a given layer (same
// pattern as PropertyEditDialog/BulkEditDialog), so suggestions are always
// recomputed from the layer's current property keys.
export function PropertyMappingDialog({
  open,
  onOpenChange,
  layerLabel,
  schemaLabel,
  schemaId,
  schema,
  sourceKeys,
  features,
  onApply,
  saved,
}: PropertyMappingDialogProps) {
  const featureCount = features.length;
  const storageKey = savedMappingKey(schemaId, layerLabel);

  const suggestions = useMemo(
    () => suggestPropertyMatches(sourceKeys, schema),
    [sourceKeys, schema],
  );
  const rows = useMemo(() => suggestions.filter((s) => s.confidence !== "exact"), [suggestions]);

  // A saved draft (if any) wins per source key that's still present; any
  // source key not covered by it falls back to the usual auto-suggestion.
  const [selections, setSelections] = useState<Record<string, string>>(() => {
    const defaults = Object.fromEntries(
      rows.map((row) => [row.sourceKey, row.targetKey ?? SKIP_VALUE]),
    );
    if (!saved) return defaults;
    for (const row of rows) {
      const savedValue = saved.selections[row.sourceKey];
      if (savedValue !== undefined)
        defaults[row.sourceKey] = savedValue === LEGACY_REMOVE_VALUE ? SKIP_VALUE : savedValue;
    }
    return defaults;
  });

  // Purely a manual progress aid while working through a long property list —
  // not sent to onApply, and doesn't affect what gets renamed.
  const [reviewed, setReviewed] = useState<Set<string>>(() => {
    if (!saved) return new Set();
    const rowKeys = new Set(rows.map((row) => row.sourceKey));
    return new Set(saved.reviewed.filter((key) => rowKeys.has(key)));
  });

  const restoredFromSave = saved !== null;
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    if (!justSaved) return;
    const timer = setTimeout(() => setJustSaved(false), 1500);
    return () => clearTimeout(timer);
  }, [justSaved]);

  async function handleSaveProgress() {
    const payload: SavedMapping = { selections, reviewed: [...reviewed] };
    try {
      const result = await setUserDataFn({ data: { key: storageKey, value: { ...payload } } });
      if (result.ok) setJustSaved(true);
      else toast.error(`Couldn't save progress: ${result.error}`);
    } catch {
      toast.error("Couldn't save progress — check your connection.");
    }
  }

  const [search, setSearch] = useState("");
  const trimmedSearch = search.trim().toLowerCase();
  const visibleRows = trimmedSearch
    ? rows.filter((row) => row.sourceKey.toLowerCase().includes(trimmedSearch))
    : rows;

  // Applies to the rows currently shown by the search. Rows ticked as reviewed
  // are left alone, so resetting everything else after confirming a few
  // mappings doesn't wipe those out.
  function setAllUnreviewed(value: string) {
    setSelections((prev) => {
      const next = { ...prev };
      for (const row of visibleRows) {
        if (!reviewed.has(row.sourceKey)) next[row.sourceKey] = value;
      }
      return next;
    });
  }

  function toggleReviewed(sourceKey: string) {
    setReviewed((prev) => {
      const next = new Set(prev);
      if (next.has(sourceKey)) next.delete(sourceKey);
      else next.add(sourceKey);
      return next;
    });
  }

  // Sourced by title (falling back to the raw key) rather than the schema's
  // own declaration order, so the picker reads alphabetically the way a user
  // would scan it.
  const schemaProperties = useMemo((): SchemaPropertyOption[] => {
    return Object.entries(schema.properties)
      .map(([key, def]) => ({
        key,
        label: def.title ? `${def.title} (${key})` : key,
        enum: def.enum,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [schema]);

  // A schema property can only be the target of one source field at a time,
  // so once it's picked anywhere it disappears from every other row's list.
  const usedTargetKeys = useMemo(() => {
    const used = new Set<string>();
    for (const target of Object.values(selections)) {
      if (target !== SKIP_VALUE) used.add(target);
    }
    return used;
  }, [selections]);

  // Property keys each row would end up writing to — a skipped row keeps its
  // own key. Two rows landing on the same key would silently overwrite one
  // another, which custom names make easy to do by accident.
  const resultingKeyCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const key of sourceKeys) {
      const target = selections[key] ?? SKIP_VALUE;
      const resulting = target === SKIP_VALUE ? key : target;
      counts.set(resulting, (counts.get(resulting) ?? 0) + 1);
    }
    return counts;
  }, [sourceKeys, selections]);

  const changeCount = Object.values(selections).filter((v) => v !== SKIP_VALUE).length;

  function handleApply() {
    const renameMap: Record<string, string> = {};
    for (const [sourceKey, targetKey] of Object.entries(selections)) {
      if (targetKey !== SKIP_VALUE) renameMap[sourceKey] = targetKey;
    }
    // Done with this mapping, so its saved progress goes. Best effort: a
    // leftover draft is harmless and can be cleared in Settings.
    setUserDataFn({ data: { key: storageKey, value: null } }).catch(() => {});
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
            and names — review and adjust before applying, or type a custom name to rename a
            property to something outside the schema. To delete a property, use its column in the
            List tab.
          </DialogDescription>
          {rows.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {reviewed.size} of {rows.length} reviewed
              {restoredFromSave && " — restored from your last saved progress"}
            </p>
          )}
        </DialogHeader>

        {rows.length > 0 && (
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search source properties…"
              className="pl-9"
              aria-label="Search source properties"
            />
          </div>
        )}

        {visibleRows.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">
              Set all{trimmedSearch ? ` ${visibleRows.length} shown` : ""}
              {reviewed.size > 0 ? " unreviewed" : ""} to:
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAllUnreviewed(SKIP_VALUE)}
            >
              Don&apos;t rename
            </Button>
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          {rows.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Every property on this layer already matches the schema — nothing to rename.
            </p>
          )}
          {rows.length > 0 && visibleRows.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No source property matches &quot;{search.trim()}&quot;.
            </p>
          )}
          {visibleRows.map((row) => {
            const selected = selections[row.sourceKey] ?? SKIP_VALUE;
            const takenKeys = new Set(usedTargetKeys);
            takenKeys.delete(selected);
            return (
              <MappingRow
                key={row.sourceKey}
                sourceKey={row.sourceKey}
                confidence={row.confidence}
                selected={selected}
                collides={selected !== SKIP_VALUE && (resultingKeyCounts.get(selected) ?? 0) > 1}
                onChange={(value) => setSelections((prev) => ({ ...prev, [row.sourceKey]: value }))}
                schemaProperties={schemaProperties}
                takenKeys={takenKeys}
                features={features}
                reviewed={reviewed.has(row.sourceKey)}
                onToggleReviewed={() => toggleReviewed(row.sourceKey)}
              />
            );
          })}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" className="sm:mr-auto" onClick={handleSaveProgress}>
            <Save className="size-4" />
            {justSaved ? "Saved" : "Save progress"}
          </Button>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={changeCount === 0} onClick={handleApply}>
            Apply {changeCount} change{changeCount === 1 ? "" : "s"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface MappingRowProps {
  sourceKey: string;
  confidence: MatchConfidence;
  selected: string;
  collides: boolean;
  onChange: (value: string) => void;
  schemaProperties: SchemaPropertyOption[];
  takenKeys: Set<string>;
  features: GeoJSON.Feature[];
  reviewed: boolean;
  onToggleReviewed: () => void;
}

function MappingRow({
  sourceKey,
  confidence,
  selected,
  collides,
  onChange,
  schemaProperties,
  takenKeys,
  features,
  reviewed,
  onToggleReviewed,
}: MappingRowProps) {
  const selectedOption = schemaProperties.find((option) => option.key === selected);
  const enumValues = selectedOption?.enum;
  const isCustom = selected !== SKIP_VALUE && !selectedOption;

  let hint = CONFIDENCE_LABEL[confidence];
  let hintClass = CONFIDENCE_CLASS[confidence];
  if (collides) {
    hint = `Another property also ends up named "${selected}" — one value will overwrite the other.`;
    hintClass = "text-destructive";
  } else if (isCustom) {
    hint = "Custom name — not defined in the schema.";
    hintClass = "text-amber-600 dark:text-amber-400";
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-lg border p-2.5 transition-opacity",
        reviewed && "opacity-60",
      )}
    >
      <div className="flex items-center gap-2">
        <Checkbox
          checked={reviewed}
          onCheckedChange={onToggleReviewed}
          aria-label={`Mark ${sourceKey} as reviewed`}
          className="shrink-0"
        />
        <span className="w-36 shrink-0 truncate text-sm font-medium" title={sourceKey}>
          {sourceKey}
        </span>
        <ValuePreviewButton sourceKey={sourceKey} features={features} />
        <TargetPropertyPicker
          value={selected}
          onChange={onChange}
          options={schemaProperties}
          takenKeys={takenKeys}
        />
        {selectedOption && enumValues && enumValues.length > 0 && (
          <EnumPreviewButton propertyLabel={selectedOption.label} values={enumValues} />
        )}
      </div>
      <span className={cn("text-xs", hintClass)}>{hint}</span>
    </div>
  );
}

interface TargetPropertyPickerProps {
  value: string;
  onChange: (value: string) => void;
  options: SchemaPropertyOption[];
  takenKeys: Set<string>;
}

function TargetPropertyPicker({ value, onChange, options, takenKeys }: TargetPropertyPickerProps) {
  const availableOptions = options.filter((option) => !takenKeys.has(option.key));

  return (
    <SearchableSelect
      className="flex-1"
      value={value}
      onValueChange={onChange}
      groups={[
        {
          options: [{ value: SKIP_VALUE, label: "Don't rename" }],
        },
        {
          options: availableOptions.map((option) => ({
            value: option.key,
            label: option.label,
            keywords: [option.key],
          })),
        },
      ]}
      searchPlaceholder="Search or type a new name..."
      emptyText="No property found."
      allowCustom
      customItemLabel={(custom) => `Rename to "${custom}"`}
    />
  );
}

function sampleValuesFor(features: GeoJSON.Feature[], key: string) {
  const counts = new Map<string, number>();
  for (const feature of features) {
    const raw = feature.properties?.[key];
    if (raw === undefined) continue;
    const value = propertyValueToInputString(raw);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return { samples: sorted.slice(0, VALUE_SAMPLE_LIMIT), totalDistinct: sorted.length };
}

function ValuePreviewButton({
  sourceKey,
  features,
}: {
  sourceKey: string;
  features: GeoJSON.Feature[];
}) {
  const { samples, totalDistinct } = useMemo(
    () => sampleValuesFor(features, sourceKey),
    [features, sourceKey],
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          aria-label={`Preview values for ${sourceKey}`}
        >
          <Eye className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        <PopoverHeader>
          <PopoverTitle>{sourceKey}</PopoverTitle>
          <PopoverDescription>Values seen in the source file</PopoverDescription>
        </PopoverHeader>
        {samples.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No values found.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {samples.map(([value, count]) => (
              <li key={value} className="flex items-center justify-between gap-3">
                <span className="truncate">{value === "" ? <em>(empty)</em> : value}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{count}</span>
              </li>
            ))}
          </ul>
        )}
        {totalDistinct > samples.length && (
          <p className="mt-2 text-xs text-muted-foreground">
            + {totalDistinct - samples.length} more distinct value
            {totalDistinct - samples.length === 1 ? "" : "s"}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

function EnumPreviewButton({ propertyLabel, values }: { propertyLabel: string; values: string[] }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0"
          aria-label={`Allowed values for ${propertyLabel}`}
        >
          <ListChecks className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        <PopoverHeader>
          <PopoverTitle>{propertyLabel}</PopoverTitle>
          <PopoverDescription>Allowed values defined by the schema</PopoverDescription>
        </PopoverHeader>
        <ul className="mt-2 flex flex-wrap gap-1">
          {values.map((value) => (
            <li key={value} className="rounded-md border bg-muted px-1.5 py-0.5 font-mono text-xs">
              {value}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
