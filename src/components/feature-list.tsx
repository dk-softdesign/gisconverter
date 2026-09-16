import { useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

interface FeatureListProps {
  featureCollection: GeoJSON.FeatureCollection;
}

interface Column {
  key: string;
  label: string;
  width: number;
}

const ROW_HEIGHT = 36;
const INDEX_COLUMN: Column = { key: "__index", label: "#", width: 56 };
const GEOMETRY_COLUMN: Column = { key: "__geometryType", label: "Geometry", width: 110 };
const PROPERTY_COLUMN_WIDTH = 180;

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

export function FeatureList({ featureCollection }: FeatureListProps) {
  const columns = useMemo<Column[]>(() => {
    const keys = new Set<string>();
    for (const feature of featureCollection.features) {
      for (const key of Object.keys(feature.properties ?? {})) keys.add(key);
    }
    return [
      INDEX_COLUMN,
      GEOMETRY_COLUMN,
      ...[...keys].map((key) => ({ key, label: key, width: PROPERTY_COLUMN_WIDTH })),
    ];
  }, [featureCollection]);

  const totalWidth = useMemo(() => columns.reduce((sum, col) => sum + col.width, 0), [columns]);

  const features = featureCollection.features;
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
    <div ref={parentRef} className="h-125 overflow-auto rounded-lg border">
      <div style={{ width: totalWidth, minWidth: "100%" }}>
        <div className="sticky top-0 z-10 flex border-b bg-card">
          {columns.map((column) => (
            <div
              key={column.key}
              className="shrink-0 truncate border-r px-3 py-2 text-xs font-medium text-muted-foreground last:border-r-0"
              style={{ width: column.width }}
            >
              {column.label}
            </div>
          ))}
        </div>
        <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const feature = features[virtualRow.index];
            if (!feature) return null;
            const properties = feature.properties ?? {};
            return (
              <div
                key={virtualRow.key}
                className="absolute top-0 left-0 flex w-full border-b last:border-b-0 hover:bg-accent/50"
                style={{ height: virtualRow.size, transform: `translateY(${virtualRow.start}px)` }}
              >
                {columns.map((column) => {
                  const value =
                    column.key === "__index"
                      ? virtualRow.index + 1
                      : column.key === "__geometryType"
                        ? feature.geometry.type
                        : formatCellValue(properties[column.key]);
                  return (
                    <div
                      key={column.key}
                      className="flex shrink-0 items-center truncate border-r px-3 text-sm last:border-r-0"
                      style={{ width: column.width }}
                    >
                      {value}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
