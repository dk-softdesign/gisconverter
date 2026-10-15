import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  ListChecks,
  Loader2,
  MapPin,
  Trash2,
  XCircle,
} from "lucide-react";

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
  parseSavedMapping,
  PropertyMappingDialog,
  savedMappingKey,
  type SavedMapping,
} from "#/components/property-mapping-dialog";
import { getUserDataFn } from "#/lib/auth-functions";
import { SearchableSelect } from "#/components/searchable-select";
import { getLayerColor } from "#/lib/layer-colors";
import { getSchemaEntry, schemaRegistry } from "#/lib/gis-schemas";
import {
  INTERNAL_PROPERTY_KEYS,
  summarizeValidation,
  GEOMETRY_DUPLICATE_KEY,
  type FeatureValidationResult,
  type ValidationIssue,
  type ValidationIssueKind,
} from "#/lib/schema-validation";
import { cn } from "#/lib/utils";

const NO_SCHEMA = "__none__";
const NO_DUPLICATE_KEY = "__none__";
const ISSUE_DISPLAY_LIMIT = 50;

// Filter values for the issue list: everything, errors only, or one kind.
type IssueFilter = "all" | "errors" | ValidationIssueKind;

const ISSUE_KIND_LABEL: Record<ValidationIssueKind, string> = {
  required: "Missing required property",
  type: "Wrong type",
  enum: "Not an allowed value",
  format: "Wrong format",
  conditional: "Conditional rule",
  unrecognized: "Unknown property",
  duplicate: "Duplicate value",
  other: "Other",
};

function issueMatches(issue: ValidationIssue, filter: IssueFilter): boolean {
  if (filter === "all") return true;
  if (filter === "errors") return issue.severity === "error";
  return issue.kind === filter;
}

// Keeps the features with at least one matching issue, and only those issues.
function filterResults(
  results: FeatureValidationResult[],
  filter: IssueFilter,
): FeatureValidationResult[] {
  if (filter === "all") return results;
  return results
    .map((result) => ({
      ...result,
      issues: result.issues.filter((issue) => issueMatches(issue, filter)),
    }))
    .filter((result) => result.issues.length > 0);
}

interface SchemaValidationPanelProps {
  layers: string[];
  featuresByLayer: Record<string, GeoJSON.Feature[]>;
  // Per layer; null when nothing is being checked on that layer.
  validationByLayer: Record<string, FeatureValidationResult[] | null>;
  layerSchemaIds: Record<string, string | null>;
  onLayerSchemaChange: (layer: string, schemaId: string | null) => void;
  layerDuplicateKeys: Record<string, string | null>;
  onLayerDuplicateKeyChange: (layer: string, key: string | null) => void;
  onEditFeature: (feature: GeoJSON.Feature) => void;
  onDeleteFeature: (feature: GeoJSON.Feature) => void;
  onSelectFeatures: (features: GeoJSON.Feature[]) => void;
  onShowOnMap: (feature: GeoJSON.Feature) => void;
  onApplyRename: (layer: string, renameMap: Record<string, string>) => void;
}

export function SchemaValidationPanel({
  layers,
  featuresByLayer,
  validationByLayer,
  layerSchemaIds,
  onLayerSchemaChange,
  layerDuplicateKeys,
  onLayerDuplicateKeyChange,
  onEditFeature,
  onDeleteFeature,
  onSelectFeatures,
  onShowOnMap,
  onApplyRename,
}: SchemaValidationPanelProps) {
  const [mappingLayer, setMappingLayer] = useState<string | null>(null);
  const [mappingSessionId, setMappingSessionId] = useState(0);
  const [mappingSaved, setMappingSaved] = useState<SavedMapping | null>(null);

  // Saved progress lives on the member's account, so it's fetched first and
  // the dialog opens with it already in place.
  async function openMapping(layer: string) {
    const entry = getSchemaEntry(layerSchemaIds[layer]);
    let saved: SavedMapping | null = null;
    if (entry) {
      try {
        const { value } = await getUserDataFn({ data: { key: savedMappingKey(entry.id, layer) } });
        saved = parseSavedMapping(value);
      } catch {
        toast.error("Couldn't load your saved progress — starting from the suggestions.");
      }
    }
    setMappingSaved(saved);
    setMappingLayer(layer);
    setMappingSessionId((id) => id + 1);
  }

  const mappingSchemaEntry = mappingLayer
    ? getSchemaEntry(layerSchemaIds[mappingLayer])
    : undefined;
  const mappingFeatures = useMemo(
    () => (mappingLayer ? (featuresByLayer[mappingLayer] ?? []) : []),
    [mappingLayer, featuresByLayer],
  );
  const mappingSourceKeys = useMemo(
    () =>
      [...new Set(mappingFeatures.flatMap((f) => Object.keys(f.properties ?? {})))]
        .filter((key) => !INTERNAL_PROPERTY_KEYS.has(key))
        .sort(),
    [mappingFeatures],
  );

  return (
    <div className="flex flex-col gap-4">
      {layers.length === 0 && (
        <p className="text-sm text-muted-foreground">No features to validate.</p>
      )}
      {layers.map((layer) => (
        <LayerValidationSection
          key={layer}
          layer={layer}
          features={featuresByLayer[layer] ?? []}
          results={validationByLayer[layer] ?? null}
          schemaId={layerSchemaIds[layer] ?? null}
          onSchemaChange={(id) => onLayerSchemaChange(layer, id)}
          duplicateKey={layerDuplicateKeys[layer] ?? null}
          onDuplicateKeyChange={(key) => onLayerDuplicateKeyChange(layer, key)}
          onEditFeature={onEditFeature}
          onDeleteFeature={onDeleteFeature}
          onSelectFeatures={onSelectFeatures}
          onShowOnMap={onShowOnMap}
          onOpenMapping={() => openMapping(layer)}
        />
      ))}
      {mappingLayer && mappingSchemaEntry && (
        <PropertyMappingDialog
          key={mappingSessionId}
          open
          onOpenChange={(open) => {
            if (!open) setMappingLayer(null);
          }}
          layerLabel={mappingLayer}
          schemaLabel={mappingSchemaEntry.label}
          schemaId={mappingSchemaEntry.id}
          schema={mappingSchemaEntry.schema}
          sourceKeys={mappingSourceKeys}
          features={mappingFeatures}
          saved={mappingSaved}
          onApply={(renameMap) => {
            onApplyRename(mappingLayer, renameMap);
            setMappingLayer(null);
          }}
        />
      )}
    </div>
  );
}

