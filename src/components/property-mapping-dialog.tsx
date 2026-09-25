import { useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown, Eye, ListChecks, Save } from "lucide-react";

import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "#/components/ui/command";
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

interface PropertyMappingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  layerLabel: string;
  schemaLabel: string;
  schemaId: string;
  schema: GisSchema;
  sourceKeys: string[];
  features: GeoJSON.Feature[];
  onApply: (renameMap: Record<string, string | null>) => void;
}

const SKIP_VALUE = "__skip__";
const REMOVE_VALUE = "__remove__";
const VALUE_SAMPLE_LIMIT = 8;
const SAVED_MAPPING_PREFIX = "gisconverter:propertyMapping:";

interface SavedMapping {
  selections: Record<string, string>;
  reviewed: string[];
}

// Just one slot per layer+schema, overwritten on every explicit save — a
// resume point, not a version history.
function savedMappingKey(schemaId: string, layerLabel: string): string {
  return `${SAVED_MAPPING_PREFIX}${schemaId}:${layerLabel}`;
}

function loadSavedMapping(key: string): SavedMapping | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedMapping>;
    if (!parsed.selections || !Array.isArray(parsed.reviewed)) return null;
    return { selections: parsed.selections, reviewed: parsed.reviewed };
  } catch {
    return null;
  }
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
    const saved = loadSavedMapping(storageKey);
    if (!saved) return defaults;
    for (const row of rows) {
      if (row.sourceKey in saved.selections)
        defaults[row.sourceKey] = saved.selections[row.sourceKey];
    }
    return defaults;
  });

  // Purely a manual progress aid while working through a long property list —
  // not sent to onApply, and doesn't affect what gets renamed or removed.
  const [reviewed, setReviewed] = useState<Set<string>>(() => {
    const saved = loadSavedMapping(storageKey);
    if (!saved) return new Set();
    const rowKeys = new Set(rows.map((row) => row.sourceKey));
    return new Set(saved.reviewed.filter((key) => rowKeys.has(key)));
  });

  const [restoredFromSave] = useState(() => loadSavedMapping(storageKey) !== null);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    if (!justSaved) return;
    const timer = setTimeout(() => setJustSaved(false), 1500);
    return () => clearTimeout(timer);
  }, [justSaved]);

  function handleSaveProgress() {
    try {
      const payload: SavedMapping = { selections, reviewed: [...reviewed] };
      localStorage.setItem(storageKey, JSON.stringify(payload));
      setJustSaved(true);
    } catch {
      // localStorage unavailable (private browsing, etc.) — nothing to do.
    }
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
      if (target !== SKIP_VALUE && target !== REMOVE_VALUE) used.add(target);
    }
    return used;
  }, [selections]);

  const changeCount = Object.values(selections).filter((v) => v !== SKIP_VALUE).length;

  function handleApply() {
    const renameMap: Record<string, string | null> = {};
    for (const [sourceKey, targetKey] of Object.entries(selections)) {
      if (targetKey === SKIP_VALUE) continue;
      renameMap[sourceKey] = targetKey === REMOVE_VALUE ? null : targetKey;
    }
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // localStorage unavailable — nothing to do.
    }
    onApply(renameMap);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Match property names — {layerLabel}</DialogTitle>
          <DialogDescription>
            Rename or remove properties on {featureCount} feature{featureCount === 1 ? "" : "s"} to
            match the {schemaLabel} schema. Suggestions are based on the schema&apos;s source-field
            aliases and names — review and adjust before applying.
          </DialogDescription>
          {rows.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {reviewed.size} of {rows.length} reviewed
              {restoredFromSave && " — restored from your last saved progress"}
            </p>
          )}
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
          {rows.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Every property on this layer already matches the schema — nothing to rename.
            </p>
          )}
          {rows.map((row) => {
            const selected = selections[row.sourceKey] ?? SKIP_VALUE;
            const takenKeys = new Set(usedTargetKeys);
            takenKeys.delete(selected);
            return (
              <MappingRow
                key={row.sourceKey}
                sourceKey={row.sourceKey}
                confidence={row.confidence}
                selected={selected}
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
  onChange,
  schemaProperties,
  takenKeys,
  features,
  reviewed,
  onToggleReviewed,
}: MappingRowProps) {
  const selectedOption = schemaProperties.find((option) => option.key === selected);
  const enumValues = selectedOption?.enum;

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
      <span
        className={cn(
          "text-xs",
          selected === REMOVE_VALUE ? "text-destructive" : CONFIDENCE_CLASS[confidence],
        )}
      >
        {selected === REMOVE_VALUE
          ? "This property will be removed from the output."
          : CONFIDENCE_LABEL[confidence]}
      </span>
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
  const [open, setOpen] = useState(false);
  const availableOptions = options.filter((option) => !takenKeys.has(option.key));

  const selectedLabel =
    value === SKIP_VALUE
      ? "Don't rename"
      : value === REMOVE_VALUE
        ? "Remove property"
        : (options.find((option) => option.key === value)?.label ?? value);

  function select(next: string) {
    onChange(next);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          aria-expanded={open}
          className={cn(
            "flex-1 justify-between font-normal",
            value === REMOVE_VALUE && "text-destructive",
          )}
        >
          <span className="truncate">{selectedLabel}</span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popper-anchor-width)] p-0">
        {/*
          disablePointerSelection: without it, cmdk highlights whatever item is
          under the cursor on every pointermove — including the ones that slide
          under a stationary cursor while the list scrolls, which calls
          scrollIntoView on each and fights the user's own wheel scroll.
        */}
        <Command disablePointerSelection>
          <CommandInput placeholder="Search properties..." />
          <CommandList>
            <CommandEmpty>No property found.</CommandEmpty>
            <CommandGroup>
              <CommandItem value="Don't rename" onSelect={() => select(SKIP_VALUE)}>
                <Check
                  className={cn("size-4", value === SKIP_VALUE ? "opacity-100" : "opacity-0")}
                />
                Don&apos;t rename
              </CommandItem>
              <CommandItem
                value="Remove property"
                className="text-destructive data-[selected=true]:text-destructive"
                onSelect={() => select(REMOVE_VALUE)}
              >
                <Check
                  className={cn("size-4", value === REMOVE_VALUE ? "opacity-100" : "opacity-0")}
                />
                Remove property
              </CommandItem>
            </CommandGroup>
            <CommandGroup>
              {availableOptions.map((option) => (
                <CommandItem
                  key={option.key}
                  value={option.label}
                  keywords={[option.key]}
                  onSelect={() => select(option.key)}
                >
                  <Check
                    className={cn("size-4", value === option.key ? "opacity-100" : "opacity-0")}
                  />
                  <span className="truncate">{option.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
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
