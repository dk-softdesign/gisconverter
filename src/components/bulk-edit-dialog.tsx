import { Loader2, Sparkles, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "#/components/ui/dialog";
import { SearchableSelect } from "#/components/searchable-select";
import { Input } from "#/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { Textarea } from "#/components/ui/textarea";
import { PREDEFINED_SCRIPTS } from "#/lib/predefined-scripts";
import {
  coercePropertyValue,
  propertyValueToInputString,
  type PropertyRecord,
} from "#/lib/property-value";

const ALL_KEYS_SCOPE = "*";
const PREVIEW_SAMPLE_SIZE = 8;
const SAVED_PRESETS_KEY = "gisconverter:bulk-edit-presets";
const CLAUDE_SAMPLE_SIZE = 20;

interface BulkEditDialogProps {
  open: boolean;
  features: GeoJSON.Feature[];
  existingKeys: string[];
  onOpenChange: (open: boolean) => void;
  onApply: (updates: Map<GeoJSON.Feature, PropertyRecord>, removals: Set<GeoJSON.Feature>) => void;
}

type Mode = "set" | "replace" | "script" | "remove";

type RemoveCondition =
  | "empty"
  | "not-empty"
  | "equals"
  | "not-equals"
  | "contains"
  | "regex"
  | "duplicate-keep-first"
  | "duplicate-all";

const REMOVE_CONDITIONS: { value: RemoveCondition; label: string; needsValue: boolean }[] = [
  { value: "empty", label: "is empty (null, missing or blank)", needsValue: false },
  { value: "not-empty", label: "is not empty", needsValue: false },
  { value: "equals", label: "equals", needsValue: true },
  { value: "not-equals", label: "does not equal", needsValue: true },
  { value: "contains", label: "contains", needsValue: true },
  { value: "regex", label: "matches regular expression", needsValue: true },
  { value: "duplicate-keep-first", label: "is a duplicate (keep first)", needsValue: false },
  { value: "duplicate-all", label: "is duplicated (all occurrences)", needsValue: false },
];

function isDuplicateCondition(condition: RemoveCondition) {
  return condition === "duplicate-keep-first" || condition === "duplicate-all";
}

interface PreviewRow {
  feature: GeoJSON.Feature;
  before: PropertyRecord;
  after: PropertyRecord | null;
  changed: boolean;
  removed: boolean;
  error: string | null;
}

interface ReplacePreset {
  pattern: string;
  replacement: string;
  caseInsensitive: boolean;
}

// Keyed by the user's short name; saving under an existing name overwrites it.
interface SavedPresets {
  replace: Record<string, ReplacePreset>;
  script: Record<string, string>;
}

function loadSavedPresets(): SavedPresets {
  try {
    const raw = localStorage.getItem(SAVED_PRESETS_KEY);
    if (!raw) return { replace: {}, script: {} };
    const parsed = JSON.parse(raw) as Partial<SavedPresets>;
    return { replace: parsed.replace ?? {}, script: parsed.script ?? {} };
  } catch {
    return { replace: {}, script: {} };
  }
}

function storeSavedPresets(presets: SavedPresets) {
  try {
    localStorage.setItem(SAVED_PRESETS_KEY, JSON.stringify(presets));
  } catch {
    // localStorage unavailable (private browsing, etc.) — presets just won't persist.
  }
}

function applySetValue(before: PropertyRecord, key: string, value: PropertyRecord[string]) {
  return { ...before, [key]: value };
}

function applyFindReplace(
  before: PropertyRecord,
  scopeKey: string,
  regex: RegExp,
  replacement: string,
): PropertyRecord {
  const after: PropertyRecord = { ...before };
  for (const [key, value] of Object.entries(before)) {
    if (scopeKey !== ALL_KEYS_SCOPE && scopeKey !== key) continue;
    if (value === null) continue;
    const original = propertyValueToInputString(value);
    const replaced = original.replace(regex, replacement);
    if (replaced !== original) after[key] = coercePropertyValue(replaced);
  }
  return after;
}

// The user-authored snippet is a function body, e.g. `return { ...props, name: props.name.trim() }`.
// It only ever runs client-side against data the user already loaded, so `new Function` needs no
// sandboxing here — the risk model is the same as pasting a snippet into the devtools console.
function compileScript(code: string): (feature: GeoJSON.Feature) => PropertyRecord {
  const fn = new Function("props", "feature", code) as (
    props: PropertyRecord,
    feature: GeoJSON.Feature,
  ) => PropertyRecord;
  return (feature) => fn({ ...(feature.properties as PropertyRecord) }, feature);
}

// How often a feature's value occurs among the selection, and whether this
// feature is the first one carrying it — only used by the duplicate conditions.
interface DuplicateInfo {
  count: number;
  isFirst: boolean;
}

// Values are compared in their input-string form, so `equals 42` matches both the
// number 42 and the string "42", and null/missing both count as "".
function matchesRemoveCondition(
  value: PropertyRecord[string] | undefined,
  condition: RemoveCondition,
  target: string,
  regex: RegExp | null,
  duplicate: DuplicateInfo,
): boolean {
  const text = propertyValueToInputString(value);
  switch (condition) {
    case "duplicate-keep-first":
      return duplicate.count > 1 && !duplicate.isFirst;
    case "duplicate-all":
      return duplicate.count > 1;
    case "empty":
      return text.trim() === "";
    case "not-empty":
      return text.trim() !== "";
    case "equals":
      return text === target;
    case "not-equals":
      return text !== target;
    case "contains":
      return text.toLowerCase().includes(target.toLowerCase());
    case "regex":
      return regex !== null && regex.test(text);
  }
}

function recordsEqual(a: PropertyRecord, b: PropertyRecord): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => a[key] === b[key]);
}

