import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Loader2, Redo2, Undo2, UploadCloud, XCircle } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "#/components/ui/card";
import { BulkEditDialog } from "#/components/bulk-edit-dialog";
import { SearchableSelect } from "#/components/searchable-select";
import {
  CrsDetectionHint,
  commonCrsMatches,
  type CrsDetection,
  type FileCrsMatches,
} from "#/components/crs-detection-hint";
import { FeatureFilterBar, type PropertyFilter } from "#/components/feature-filter-bar";
import { FeatureList } from "#/components/feature-list";
import { GeoJsonMap } from "#/components/geojson-map";
import { LayerLegend } from "#/components/layer-legend";
import { PropertyEditDialog } from "#/components/property-edit-dialog";
import { SchemaValidationPanel } from "#/components/schema-validation-panel";
import { ThemeToggle } from "#/components/theme-toggle";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { collectFilesFromDataTransfer } from "#/lib/collect-files";
import { DEFAULT_SOURCE_CRS, SUPPORTED_SOURCE_CRS } from "#/lib/crs";
import { groupNameOf, ISSUE_COLORS } from "#/lib/layer-colors";
import type { PropertyRecord } from "#/lib/property-value";
import { getSchemaEntry } from "#/lib/gis-schemas";
import {
  validateLayer,
  worstSeverity,
  type FeatureValidationResult,
  type IssueSeverity,
} from "#/lib/schema-validation";
import { useUndoHistory } from "#/lib/undo-history";
import { cn } from "#/lib/utils";

// One toast slot for edit/undo notices, so a new change replaces the previous
// toast instead of stacking Undo buttons that would each undo the latest step.
const HISTORY_TOAST_ID = "edit-history";

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

// Ctrl/Cmd+Z inside a text field or a dialog belongs to that field/dialog,
// not to the app-level history.
function isOwnUndoContext(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.closest('[role="dialog"]')) return true;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

const SUPPORTED_EXTENSIONS = [".dxf", ".zip", ".xlsx", ".geojson", ".json", ".kml", ".kmz"];

function isSupportedFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((ext) => name.endsWith(ext));
}

export const Route = createFileRoute("/")({ component: Home });

interface ConvertResponse {
  featureCollection: GeoJSON.FeatureCollection;
  warnings: string[];
}

function stringifyPropertyValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

interface FileStatus {
  file: File;
  status: "pending" | "done" | "error";
  error?: string;
}