interface LayerValidationSectionProps {
  layer: string;
  features: GeoJSON.Feature[];
  results: FeatureValidationResult[] | null;
  schemaId: string | null;
  onSchemaChange: (schemaId: string | null) => void;
  duplicateKey: string | null;
  onDuplicateKeyChange: (key: string | null) => void;
  onEditFeature: (feature: GeoJSON.Feature) => void;
  onDeleteFeature: (feature: GeoJSON.Feature) => void;
  onSelectFeatures: (features: GeoJSON.Feature[]) => void;
  onShowOnMap: (feature: GeoJSON.Feature) => void;
  onOpenMapping: () => void;
}

function LayerValidationSection({
  layer,
  features,
  results,
  schemaId,
  onSchemaChange,
  duplicateKey,
  onDuplicateKeyChange,
  onEditFeature,
  onDeleteFeature,
  onSelectFeatures,
  onShowOnMap,
  onOpenMapping,
}: LayerValidationSectionProps) {
  const [issueFilter, setIssueFilter] = useState<IssueFilter>("all");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // exceljs is only needed here, so it's loaded on first export.
  async function exportDuplicates(key: string) {
    setExporting(true);
    setExportError(null);
    try {
      const { duplicatesToExcel } = await import("#/lib/duplicates-to-excel");
      const blob = await duplicatesToExcel(layer, features, key);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const keyName = key === GEOMETRY_DUPLICATE_KEY ? "geometry" : key;
      link.download = `${layer}-duplicates-${keyName}.xlsx`.replace(/[\\/:*?"<>|]/g, "_");
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  }
  const schemaEntry = getSchemaEntry(schemaId);

  const propertyKeys = useMemo(
    () =>
      [...new Set(features.flatMap((f) => Object.keys(f.properties ?? {})))]
        .filter((key) => !INTERNAL_PROPERTY_KEYS.has(key))
        .sort(),
    [features],
  );

  const summary = results ? summarizeValidation(features.length, results) : null;
  const duplicateFeatureCount = (results ?? []).filter((result) =>
    result.issues.some((issue) => issue.kind === "duplicate"),
  ).length;

  // Filter options only list the kinds actually present, with how many
  // features each one affects.
  const filterOptions = useMemo(() => {
    const kindCounts = new Map<ValidationIssueKind, number>();
    let errorCount = 0;
    for (const result of results ?? []) {
      if (result.issues.some((issue) => issue.severity === "error")) errorCount++;
      for (const kind of new Set(result.issues.map((issue) => issue.kind))) {
        kindCounts.set(kind, (kindCounts.get(kind) ?? 0) + 1);
      }
    }
    return [
      { value: "all", label: `All issues (${results?.length ?? 0})` },
      { value: "errors", label: `Errors only (${errorCount})` },
      ...[...kindCounts].map(([kind, count]) => ({
        value: kind,
        label: `${ISSUE_KIND_LABEL[kind]} (${count})`,
      })),
    ];
  }, [results]);
  // Falls back to "all" if the picked kind no longer occurs (e.g. all fixed).
  const activeFilter = filterOptions.some((option) => option.value === issueFilter)
    ? issueFilter
    : "all";
  const shownResults = useMemo(
    () => filterResults(results ?? [], activeFilter),
    [results, activeFilter],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <span
            className="size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: getLayerColor(layer) }}
          />
          {layer}
        </CardTitle>
        <CardDescription>
          {features.length} feature{features.length === 1 ? "" : "s"}
        </CardDescription>
        <CardAction className="flex flex-wrap justify-end gap-2">
          <SearchableSelect
            className="w-56"
            aria-label="Check duplicates on"
            value={duplicateKey ?? NO_DUPLICATE_KEY}
            onValueChange={(value) =>
              onDuplicateKeyChange(value === NO_DUPLICATE_KEY ? null : value)
            }
            options={[
              { value: NO_DUPLICATE_KEY, label: "No duplicate check" },
              { value: GEOMETRY_DUPLICATE_KEY, label: "Geometry", keywords: ["geometry", "geom"] },
              ...propertyKeys.map((key) => ({
                value: key,
                label: key,
                keywords: [key],
              })),
            ]}
            searchPlaceholder="Search properties…"
          />
          <SearchableSelect
            className="w-56"
            aria-label="Schema"
            value={schemaId ?? NO_SCHEMA}
            onValueChange={(value) => onSchemaChange(value === NO_SCHEMA ? null : value)}
            options={[
              { value: NO_SCHEMA, label: "No schema" },
              ...schemaRegistry.map((entry) => ({
                value: entry.id,
                label: entry.label,
                keywords: [entry.id],
              })),
            ]}
            searchPlaceholder="Search schemas…"
          />
        </CardAction>
      </CardHeader>

      {summary && (
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="size-4" /> {summary.validFeatures} valid
            </span>
            {summary.featuresWithErrors > 0 && (
              <span className="flex items-center gap-1.5 text-destructive">
                <XCircle className="size-4" /> {summary.featuresWithErrors} with errors
              </span>
            )}
            {summary.featuresWithWarnings > 0 && (
              <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="size-4" /> {summary.featuresWithWarnings} with warnings
                only
              </span>
            )}
            {duplicateKey && (
              <span className="text-muted-foreground">
                {duplicateFeatureCount} feature{duplicateFeatureCount === 1 ? "" : "s"} share a{" "}
                {duplicateKey === GEOMETRY_DUPLICATE_KEY ? "geometry" : `${duplicateKey} value`}
              </span>
            )}
            {duplicateKey && duplicateFeatureCount > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={exporting}
                onClick={() => void exportDuplicates(duplicateKey)}
              >
                {exporting ? <Loader2 className="animate-spin" /> : <Download />}
                Export duplicates (Excel)
              </Button>
            )}
            {exportError && <span className="text-destructive">Export failed: {exportError}</span>}
            {schemaEntry && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="ml-auto"
                onClick={onOpenMapping}
              >
                Match property names
              </Button>
            )}
          </div>

          {results && results.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <SearchableSelect
                className="w-64"
                aria-label="Filter issues"
                value={activeFilter}
                onValueChange={(value) => setIssueFilter(value as IssueFilter)}
                options={filterOptions}
                searchPlaceholder="Search issue kinds…"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={shownResults.length === 0}
                onClick={() =>
                  onSelectFeatures(
                    shownResults
                      .map((result) => features[result.featureIndex])
                      .filter((feature) => feature !== undefined),
                  )
                }
              >
                <ListChecks />
                Select {shownResults.length}
              </Button>
            </div>
          )}

          {shownResults.length > 0 && (
            <ul className="flex flex-col gap-2">
              {shownResults.slice(0, ISSUE_DISPLAY_LIMIT).map((result) => {
                const feature = features[result.featureIndex];
                if (!feature) return null;
                return (
                  <li
                    key={result.featureIndex}
                    className="flex items-start justify-between gap-3 rounded-lg border p-2.5 text-sm"
                  >
                    <div className="flex flex-col gap-1">
                      <span className="font-medium">Feature #{result.featureIndex + 1}</span>
                      <ul className="flex flex-col gap-0.5">
                        {result.issues.map((issue) => (
                          <li
                            key={`${issue.kind}:${issue.propertyKey}`}
                            className={cn(
                              issue.severity === "error"
                                ? "text-destructive"
                                : "text-amber-600 dark:text-amber-400",
                            )}
                          >
                            {issue.message}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Show feature #${result.featureIndex + 1} on map`}
                        title="Show on map"
                        onClick={() => onShowOnMap(feature)}
                      >
                        <MapPin />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onEditFeature(feature)}
                      >
                        Fix
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        aria-label={`Delete feature #${result.featureIndex + 1}`}
                        title="Delete feature"
                        onClick={() => onDeleteFeature(feature)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {shownResults.length > ISSUE_DISPLAY_LIMIT && (
            <p className="text-sm text-muted-foreground">
              +{shownResults.length - ISSUE_DISPLAY_LIMIT} more feature
              {shownResults.length - ISSUE_DISPLAY_LIMIT === 1 ? "" : "s"} with issues — use
              &quot;Select&quot; to work on all of them at once.
            </p>
          )}
        </CardContent>
      )}
    </Card>
  );
}
