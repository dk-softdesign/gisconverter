// oxlint-disable typescript/no-base-to-string
import { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Pencil, Trash2, Undo2 } from "lucide-react";

import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { Input } from "#/components/ui/input";
import { cn } from "#/lib/utils";

interface FeatureListProps {
  featureCollection: GeoJSON.FeatureCollection;
  selectedFeatures: Set<GeoJSON.Feature>;
  onToggleFeature: (feature: GeoJSON.Feature) => void;
  onToggleAll: () => void;
  onEditFeature: (feature: GeoJSON.Feature) => void;
  // Column changes staged by the parent (key → new name, or null to delete) —
  // only shown here; the data changes when the parent applies them.
  pendingColumnChanges: Record<string, string | null>;
  // undefined clears the staged change for that key.
  onPendingColumnChange: (key: string, change: string | null | undefined) => void;
  columnRenameError: (key: string, name: string) => string | null;
}

interface Column {
  key: string;
  label: string;
  width: number;
  isProperty?: boolean;
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
  pendingColumnChanges,
  onPendingColumnChange,
  columnRenameError,
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
      ...[...keys].map((key) => ({
        key,
        label: key,
        width: PROPERTY_COLUMN_WIDTH,
        isProperty: true,
      })),
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
    <div ref={parentRef} className="thin-scrollbar min-h-0 flex-1 overflow-auto rounded-lg border">
      <div style={{ width: totalWidth, minWidth: "100%" }}>
        <div className="sticky top-0 z-10 flex border-b bg-card">
          {columns.map((column) =>
            column.isProperty ? (
              <PropertyColumnHeader
                key={column.key}
                propertyKey={column.key}
                width={column.width}
                change={pendingColumnChanges[column.key]}
                onChange={(change) => onPendingColumnChange(column.key, change)}
                renameError={(name) => columnRenameError(column.key, name)}
              />
            ) : (
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
            ),
          )}
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
                    className={cn(
                      "flex shrink-0 items-center truncate border-r px-3 text-sm last:border-r-0",
                      column.isProperty &&
                        pendingColumnChanges[column.key] === null &&
                        "bg-destructive/5 text-muted-foreground line-through",
                    )}
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
                      (feature.geometry?.type ?? "None")
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

interface PropertyColumnHeaderProps {
  propertyKey: string;
  width: number;
  // undefined: unchanged, null: staged for deletion, string: staged rename.
  change: string | null | undefined;
  onChange: (change: string | null | undefined) => void;
  renameError: (name: string) => string | null;
}

function PropertyColumnHeader({
  propertyKey,
  width,
  change,
  onChange,
  renameError,
}: PropertyColumnHeaderProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const deleted = change === null;
  const renamed = typeof change === "string";
  const draftError = draft === null ? null : renameError(draft.trim());
  const editing = draft !== null;
  const inputRef = useRef<HTMLInputElement>(null);
  // Set by Escape, so a blur fired as the input unmounts can't commit the
  // abandoned draft.
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!editing) return;
    cancelledRef.current = false;
    inputRef.current?.select();
  }, [editing]);

  function commitDraft() {
    if (draft === null || draftError) return;
    onChange(draft.trim());
    setDraft(null);
  }

  return (
    <div
      className={cn(
        "group flex shrink-0 items-center gap-1 border-r px-3 py-2 text-xs font-medium text-muted-foreground last:border-r-0",
        deleted && "bg-destructive/10 text-destructive",
        renamed && "bg-primary/5 text-foreground",
        draft !== null && "px-1.5 py-1",
      )}
      style={{ width }}
    >
      {draft !== null ? (
        <Input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitDraft();
            if (e.key === "Escape") {
              cancelledRef.current = true;
              setDraft(null);
            }
          }}
          // Leaving the field keeps a valid name and drops an invalid one,
          // rather than trapping focus in the header.
          onBlur={() => {
            if (cancelledRef.current) return;
            if (draftError) setDraft(null);
            else commitDraft();
          }}
          aria-label={`New name for property ${propertyKey}`}
          aria-invalid={draftError !== null}
          title={draftError ?? "Enter to stage the rename, Escape to cancel"}
          className="h-7 text-xs"
        />
      ) : (
        <>
          <span
            className={cn("flex-1 truncate", deleted && "line-through")}
            title={renamed ? `${propertyKey} → ${change}` : propertyKey}
            onDoubleClick={() => !deleted && setDraft(change ?? propertyKey)}
          >
            {renamed ? (
              <>
                <span className="text-muted-foreground line-through">{propertyKey}</span> {change}
              </>
            ) : (
              propertyKey
            )}
          </span>
          {change !== undefined ? (
            <HeaderButton
              label={`Undo pending change to ${propertyKey}`}
              title="Undo this pending change"
              visible
              onClick={() => onChange(undefined)}
            >
              <Undo2 className="size-3.5" />
            </HeaderButton>
          ) : (
            <>
              <HeaderButton
                label={`Rename property ${propertyKey}`}
                title="Rename"
                onClick={() => setDraft(propertyKey)}
              >
                <Pencil className="size-3.5" />
              </HeaderButton>
              <HeaderButton
                label={`Mark property ${propertyKey} for deletion`}
                title="Mark for deletion"
                className="hover:text-destructive"
                onClick={() => onChange(null)}
              >
                <Trash2 className="size-3.5" />
              </HeaderButton>
            </>
          )}
        </>
      )}
    </div>
  );
}

function HeaderButton({
  label,
  title,
  visible = false,
  className,
  onClick,
  children,
}: {
  label: string;
  title: string;
  visible?: boolean;
  className?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn(
        "size-6 shrink-0",
        !visible && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
        className,
      )}
      onClick={onClick}
      aria-label={label}
      title={title}
    >
      {children}
    </Button>
  );
}