function Home() {
  const [files, setFiles] = useState<File[]>([]);
  const [fileStatuses, setFileStatuses] = useState<FileStatus[]>([]);
  const [sourceCrs, setSourceCrs] = useState(DEFAULT_SOURCE_CRS);
  const [crsDetection, setCrsDetection] = useState<CrsDetection | null>(null);
  const detectionRequestId = useRef(0);
  const [status, setStatus] = useState<"idle" | "converting" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  // Every change to the converted data goes through this history, so it can
  // be undone. `result` is the current version.
  const history = useUndoHistory<ConvertResponse | null>(null);
  const result = history.present;
  const [isDragging, setIsDragging] = useState(false);
  const [hiddenLayers, setHiddenLayers] = useState<Set<string>>(new Set());
  const [layerSchemaIds, setLayerSchemaIds] = useState<Record<string, string | null>>({});
  const [layerDuplicateKeys, setLayerDuplicateKeys] = useState<Record<string, string | null>>({});
  const [selectedFeatures, setSelectedFeatures] = useState<Set<GeoJSON.Feature>>(new Set());
  const [editingFeature, setEditingFeature] = useState<GeoJSON.Feature | null>(null);
  const [editSessionId, setEditSessionId] = useState(0);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkEditSessionId, setBulkEditSessionId] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [propertyFilters, setPropertyFilters] = useState<PropertyFilter[]>([]);
  const [isUploadCollapsed, setIsUploadCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState("map");
  const [highlightIssues, setHighlightIssues] = useState(true);
  const [focusFeature, setFocusFeature] = useState<GeoJSON.Feature | null>(null);
  // Bumps per conversion; the map only re-fits its view when this (or the
  // visible layers) change.
  const [conversionId, setConversionId] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextFilterId = useRef(0);

  const layers = useMemo(() => {
    if (!result) return [];
    return [...new Set(result.featureCollection.features.map((f) => groupNameOf(f)))].sort();
  }, [result]);

  const visibleFeatureCollection = useMemo((): GeoJSON.FeatureCollection => {
    if (!result) return { type: "FeatureCollection", features: [] };
    if (hiddenLayers.size === 0) return result.featureCollection;
    return {
      type: "FeatureCollection",
      features: result.featureCollection.features.filter((f) => !hiddenLayers.has(groupNameOf(f))),
    };
  }, [result, hiddenLayers]);

  const featuresByLayer = useMemo(() => {
    const map: Record<string, GeoJSON.Feature[]> = {};
    for (const layer of layers) map[layer] = [];
    for (const feature of result?.featureCollection.features ?? []) {
      (map[groupNameOf(feature)] ??= []).push(feature);
    }
    return map;
  }, [result, layers]);

  // Validation runs here, once, so the Validation tab and the map's issue
  // highlighting always agree. null for a layer with nothing to check.
  const validationByLayer = useMemo(() => {
    const byLayer: Record<string, FeatureValidationResult[] | null> = {};
    for (const layer of layers) {
      const schema = getSchemaEntry(layerSchemaIds[layer])?.schema;
      const duplicateKey = layerDuplicateKeys[layer] ?? null;
      byLayer[layer] =
        schema || duplicateKey
          ? validateLayer(featuresByLayer[layer] ?? [], schema, duplicateKey)
          : null;
    }
    return byLayer;
  }, [layers, featuresByLayer, layerSchemaIds, layerDuplicateKeys]);

  const isValidating = Object.values(validationByLayer).some((results) => results !== null);

  const issueSeverity = useMemo(() => {
    const severity = new Map<GeoJSON.Feature, IssueSeverity>();
    for (const [layer, results] of Object.entries(validationByLayer)) {
      for (const { featureIndex, issues } of results ?? []) {
        const feature = featuresByLayer[layer]?.[featureIndex];
        if (feature) severity.set(feature, worstSeverity(issues));
      }
    }
    return severity;
  }, [validationByLayer, featuresByLayer]);
  const issueCounts = useMemo(() => {
    const counts = { error: 0, warning: 0 };
    for (const value of issueSeverity.values()) counts[value]++;
    return counts;
  }, [issueSeverity]);
  const showIssuesOnMap = highlightIssues && isValidating;

  const hiddenLayersKey = [...hiddenLayers].sort().join(",");
  const mapFitKey = `${conversionId}:${hiddenLayersKey}`;
  // Identifies everything the map's vector layer draws — data revision,
  // visible layers and issue styling — so it remounts whenever any of them
  // change, including after edits, deletes, undo and redo.
  const mapVersion = `${history.revision}:${hiddenLayersKey}:${showIssuesOnMap ? JSON.stringify([layerSchemaIds, layerDuplicateKeys]) : ""}`;

  function selectFeatures(features: GeoJSON.Feature[]) {
    setSelectedFeatures(new Set(features));
    toast(`Selected ${plural(features.length, "feature")}`, {
      id: HISTORY_TOAST_ID,
      action: { label: "Edit selected", onClick: openBulkEdit },
    });
  }

  const clearFocusFeature = useCallback(() => setFocusFeature(null), []);

  function showOnMap(feature: GeoJSON.Feature) {
    const layer = groupNameOf(feature);
    if (hiddenLayers.has(layer)) {
      setHiddenLayers((prev) => {
        const next = new Set(prev);
        next.delete(layer);
        return next;
      });
    }
    setFocusFeature(feature);
    setActiveTab("map");
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || isOwnUndoContext(event.target)) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey && history.undoLabel) {
        event.preventDefault();
        undoChange();
      } else if ((key === "y" || (key === "z" && event.shiftKey)) && history.redoLabel) {
        event.preventDefault();
        redoChange();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  function commitFeatures(
    label: string,
    transform: (features: GeoJSON.Feature[]) => GeoJSON.Feature[],
    { notify = true } = {},
  ) {
    history.commit(label, (prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        featureCollection: {
          ...prev.featureCollection,
          features: transform(prev.featureCollection.features),
        },
      };
    });
    if (notify) {
      toast(label, {
        id: HISTORY_TOAST_ID,
        action: { label: "Undo", onClick: () => undoChange(label) },
      });
    }
  }

  // Selections hold feature object references; after undo/redo those may no
  // longer be in the data, so the selection is dropped rather than left stale.
  function undoChange(label = history.undoLabel) {
    if (!label) return;
    history.undo();
    setSelectedFeatures(new Set());
    toast(`Undone: ${label}`, {
      id: HISTORY_TOAST_ID,
      action: { label: "Redo", onClick: () => redoChange(label) },
    });
  }

  function redoChange(label = history.redoLabel) {
    if (!label) return;
    history.redo();
    setSelectedFeatures(new Set());
    toast(`Redone: ${label}`, {
      id: HISTORY_TOAST_ID,
      action: { label: "Undo", onClick: () => undoChange(label) },
    });
  }

  function toggleLayer(layer: string) {
    setHiddenLayers((prev) => {
      const next = new Set(prev);
      if (next.has(layer)) next.delete(layer);
      else next.add(layer);
      return next;
    });
  }

  const existingPropertyKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const feature of visibleFeatureCollection.features) {
      for (const key of Object.keys(feature.properties ?? {})) keys.add(key);
    }
    return [...keys].sort();
  }, [visibleFeatureCollection]);

  const filteredFeatureCollection = useMemo((): GeoJSON.FeatureCollection => {
    const query = searchQuery.trim().toLowerCase();
    if (!query && propertyFilters.length === 0) return visibleFeatureCollection;
    return {
      type: "FeatureCollection",
      features: visibleFeatureCollection.features.filter((feature) => {
        const properties = feature.properties ?? {};
        if (query) {
          const matchesSearch = Object.values(properties).some((value) =>
            stringifyPropertyValue(value).toLowerCase().includes(query),
          );
          if (!matchesSearch) return false;
        }
        return propertyFilters.every((filter) =>
          stringifyPropertyValue(properties[filter.key])
            .toLowerCase()
            .includes(filter.value.toLowerCase()),
        );
      }),
    };
  }, [visibleFeatureCollection, searchQuery, propertyFilters]);

  function addPropertyFilter(key: string, value: string) {
    const id = String(nextFilterId.current++);
    setPropertyFilters((prev) => [...prev, { id, key, value }]);
  }

  function removePropertyFilter(id: string) {
    setPropertyFilters((prev) => prev.filter((filter) => filter.id !== id));
  }

  function toggleFeatureSelection(feature: GeoJSON.Feature) {
    setSelectedFeatures((prev) => {
      const next = new Set(prev);
      if (next.has(feature)) next.delete(feature);
      else next.add(feature);
      return next;
    });
  }

  function toggleAllSelection() {
    setSelectedFeatures((prev) => {
      const features = filteredFeatureCollection.features;
      const allSelected = features.length > 0 && features.every((f) => prev.has(f));
      return allSelected ? new Set() : new Set(features);
    });
  }

  function openEditDialog(feature: GeoJSON.Feature) {
    setEditingFeature(feature);
    setEditSessionId((id) => id + 1);
  }

  function updateFeatureProperties(
    target: GeoJSON.Feature,
    properties: Record<string, string | number | boolean | null>,
  ) {
    commitFeatures(
      "Edited feature properties",
      (features) => features.map((f) => (f === target ? { ...f, properties } : f)),
      { notify: false },
    );
  }

  function deleteFeature(target: GeoJSON.Feature) {
    commitFeatures("Deleted 1 feature", (features) => features.filter((f) => f !== target));
    setSelectedFeatures((prev) => {
      if (!prev.has(target)) return prev;
      const next = new Set(prev);
      next.delete(target);
      return next;
    });
  }

  function applyBulkEdit(
    updates: Map<GeoJSON.Feature, PropertyRecord>,
    removals: Set<GeoJSON.Feature>,
  ) {
    const parts = [
      removals.size > 0 && `Removed ${plural(removals.size, "feature")}`,
      updates.size > 0 && `Edited ${plural(updates.size, "feature")}`,
    ].filter(Boolean);
    commitFeatures(parts.join(", "), (features) =>
      features
        .filter((f) => !removals.has(f))
        .map((f) => (updates.has(f) ? { ...f, properties: updates.get(f)! } : f)),
    );
    setSelectedFeatures(new Set());
    setBulkEditOpen(false);
  }

  function openBulkEdit() {
    setBulkEditOpen(true);
    setBulkEditSessionId((id) => id + 1);
  }

  function setLayerSchema(layer: string, schemaId: string | null) {
    setLayerSchemaIds((prev) => ({ ...prev, [layer]: schemaId }));
  }

  function applyPropertyRename(layer: string, renameMap: Record<string, string | null>) {
    const propertyCount = Object.keys(renameMap).length;
    commitFeatures(
      `Renamed or removed ${plural(propertyCount, "property")} on ${layer}`,
      (features) =>
        features.map((f) => {
          if (groupNameOf(f) !== layer) return f;
          const renamed: GeoJSON.GeoJsonProperties = {};
          for (const [key, value] of Object.entries(f.properties ?? {})) {
            if (!(key in renameMap)) {
              renamed[key] = value;
              continue;
            }
            const target = renameMap[key];
            if (target === null) continue;
            renamed[target] = value;
          }
          return { ...f, properties: renamed };
        }),
    );
  }

  function selectFiles(next: File[]) {
    const supported = next.filter(isSupportedFile);
    const rejectedCount = next.length - supported.length;

    setFiles(supported);
    setFileStatuses([]);
    history.reset(null);
    setStatus(rejectedCount > 0 && supported.length === 0 ? "error" : "idle");
    setError(
      rejectedCount > 0
        ? `Skipped ${rejectedCount} unsupported file${rejectedCount === 1 ? "" : "s"} — only .dxf, .zip (Shapefile), .xlsx, .geojson, and .kml/.kmz are supported.`
        : null,
    );
    setSourceCrs(DEFAULT_SOURCE_CRS);
    void detectCrs(supported);
  }

  // DXF files carry no CRS of their own, so ask the server which source CRS
  // their coordinates fit and select it, unless the default already fits.
  async function detectCrs(selected: File[]) {
    const requestId = ++detectionRequestId.current;
    const dxfFiles = selected.filter((f) => f.name.toLowerCase().endsWith(".dxf"));
    if (dxfFiles.length === 0) {
      setCrsDetection(null);
      return;
    }
    setCrsDetection({ status: "detecting" });
    const results = await Promise.all(
      dxfFiles.map(async (file): Promise<FileCrsMatches | null> => {
        const formData = new FormData();
        formData.append("file", file);
        try {
          const response = await fetch("/api/detect-crs", { method: "POST", body: formData });
          if (!response.ok) return null;
          const data = (await response.json()) as { matches: string[] };
          return { fileName: file.name, matches: data.matches };
        } catch {
          return null;
        }
      }),
    );
    // A newer selection has started its own detection; drop this stale one.
    if (requestId !== detectionRequestId.current) return;
    const detected = results.filter((r) => r !== null);
    const common = commonCrsMatches(detected);
    const crs = common.includes(DEFAULT_SOURCE_CRS) ? DEFAULT_SOURCE_CRS : common[0];
    if (crs) setSourceCrs(crs);
    setCrsDetection({ status: "done", files: detected, autoSelected: crs });
  }

  async function handleConvert() {
    if (files.length === 0) return;
    setStatus("converting");
    setError(null);
    setFileStatuses(files.map((f) => ({ file: f, status: "pending" })));

    const isBatch = files.length > 1;

    const outcomes = await Promise.all(
      files.map(async (file, index) => {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("sourceCrs", sourceCrs);

        try {
          const response = await fetch("/api/convert", { method: "POST", body: formData });
          const data: unknown = await response.json();
          if (!response.ok) {
            const message = (data as { error?: string }).error ?? "Failed to convert this file.";
            throw new Error(message);
          }
          setFileStatuses((prev) =>
            prev.map((s, i) => (i === index ? { ...s, status: "done" } : s)),
          );
          return { file, data: data as ConvertResponse };
        } catch (err) {
          const message = err instanceof Error ? err.message : "Failed to convert this file.";
          setFileStatuses((prev) =>
            prev.map((s, i) => (i === index ? { ...s, status: "error", error: message } : s)),
          );
          return { file, error: message };
        }
      }),
    );

    const features: GeoJSON.Feature[] = [];
    const warnings: string[] = [];

    for (const outcome of outcomes) {
      if ("error" in outcome) {
        warnings.push(`${outcome.file.name}: ${outcome.error}`);
        continue;
      }
      for (const feature of outcome.data.featureCollection.features) {
        features.push(
          isBatch && !feature.properties?.source
            ? { ...feature, properties: { ...feature.properties, source: outcome.file.name } }
            : feature,
        );
      }
      for (const warning of outcome.data.warnings) {
        warnings.push(isBatch ? `${outcome.file.name}: ${warning}` : warning);
      }
    }

    if (features.length === 0) {
      setError(warnings.join("\n") || "Failed to convert this file.");
      setStatus("error");
      return;
    }

    history.reset({ featureCollection: { type: "FeatureCollection", features }, warnings });
    setHiddenLayers(new Set());
    setConversionId((id) => id + 1);
    setFocusFeature(null);
    setLayerSchemaIds({});
    setLayerDuplicateKeys({});
    setSelectedFeatures(new Set());
    setSearchQuery("");
    setPropertyFilters([]);
    setStatus("idle");
    setIsUploadCollapsed(true);
  }

  function downloadGeoJson() {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result.featureCollection, null, 2)], {
      type: "application/geo+json; charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const baseName =
      files[0]?.name.replace(/\.(dxf|zip|xlsx|geojson|json|kml|kmz)$/i, "") ?? "converted";
    link.download =
      files.length > 1 ? `${baseName}-and-${files.length - 1}-more.geojson` : `${baseName}.geojson`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex w-full flex-col gap-6 p-8">
      <div className="mx-auto w-full max-w-4xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-4xl font-bold">GIS Converter</h1>
            <p className="mt-2 text-lg text-muted-foreground">
              Convert DXF, Shapefile (zipped), or Excel files — one at a time or in bulk — to
              GeoJSON and preview them together on a map, or load an existing GeoJSON file to edit
              and validate it against a schema.
            </p>
          </div>
          <ClientOnly>
            <ThemeToggle />
          </ClientOnly>
        </div>
      </div>

      <Card className="mx-auto w-full max-w-4xl">
        {isUploadCollapsed && result ? (
          <CardContent className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />
              <span className="font-medium">
                {files.length === 1 ? files[0].name : `${files.length} files`}
              </span>
              <span className="text-muted-foreground">converted to GeoJSON</span>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" size="sm" onClick={downloadGeoJson}>
                Download GeoJSON
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsUploadCollapsed(false)}
              >
                {files.length > 1 ? "Change files" : "Change file"}
              </Button>
            </div>
          </CardContent>
        ) : (
          <>
            <CardHeader>
              <CardTitle>Convert files</CardTitle>
              <CardDescription>
                Currently supported: DXF, Shapefile (.zip), Excel (.xlsx), KML/KMZ → GeoJSON, plus
                existing GeoJSON files for editing and schema validation. Select or drop multiple
                files, or a whole folder, to convert them together.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".dxf,.zip,.xlsx,.geojson,.json,.kml,.kmz"
                  multiple
                  className="hidden"
                  onChange={(e) => selectFiles([...(e.target.files ?? [])])}
                />
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragging(false);
                    void collectFilesFromDataTransfer(e.dataTransfer)
                      .then(selectFiles)
                      .catch(() => setError("Could not read the dropped files."));
                  }}
                  className={cn(
                    "flex w-full cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors",
                    isDragging ? "border-primary bg-primary/5" : "border-input hover:bg-accent/50",
                  )}
                >
                  <UploadCloud className="size-8 text-muted-foreground" />
                  <p className="text-sm">
                    <span className="font-medium">
                      Drag and drop .dxf, .zip (Shapefile), .xlsx, .geojson, or .kml/.kmz files (or
                      a folder) here
                    </span>
                    , or click to browse.
                  </p>
                  {files.length > 0 && (
                    <span className="text-sm text-muted-foreground">
                      {files.length === 1 ? files[0].name : `${files.length} files selected`}
                    </span>
                  )}
                </button>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium" htmlFor="source-crs">
                  Source coordinate system
                </label>
                <SearchableSelect
                  id="source-crs"
                  className="w-full sm:w-100"
                  value={sourceCrs}
                  onValueChange={setSourceCrs}
                  options={SUPPORTED_SOURCE_CRS.map((crs) => ({
                    value: crs.code,
                    label: crs.label,
                    keywords: [crs.code],
                  }))}
                  searchPlaceholder="Search coordinate systems…"
                />
                <CrsDetectionHint
                  detection={crsDetection}
                  sourceCrs={sourceCrs}
                  onUse={setSourceCrs}
                />
                <p className="text-sm text-muted-foreground">
                  Used when the file doesn&apos;t specify its own coordinate system — always for
                  DXF; for a Shapefile only if it has no .prj file; for Excel only if its geom
                  column (or coordinate columns) don&apos;t declare one; for GeoJSON only if it has
                  no &quot;crs&quot; member and its coordinates aren&apos;t lon/lat. The output
                  GeoJSON is always in WGS 84 (EPSG:4326). KML is always WGS 84, so this setting
                  doesn&apos;t apply to it.
                </p>
              </div>

              <div className="flex gap-3">
                <Button
                  type="button"
                  disabled={
                    files.length === 0 ||
                    status === "converting" ||
                    crsDetection?.status === "detecting"
                  }
                  onClick={handleConvert}
                >
                  {status === "converting" && <Loader2 className="size-4 animate-spin" />}
                  {files.length > 1
                    ? `Convert ${files.length} files to GeoJSON`
                    : "Convert to GeoJSON"}
                </Button>
                {result && (
                  <Button type="button" variant="secondary" onClick={downloadGeoJson}>
                    Download GeoJSON
                  </Button>
                )}
              </div>

              {status === "converting" && fileStatuses.length > 1 && (
                <ul className="flex flex-col gap-1 text-sm">
                  {fileStatuses.map((fs) => (
                    <li key={fs.file.name} className="flex items-center gap-2">
                      {fs.status === "pending" && (
                        <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
                      )}
                      {fs.status === "done" && (
                        <CheckCircle2 className="size-3.5 shrink-0 text-emerald-500" />
                      )}
                      {fs.status === "error" && (
                        <XCircle className="size-3.5 shrink-0 text-destructive" />
                      )}
                      <span className={fs.status === "error" ? "text-destructive" : undefined}>
                        {fs.file.name}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {status === "error" && error && (
                <Alert variant="destructive">
                  <AlertTitle>Conversion failed</AlertTitle>
                  <AlertDescription>
                    {error.split("\n").map((line) => (
                      <p key={line}>{line}</p>
                    ))}
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </>
        )}

        {result && result.warnings.length > 0 && (
          <CardContent className="pt-0">
            <Alert>
              <AlertTitle>Heads up</AlertTitle>
              <AlertDescription>
                {result.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </AlertDescription>
            </Alert>
          </CardContent>
        )}
      </Card>

      {result && (
        <Card>
          <CardHeader>
            <CardTitle>Preview</CardTitle>
            <CardDescription>
              {result.featureCollection.features.length} feature
              {result.featureCollection.features.length === 1 ? "" : "s"}, reprojected to WGS 84
              (EPSG:4326).
            </CardDescription>
            <CardAction className="flex gap-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!history.undoLabel}
                title={
                  history.undoLabel ? `Undo: ${history.undoLabel} (Ctrl+Z)` : "Nothing to undo"
                }
                onClick={() => undoChange()}
              >
                <Undo2 />
                Undo
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!history.redoLabel}
                title={
                  history.redoLabel
                    ? `Redo: ${history.redoLabel} (Ctrl+Shift+Z)`
                    : "Nothing to redo"
                }
                onClick={() => redoChange()}
              >
                <Redo2 />
                Redo
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {layers.length > 1 && (
              <LayerLegend layers={layers} hiddenLayers={hiddenLayers} onToggle={toggleLayer} />
            )}
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList>
                <TabsTrigger value="map">Map</TabsTrigger>
                <TabsTrigger value="list">List</TabsTrigger>
                <TabsTrigger value="validation">Validation</TabsTrigger>
              </TabsList>
              <TabsContent value="map" className="flex flex-col gap-2">
                {isValidating && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    <label htmlFor="highlight-issues" className="flex items-center gap-2">
                      <Checkbox
                        id="highlight-issues"
                        checked={highlightIssues}
                        onCheckedChange={(checked) => setHighlightIssues(checked === true)}
                      />
                      Highlight validation issues
                    </label>
                    {showIssuesOnMap && (
                      <>
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <span
                            className="size-2.5 rounded-full"
                            style={{ backgroundColor: ISSUE_COLORS.error }}
                          />
                          {plural(issueCounts.error, "feature")} with errors
                        </span>
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <span
                            className="size-2.5 rounded-full"
                            style={{ backgroundColor: ISSUE_COLORS.warning }}
                          />
                          {issueCounts.warning} with warnings only
                        </span>
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <span
                            className="size-2.5 rounded-full"
                            style={{ backgroundColor: ISSUE_COLORS.ok }}
                          />
                          no issues
                        </span>
                      </>
                    )}
                  </div>
                )}
                <div className="h-125 overflow-hidden rounded-lg border">
                  <ClientOnly
                    fallback={
                      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                        Loading map…
                      </div>
                    }
                  >
                    <GeoJsonMap
                      featureCollection={visibleFeatureCollection}
                      version={mapVersion}
                      fitKey={mapFitKey}
                      issueSeverity={showIssuesOnMap ? issueSeverity : null}
                      focusFeature={focusFeature}
                      onFocusHandled={clearFocusFeature}
                    />
                  </ClientOnly>
                </div>
              </TabsContent>
              <TabsContent value="list" className="flex flex-col gap-2">
                <FeatureFilterBar
                  searchQuery={searchQuery}
                  onSearchQueryChange={setSearchQuery}
                  existingKeys={existingPropertyKeys}
                  filters={propertyFilters}
                  onAddFilter={addPropertyFilter}
                  onRemoveFilter={removePropertyFilter}
                />
                {(searchQuery.trim() || propertyFilters.length > 0) && (
                  <p className="text-sm text-muted-foreground">
                    {filteredFeatureCollection.features.length} of{" "}
                    {visibleFeatureCollection.features.length} features match
                  </p>
                )}
                {selectedFeatures.size > 0 && (
                  <div className="flex items-center justify-between rounded-lg border bg-muted/50 px-3 py-2">
                    <span className="text-sm">{selectedFeatures.size} selected</span>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedFeatures(new Set())}
                      >
                        Clear
                      </Button>
                      <Button type="button" size="sm" onClick={openBulkEdit}>
                        Edit {selectedFeatures.size} selected
                      </Button>
                    </div>
                  </div>
                )}
                <FeatureList
                  featureCollection={filteredFeatureCollection}
                  selectedFeatures={selectedFeatures}
                  onToggleFeature={toggleFeatureSelection}
                  onToggleAll={toggleAllSelection}
                  onEditFeature={openEditDialog}
                />
              </TabsContent>
              <TabsContent value="validation">
                <SchemaValidationPanel
                  layers={layers}
                  featuresByLayer={featuresByLayer}
                  validationByLayer={validationByLayer}
                  layerSchemaIds={layerSchemaIds}
                  onLayerSchemaChange={setLayerSchema}
                  layerDuplicateKeys={layerDuplicateKeys}
                  onLayerDuplicateKeyChange={(layer, key) =>
                    setLayerDuplicateKeys((prev) => ({ ...prev, [layer]: key }))
                  }
                  onDeleteFeature={deleteFeature}
                  onSelectFeatures={selectFeatures}
                  onShowOnMap={showOnMap}
                  onEditFeature={openEditDialog}
                  onApplyRename={applyPropertyRename}
                />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}

      <PropertyEditDialog
        key={`edit-${editSessionId}`}
        feature={editingFeature}
        open={editingFeature !== null}
        onOpenChange={(open) => {
          if (!open) setEditingFeature(null);
        }}
        onSave={(properties) => {
          if (editingFeature) updateFeatureProperties(editingFeature, properties);
          setEditingFeature(null);
        }}
      />
      <BulkEditDialog
        key={`bulk-edit-${bulkEditSessionId}`}
        open={bulkEditOpen}
        features={[...selectedFeatures]}
        existingKeys={existingPropertyKeys}
        onOpenChange={setBulkEditOpen}
        onApply={applyBulkEdit}
      />
    </div>
  );
}
