import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { PropertyMappingDialog } from "#/components/property-mapping-dialog";
import { getLayerColor, groupNameOf } from "#/lib/layer-colors";
import { getSchemaEntry, schemaRegistry } from "#/lib/gis-schemas";
import {
  INTERNAL_PROPERTY_KEYS,
  summarizeValidation,
  validateFeatureCollection,
  type FeatureValidationResult,
} from "#/lib/schema-validation";
import { cn } from "#/lib/utils";

const NO_SCHEMA = "__none__";
const ISSUE_DISPLAY_LIMIT = 50;

interface SchemaValidationPanelProps {
  featureCollection: GeoJSON.FeatureCollection;
  layers: string[];
  layerSchemaIds: Record<string, string | null>;
  onLayerSchemaChange: (layer: string, schemaId: string | null) => void;
  onEditFeature: (feature: GeoJSON.Feature) => void;
  onApplyRename: (layer: string, renameMap: Record<string, string>) => void;
}

export function SchemaValidationPanel({
  featureCollection,
  layers,
  layerSchemaIds,
  onLayerSchemaChange,
  onEditFeature,
  onApplyRename,
}: SchemaValidationPanelProps) {
  const [mappingLayer, setMappingLayer] = useState<string | null>(null);
  const [mappingSessionId, setMappingSessionId] = useState(0);

  const featuresByLayer = useMemo(() => {
    const map: Record<string, GeoJSON.Feature[]> = {};
    for (const layer of layers) map[layer] = [];
    for (const feature of featureCollection.features) {
      (map[groupNameOf(feature)] ??= []).push(feature);
    }
    return map;
  }, [featureCollection, layers]);

  function openMapping(layer: string) {
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
          schemaId={layerSchemaIds[layer] ?? null}
          onSchemaChange={(id) => onLayerSchemaChange(layer, id)}
          onEditFeature={onEditFeature}
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
          schema={mappingSchemaEntry.schema}
          sourceKeys={mappingSourceKeys}
          featureCount={mappingFeatures.length}
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
  schemaId: string | null;
  onSchemaChange: (schemaId: string | null) => void;
  onEditFeature: (feature: GeoJSON.Feature) => void;
  onOpenMapping: () => void;
}

function LayerValidationSection({
  layer,
  features,
  schemaId,
  onSchemaChange,
  onEditFeature,
  onOpenMapping,
}: LayerValidationSectionProps) {
  const schemaEntry = getSchemaEntry(schemaId);

  const results: FeatureValidationResult[] = useMemo(
    () =>
      schemaEntry
        ? validateFeatureCollection({ type: "FeatureCollection", features }, schemaEntry.schema)
        : [],
    [schemaEntry, features],
  );
  const summary = schemaEntry ? summarizeValidation(features.length, results) : null;

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
        <CardAction>
          <Select
            value={schemaId ?? NO_SCHEMA}
            onValueChange={(value) => onSchemaChange(value === NO_SCHEMA ? null : value)}
          >
            <SelectTrigger className="w-56">
              <SelectValue placeholder="No schema selected" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_SCHEMA}>No schema</SelectItem>
              {schemaRegistry.map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {entry.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>

      {schemaEntry && summary && (
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
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ml-auto"
              onClick={onOpenMapping}
            >
              Match property names
            </Button>
          </div>

          {results.length > 0 && (
            <ul className="flex flex-col gap-2">
              {results.slice(0, ISSUE_DISPLAY_LIMIT).map((result) => {
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
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onEditFeature(feature)}
                    >
                      Fix
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
          {results.length > ISSUE_DISPLAY_LIMIT && (
            <p className="text-sm text-muted-foreground">
              +{results.length - ISSUE_DISPLAY_LIMIT} more feature
              {results.length - ISSUE_DISPLAY_LIMIT === 1 ? "" : "s"} with issues.
            </p>
          )}
        </CardContent>
      )}
    </Card>
  );
}