// Remounted with a fresh `key` each time it's opened (see index.tsx), so its
// own draft state always starts blank.
export function BulkEditDialog({
  open,
  features,
  existingKeys,
  onOpenChange,
  onApply,
}: BulkEditDialogProps) {
  const [mode, setMode] = useState<Mode>("set");

  const [setKey, setSetKey] = useState("");
  const [setValue, setSetValue] = useState("");

  const [replaceScope, setReplaceScope] = useState(ALL_KEYS_SCOPE);
  const [pattern, setPattern] = useState("");
  const [replacement, setReplacement] = useState("");
  const [caseInsensitive, setCaseInsensitive] = useState(false);

  const [script, setScript] = useState("");

  const [removeKey, setRemoveKey] = useState("");
  const [removeCondition, setRemoveCondition] = useState<RemoveCondition>("empty");
  const [removeValue, setRemoveValue] = useState("");
  const removeNeedsValue =
    REMOVE_CONDITIONS.find((c) => c.value === removeCondition)?.needsValue ?? false;

  const [savedPresets, setSavedPresets] = useState(loadSavedPresets);

  function updateSavedPresets(next: SavedPresets) {
    setSavedPresets(next);
    storeSavedPresets(next);
  }

  function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
    const { [key]: _removed, ...rest } = record;
    return rest;
  }

  const preview = useMemo((): { rows: PreviewRow[]; scriptError: string | null } => {
    if (mode === "set") {
      const key = setKey.trim();
      if (!key) return { rows: [], scriptError: null };
      const value = coercePropertyValue(setValue);
      const rows = features.map((feature): PreviewRow => {
        const before = (feature.properties ?? {}) as PropertyRecord;
        const after = applySetValue(before, key, value);
        return {
          feature,
          before,
          after,
          changed: !recordsEqual(before, after),
          removed: false,
          error: null,
        };
      });
      return { rows, scriptError: null };
    }

    if (mode === "replace") {
      if (!pattern) return { rows: [], scriptError: null };
      let regex: RegExp;
      try {
        regex = new RegExp(pattern, caseInsensitive ? "gi" : "g");
      } catch (err) {
        return { rows: [], scriptError: err instanceof Error ? err.message : "Invalid pattern" };
      }
      const rows = features.map((feature): PreviewRow => {
        const before = (feature.properties ?? {}) as PropertyRecord;
        const after = applyFindReplace(before, replaceScope, regex, replacement);
        return {
          feature,
          before,
          after,
          changed: !recordsEqual(before, after),
          removed: false,
          error: null,
        };
      });
      return { rows, scriptError: null };
    }

    if (mode === "remove") {
      if (!removeKey) return { rows: [], scriptError: null };
      let regex: RegExp | null = null;
      if (removeCondition === "regex") {
        if (!removeValue) return { rows: [], scriptError: null };
        try {
          regex = new RegExp(removeValue);
        } catch (err) {
          return { rows: [], scriptError: err instanceof Error ? err.message : "Invalid pattern" };
        }
      }
      // Empty values are never treated as duplicates of each other — use
      // "is empty" for those.
      const valueOf = (feature: GeoJSON.Feature) =>
        propertyValueToInputString((feature.properties ?? {})[removeKey]).trim();
      const counts = new Map<string, number>();
      for (const feature of features) {
        const text = valueOf(feature);
        if (text) counts.set(text, (counts.get(text) ?? 0) + 1);
      }
      const seen = new Set<string>();
      const rows = features.map((feature): PreviewRow => {
        const before = (feature.properties ?? {}) as PropertyRecord;
        const text = valueOf(feature);
        const duplicate = { count: text ? (counts.get(text) ?? 0) : 0, isFirst: !seen.has(text) };
        seen.add(text);
        const removed = matchesRemoveCondition(
          before[removeKey],
          removeCondition,
          removeValue,
          regex,
          duplicate,
        );
        return { feature, before, after: null, changed: removed, removed, error: null };
      });
      // Group the preview by value so the duplicates sit next to each other.
      if (isDuplicateCondition(removeCondition)) {
        rows.sort((a, b) => valueOf(a.feature).localeCompare(valueOf(b.feature)));
      }
      return { rows, scriptError: null };
    }

    // script
    const trimmed = script.trim();
    if (!trimmed) return { rows: [], scriptError: null };
    let run: (feature: GeoJSON.Feature) => PropertyRecord;
    try {
      run = compileScript(script);
    } catch (err) {
      return { rows: [], scriptError: err instanceof Error ? err.message : "Invalid script" };
    }
    const rows = features.map((feature): PreviewRow => {
      const before = (feature.properties ?? {}) as PropertyRecord;
      try {
        const after = run(feature);
        return {
          feature,
          before,
          after,
          changed: !recordsEqual(before, after),
          removed: false,
          error: null,
        };
      } catch (err) {
        return {
          feature,
          before,
          after: null,
          changed: false,
          removed: false,
          error: err instanceof Error ? err.message : "Script failed",
        };
      }
    });
    return { rows, scriptError: null };
  }, [
    mode,
    features,
    setKey,
    setValue,
    replaceScope,
    pattern,
    replacement,
    caseInsensitive,
    script,
    removeKey,
    removeCondition,
    removeValue,
  ]);

  const changedRows = preview.rows.filter((row) => row.changed);
  const erroredRows = preview.rows.filter((row) => row.error);
  const canApply = changedRows.length > 0 && !preview.scriptError;

  function handleApply() {
    const updates = new Map<GeoJSON.Feature, PropertyRecord>();
    const removals = new Set<GeoJSON.Feature>();
    for (const row of changedRows) {
      if (row.removed) removals.add(row.feature);
      else if (row.after) updates.set(row.feature, row.after);
    }
    onApply(updates, removals);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit {features.length} selected features</DialogTitle>
          <DialogDescription>
            Set a property, find &amp; replace across values, run a custom script, or remove
            features by a property value — then review the preview before applying.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={mode}
          onValueChange={(value) => setMode(value as Mode)}
          className="min-h-0 flex-1"
        >
          <TabsList className="w-full">
            <TabsTrigger value="set">Set value</TabsTrigger>
            <TabsTrigger value="replace">Find &amp; replace</TabsTrigger>
            <TabsTrigger value="script">Custom JS</TabsTrigger>
            <TabsTrigger value="remove">Remove</TabsTrigger>
          </TabsList>

          <TabsContent value="set" className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" htmlFor="bulk-edit-key">
                Property
              </label>
              <SearchableSelect
                id="bulk-edit-key"
                value={setKey}
                onValueChange={setSetKey}
                options={existingKeys.map((key) => ({ value: key, label: key }))}
                placeholder="Choose or type a property…"
                searchPlaceholder="Search or type a new property…"
                allowCustom
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" htmlFor="bulk-edit-value">
                Value
              </label>
              <Input
                id="bulk-edit-value"
                value={setValue}
                onChange={(e) => setSetValue(e.target.value)}
              />
            </div>
          </TabsContent>

          <TabsContent value="replace" className="flex flex-col gap-3">
            <PresetBar
              idPrefix="bulk-replace"
              names={Object.keys(savedPresets.replace)}
              canSave={pattern !== ""}
              onLoad={(name) => {
                const preset = savedPresets.replace[name];
                if (!preset) return;
                setPattern(preset.pattern);
                setReplacement(preset.replacement);
                setCaseInsensitive(preset.caseInsensitive);
              }}
              onSave={(name) =>
                updateSavedPresets({
                  ...savedPresets,
                  replace: {
                    ...savedPresets.replace,
                    [name]: { pattern, replacement, caseInsensitive },
                  },
                })
              }
              onDelete={(name) =>
                updateSavedPresets({
                  ...savedPresets,
                  replace: withoutKey(savedPresets.replace, name),
                })
              }
            />
            <AskClaude
              idPrefix="bulk-replace"
              mode="replace"
              features={features}
              scopeKey={replaceScope === ALL_KEYS_SCOPE ? null : replaceScope}
              placeholder="e.g. strip leading zeros from house numbers"
              onSuggestion={(suggestion) => {
                if (typeof suggestion.pattern === "string") setPattern(suggestion.pattern);
                if (typeof suggestion.replacement === "string")
                  setReplacement(suggestion.replacement);
                if (typeof suggestion.caseInsensitive === "boolean")
                  setCaseInsensitive(suggestion.caseInsensitive);
              }}
            />
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium" htmlFor="bulk-replace-scope">
                Property
              </label>
              <SearchableSelect
                id="bulk-replace-scope"
                value={replaceScope}
                onValueChange={setReplaceScope}
                options={[
                  { value: ALL_KEYS_SCOPE, label: "All properties" },
                  ...existingKeys.map((key) => ({ value: key, label: key })),
                ]}
                searchPlaceholder="Search properties…"
              />
            </div>
            <div className="flex gap-3">
              <div className="flex flex-1 flex-col gap-1.5">
                <label className="text-sm font-medium" htmlFor="bulk-replace-pattern">
                  Find (regular expression)
                </label>
                <Input
                  id="bulk-replace-pattern"
                  value={pattern}
                  onChange={(e) => setPattern(e.target.value)}
                  placeholder="e.g. ^0+(\d)"
                  className="font-mono"
                />
              </div>
              <div className="flex flex-1 flex-col gap-1.5">
                <label className="text-sm font-medium" htmlFor="bulk-replace-replacement">
                  Replace with
                </label>
                <Input
                  id="bulk-replace-replacement"
                  value={replacement}
                  onChange={(e) => setReplacement(e.target.value)}
                  placeholder="$1"
                  className="font-mono"
                />
              </div>
            </div>
            <label
              htmlFor="bulk-replace-case-insensitive"
              className="flex items-center gap-2 text-sm"
            >
              <Checkbox
                id="bulk-replace-case-insensitive"
                checked={caseInsensitive}
                onCheckedChange={(checked) => setCaseInsensitive(checked === true)}
              />
              Case-insensitive
            </label>
          </TabsContent>

          <TabsContent value="script" className="flex flex-col gap-2">
            <PresetBar
              idPrefix="bulk-script"
              names={Object.keys(savedPresets.script)}
              predefinedNames={Object.keys(PREDEFINED_SCRIPTS)}
              canSave={script.trim() !== ""}
              onLoad={(name, predefined) => {
                const saved = (predefined ? PREDEFINED_SCRIPTS : savedPresets.script)[name];
                if (saved !== undefined) setScript(saved);
              }}
              onSave={(name) =>
                updateSavedPresets({
                  ...savedPresets,
                  script: { ...savedPresets.script, [name]: script },
                })
              }
              onDelete={(name) =>
                updateSavedPresets({
                  ...savedPresets,
                  script: withoutKey(savedPresets.script, name),
                })
              }
            />
            <AskClaude
              idPrefix="bulk-script"
              mode="script"
              features={features}
              scopeKey={null}
              placeholder="e.g. combine street and number into an address property"
              onSuggestion={(suggestion) => {
                if (typeof suggestion.script === "string") setScript(suggestion.script);
              }}
            />
            <label className="text-sm font-medium" htmlFor="bulk-script">
              Script body — receives <code>props</code> and <code>feature</code>, must{" "}
              <code>return</code> the new properties object
            </label>
            <Textarea
              id="bulk-script"
              value={script}
              onChange={(e) => setScript(e.target.value)}
              placeholder={
                'return { ...props, name: String(props.name ?? "").trim().toUpperCase() }'
              }
              className="min-h-28 font-mono text-sm"
              spellCheck={false}
            />
          </TabsContent>

          <TabsContent value="remove" className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Remove the selected features whose property matches the condition.
            </p>
            <div className="flex gap-3">
              <div className="flex flex-1 flex-col gap-1.5">
                <label className="text-sm font-medium" htmlFor="bulk-remove-key">
                  Property
                </label>
                <SearchableSelect
                  id="bulk-remove-key"
                  value={removeKey}
                  onValueChange={setRemoveKey}
                  options={existingKeys.map((key) => ({ value: key, label: key }))}
                  placeholder="Choose property…"
                  searchPlaceholder="Search properties…"
                />
              </div>
              <div className="flex flex-1 flex-col gap-1.5">
                <label className="text-sm font-medium" htmlFor="bulk-remove-condition">
                  Condition
                </label>
                <SearchableSelect
                  id="bulk-remove-condition"
                  value={removeCondition}
                  onValueChange={(value) => setRemoveCondition(value as RemoveCondition)}
                  options={REMOVE_CONDITIONS.map(({ value, label }) => ({ value, label }))}
                  searchPlaceholder="Search conditions…"
                />
              </div>
            </div>
            {removeNeedsValue && (
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium" htmlFor="bulk-remove-value">
                  Value
                </label>
                <Input
                  id="bulk-remove-value"
                  value={removeValue}
                  onChange={(e) => setRemoveValue(e.target.value)}
                  className={removeCondition === "regex" ? "font-mono" : undefined}
                />
              </div>
            )}
          </TabsContent>
        </Tabs>

        <div className="flex min-h-0 flex-1 flex-col gap-2 border-t pt-3">
          {preview.scriptError ? (
            <p className="text-sm text-destructive">{preview.scriptError}</p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {changedRows.length} of {features.length} features will{" "}
                {mode === "remove" ? "be removed" : "change"}
                {erroredRows.length > 0 ? `, ${erroredRows.length} errored` : ""}
              </p>
              <div className="flex-1 overflow-y-auto rounded-md border">
                {changedRows.length === 0 && erroredRows.length === 0 ? (
                  <p className="p-3 text-sm text-muted-foreground">
                    No changes yet — fill in the fields above to see a preview.
                  </p>
                ) : (
                  <ul className="divide-y">
                    {[
                      ...changedRows.slice(0, PREVIEW_SAMPLE_SIZE),
                      ...erroredRows.slice(0, PREVIEW_SAMPLE_SIZE),
                    ].map((row, index) => (
                      <li key={index} className="p-2 text-xs">
                        {row.error ? (
                          <span className="text-destructive">{row.error}</span>
                        ) : row.removed ? (
                          <RemovedLine properties={row.before} highlightKey={removeKey} />
                        ) : (
                          <DiffLine before={row.before} after={row.after} />
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {changedRows.length > PREVIEW_SAMPLE_SIZE && (
                <p className="text-xs text-muted-foreground">
                  + {changedRows.length - PREVIEW_SAMPLE_SIZE} more
                </p>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={mode === "remove" ? "destructive" : "default"}
            disabled={!canApply}
            onClick={handleApply}
          >
            {mode === "remove" ? "Remove" : "Apply to"} {changedRows.length}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface AskClaudeProps {
  idPrefix: string;
  mode: "replace" | "script";
  features: GeoJSON.Feature[];
  scopeKey: string | null;
  placeholder: string;
  onSuggestion: (suggestion: Record<string, unknown>) => void;
}

// Sends a plain-language instruction plus a few sample rows to /api/suggest-edit
// and fills the tab's fields with what comes back. Nothing is applied — the
// suggestion lands in the normal preview for the user to check first.
function AskClaude({
  idPrefix,
  mode,
  features,
  scopeKey,
  placeholder,
  onSuggestion,
}: AskClaudeProps) {
  const [instruction, setInstruction] = useState("");
  const [loading, setLoading] = useState(false);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAsk() {
    setLoading(true);
    setError(null);
    setExplanation(null);
    try {
      const response = await fetch("/api/suggest-edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          instruction,
          scopeKey,
          samples: features.slice(0, CLAUDE_SAMPLE_SIZE).map((f) => f.properties ?? {}),
        }),
      });
      const body = (await response.json()) as Record<string, unknown>;
      if (!response.ok) {
        setError(typeof body.error === "string" ? body.error : "Claude request failed.");
        return;
      }
      onSuggestion(body);
      if (typeof body.explanation === "string") setExplanation(body.explanation);
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setLoading(false);
    }
  }

  const canAsk = instruction.trim() !== "" && !loading;

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium" htmlFor={`${idPrefix}-ask`}>
        Ask Claude
      </label>
      <div className="flex gap-2">
        <Input
          id={`${idPrefix}-ask`}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canAsk) {
              e.preventDefault();
              void handleAsk();
            }
          }}
          placeholder={placeholder}
        />
        <Button type="button" variant="outline" disabled={!canAsk} onClick={handleAsk}>
          {loading ? <Loader2 className="animate-spin" /> : <Sparkles />}
          Generate
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {explanation && <p className="text-xs text-muted-foreground">{explanation}</p>}
    </div>
  );
}

interface PresetBarProps {
  idPrefix: string;
  names: string[];
  // Built-in presets: listed first, loadable but not deletable.
  predefinedNames?: string[];
  canSave: boolean;
  onLoad: (name: string, predefined: boolean) => void;
  onSave: (name: string) => void;
  onDelete: (name: string) => void;
}

// Load / save-as / delete row for named presets. Loading a preset also fills
// the name field, so tweaking and re-saving updates it in place.
// Select values for predefined presets carry this prefix so they can't clash
// with a user preset saved under the same name.
const PREDEFINED_VALUE_PREFIX = "predefined:";

function PresetBar({
  idPrefix,
  names,
  predefinedNames = [],
  canSave,
  onLoad,
  onSave,
  onDelete,
}: PresetBarProps) {
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const trimmedName = name.trim();
  const sortedNames = [...names].sort((a, b) => a.localeCompare(b));
  const hasAny = sortedNames.length > 0 || predefinedNames.length > 0;
  const selectedIsPredefined = selected.startsWith(PREDEFINED_VALUE_PREFIX);

  return (
    <div className="flex items-end gap-2">
      <div className="flex flex-1 flex-col gap-1.5">
        <label className="text-sm font-medium" htmlFor={`${idPrefix}-preset`}>
          Saved
        </label>
        <SearchableSelect
          id={`${idPrefix}-preset`}
          value={selected}
          onValueChange={(value) => {
            const predefined = value.startsWith(PREDEFINED_VALUE_PREFIX);
            const presetName = predefined ? value.slice(PREDEFINED_VALUE_PREFIX.length) : value;
            setSelected(value);
            setName(presetName);
            onLoad(presetName, predefined);
          }}
          groups={[
            {
              heading: "Predefined",
              options: predefinedNames.map((presetName) => ({
                value: PREDEFINED_VALUE_PREFIX + presetName,
                label: presetName,
              })),
            },
            {
              heading: predefinedNames.length > 0 ? "Saved" : undefined,
              options: sortedNames.map((presetName) => ({ value: presetName, label: presetName })),
            },
          ]}
          placeholder={hasAny ? "Load saved…" : "Nothing saved yet"}
          searchPlaceholder="Search saved…"
          disabled={!hasAny}
        />
      </div>
      <Button
        type="button"
        variant="outline"
        size="icon"
        aria-label="Delete saved"
        disabled={!selected || selectedIsPredefined}
        onClick={() => {
          onDelete(selected);
          setSelected("");
        }}
      >
        <Trash2 />
      </Button>
      <Input
        aria-label="Name to save as"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Short name"
        className="w-40"
      />
      <Button
        type="button"
        variant="outline"
        disabled={!trimmedName || !canSave}
        onClick={() => {
          onSave(trimmedName);
          setSelected(trimmedName);
        }}
      >
        {names.includes(trimmedName) ? "Update" : "Save"}
      </Button>
    </div>
  );
}

function DiffLine({ before, after }: { before: PropertyRecord; after: PropertyRecord | null }) {
  if (!after) return null;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changedKeys = [...keys].filter((key) => before[key] !== after[key]);
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono">
      {changedKeys.map((key) => (
        <span key={key}>
          <span className="text-muted-foreground">{key}:</span>{" "}
          <span className="text-destructive line-through">
            {propertyValueToInputString(before[key])}
          </span>{" "}
          →{" "}
          <span className="text-emerald-600 dark:text-emerald-400">
            {propertyValueToInputString(after[key])}
          </span>
        </span>
      ))}
    </div>
  );
}

function RemovedLine({
  properties,
  highlightKey,
}: {
  properties: PropertyRecord;
  highlightKey: string;
}) {
  const others = Object.entries(properties).filter(([key]) => key !== highlightKey);
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-destructive line-through">
      <span>
        {highlightKey}: {propertyValueToInputString(properties[highlightKey]) || "∅"}
      </span>
      {others.slice(0, 3).map(([key, value]) => (
        <span key={key} className="text-muted-foreground">
          {key}: {propertyValueToInputString(value)}
        </span>
      ))}
    </div>
  );
}
