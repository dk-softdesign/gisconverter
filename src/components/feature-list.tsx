import { useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Pencil } from "lucide-react";

import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";

interface FeatureListProps {
  featureCollection: GeoJSON.FeatureCollection;
  selectedFeatures: Set<GeoJSON.Feature>;
  onToggleFeature: (feature: GeoJSON.Feature) => void;
  onToggleAll: () => void;
  onEditFeature: (feature: GeoJSON.Feature) => void;
}

interface Column {
  key: string;
  label: string;
  width: number;
}

const ROW_HEIGHT = 36;
const CHECKBOX_COLUMN: Column = { key: "__checkbox", label: "", width: 40 };
const ACTIONS_COLUMN: Column = { key: "__actions", label: "", width: 48 };
const INDEX_COLUMN: Column = { key: "__index", label: "#", width: 56 };
const GEOMETRY_COLUMN: Column = { key: "__geometryType", label: "Geometry", width: 110 };
const PROPERTY_COLUMN_WIDTH = 180;

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

export function FeatureList({
  featureCollection,
  selectedFeatures,
  onToggleFeature,
  onToggleAll,
  onEditFeature,
}: FeatureListProps) {
  const features = featureCollection.features;

  const columns = useMemo<Column[]>(() => {
    const keys = new Set<string>();
    for (const feature of features) {
      for (const key of Object.keys(feature.properties ?? {})) keys.add(key);
    }
    return [
      CHECKBOX_COLUMN,
      ACTIONS_COLUMN,
      INDEX_COLUMN,
      GEOMETRY_COLUMN,
      ...[...keys].map((key) => ({ key, label: key, width: PROPERTY_COLUMN_WIDTH })),
    ];
  }, [features]);

  const totalWidth = useMemo(() => columns.reduce((sum, col) => sum + col.width, 0), [columns]);

  const allSelected = features.length > 0 && features.every((f) => selectedFeatures.has(f));
  const someSelected = !allSelected && features.some((f) => selectedFeatures.has(f));

  const parentRef = useRef<HTMLDivElement>(null);
  // react-virtual's documented pattern: getScrollElement reads ref.current
  // lazily on each scroll/render, not once at hook-call time, so it can't be
  // pre-resolved to a stable value the way React Compiler would prefer.
  // oxlint-disable-next-line react/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: features.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  return (
    <div ref={parentRef} className="thin-scrollbar h-125 overflow-auto rounded-lg border">
      <div style={{ width: totalWidth, minWidth: "100%" }}>
        <div className="sticky top-0 z-10 flex border-b bg-card">
          {columns.map((column) => (
            <div
              key={column.key}
              className="flex shrink-0 items-center truncate border-r px-3 py-2 text-xs font-medium text-muted-foreground last:border-r-0"
              style={{ width: column.width }}
            >
              {column.key === "__checkbox" ? (
                <Checkbox
                  checked={someSelected ? "indeterminate" : allSelected}
                  onCheckedChange={onToggleAll}
                  aria-label="Select all features"
                />
              ) : (
                column.label
              )}
            </div>
          ))}
        </div>
        <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const feature = features[virtualRow.index];
            if (!feature) return null;
            const properties = feature.properties ?? {};
            const isSelected = selectedFeatures.has(feature);
            return (
              <div
                key={virtualRow.key}
                className="absolute top-0 left-0 flex w-full border-b last:border-b-0 hover:bg-accent/50"
                style={{ height: virtualRow.size, transform: `translateY(${virtualRow.start}px)` }}
              >
                {columns.map((column) => (
                  <div
                    key={column.key}
                    className="flex shrink-0 items-center truncate border-r px-3 text-sm last:border-r-0"
                    style={{ width: column.width }}
                  >
                    {column.key === "__checkbox" ? (
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => onToggleFeature(feature)}
                        aria-label={`Select row ${virtualRow.index + 1}`}
                      />
                    ) : column.key === "__actions" ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        onClick={() => onEditFeature(feature)}
                        aria-label={`Edit row ${virtualRow.index + 1}`}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                    ) : column.key === "__index" ? (
                      virtualRow.index + 1
                    ) : column.key === "__geometryType" ? (
                      feature.geometry.type
                    ) : (
                      formatCellValue(properties[column.key])
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
