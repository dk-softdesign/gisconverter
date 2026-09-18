import { useEffect, useMemo, useRef, useState } from "react";
import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Loader2, UploadCloud, XCircle } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { BulkEditDialog } from "#/components/bulk-edit-dialog";
import { FeatureFilterBar, type PropertyFilter } from "#/components/feature-filter-bar";
import { FeatureList } from "#/components/feature-list";
import { GeoJsonMap } from "#/components/geojson-map";
import { LayerLegend } from "#/components/layer-legend";
import { PropertyEditDialog } from "#/components/property-edit-dialog";
import { SchemaValidationPanel } from "#/components/schema-validation-panel";
import { ThemeToggle } from "#/components/theme-toggle";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { collectFilesFromDataTransfer } from "#/lib/collect-files";
import { DEFAULT_SOURCE_CRS, SUPPORTED_SOURCE_CRS, isSupportedSourceCrs } from "#/lib/crs";
import { groupNameOf } from "#/lib/layer-colors";
import { cn } from "#/lib/utils";

const SUPPORTED_EXTENSIONS = [".dxf", ".zip", ".xlsx"];

function isSupportedFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((ext) => name.endsWith(ext));
}

export const Route = createFileRoute("/")({ component: Home });

interface ConvertResponse {
  featureCollection: GeoJSON.FeatureCollection;
  warnings: string[];
}

const SOURCE_CRS_STORAGE_KEY = "gisconverter:sourceCrs";

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
  const [sourceCrs, setSourceCrsState] = useState(DEFAULT_SOURCE_CRS);
  const [status, setStatus] = useState<"idle" | "converting" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ConvertResponse | null>(null);
  const [version, setVersion] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [hiddenLayers, setHiddenLayers] = useState<Set<string>>(new Set());
  const [layerSchemaIds, setLayerSchemaIds] = useState<Record<string, string | null>>({});
  const [selectedFeatures, setSelectedFeatures] = useState<Set<GeoJSON.Feature>>(new Set());
  const [editingFeature, setEditingFeature] = useState<GeoJSON.Feature | null>(null);
  const [editSessionId, setEditSessionId] = useState(0);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkEditSessionId, setBulkEditSessionId] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [propertyFilters, setPropertyFilters] = useState<PropertyFilter[]>([]);
  const [isUploadCollapsed, setIsUploadCollapsed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const nextFilterId = useRef(0);

  useEffect(() => {
    // Reads localStorage, so this can only happen client-side post-mount; the
    // initial SSR/client render must both use the default to avoid a
    // hydration mismatch, hence setting state from an effect here.
    try {
      const saved = localStorage.getItem(SOURCE_CRS_STORAGE_KEY);
      // oxlint-disable-next-line react/set-state-in-effect
      if (saved && isSupportedSourceCrs(saved)) setSourceCrsState(saved);
    } catch {
      // localStorage unavailable (private browsing, etc.) — fall back to the default.
    }
  }, []);

  // Persist only in response to an explicit user choice (not as an effect
  // reacting to `sourceCrs`) so it can't race with the mount-time read above.
  function setSourceCrs(next: string) {
    setSourceCrsState(next);
    try {
      localStorage.setItem(SOURCE_CRS_STORAGE_KEY, next);
    } catch {
      // ignore
    }
  }

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

  // Identifies this exact combination of conversion + visible layers, so the
  // map's vector layer remounts whenever what it should render changes.
  const mapVersion = `${version}:${[...hiddenLayers].sort().join(",")}`;

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
    setResult((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        featureCollection: {
          ...prev.featureCollection,
          features: prev.featureCollection.features.map((f) =>
            f === target ? { ...f, properties } : f,
          ),
        },
      };
    });
  }

  function applyBulkEdit(key: string, value: string | number | boolean | null) {
    setResult((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        featureCollection: {
          ...prev.featureCollection,
          features: prev.featureCollection.features.map((f) =>
            selectedFeatures.has(f) ? { ...f, properties: { ...f.properties, [key]: value } } : f,
          ),
        },
      };
    });
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

  function applyPropertyRename(layer: string, renameMap: Record<string, string>) {
    setResult((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        featureCollection: {
          ...prev.featureCollection,
          features: prev.featureCollection.features.map((f) => {
            if (groupNameOf(f) !== layer) return f;
            const renamed: GeoJSON.GeoJsonProperties = {};
            for (const [key, value] of Object.entries(f.properties ?? {})) {
              renamed[renameMap[key] ?? key] = value;
            }
            return { ...f, properties: renamed };
          }),
        },
      };
    });
  }

  function selectFiles(next: File[]) {
    const supported = next.filter(isSupportedFile);
    const rejectedCount = next.length - supported.length;

    setFiles(supported);
    setFileStatuses([]);
    setResult(null);
    setStatus(rejectedCount > 0 && supported.length === 0 ? "error" : "idle");
    setError(
      rejectedCount > 0
        ? `Skipped ${rejectedCount} unsupported file${rejectedCount === 1 ? "" : "s"} — only .dxf, .zip (Shapefile), and .xlsx are supported.`
        : null,
    );
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

    setResult({ featureCollection: { type: "FeatureCollection", features }, warnings });
    setHiddenLayers(new Set());
    setLayerSchemaIds({});
    setSelectedFeatures(new Set());
    setSearchQuery("");
    setPropertyFilters([]);
    setVersion((v) => v + 1);
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
    const baseName = files[0]?.name.replace(/\.(dxf|zip|xlsx)$/i, "") ?? "converted";
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
              GeoJSON and preview them together on a map.
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
                Currently supported: DXF, Shapefile (.zip), Excel (.xlsx) → GeoJSON. Select or drop
                multiple files, or a whole folder, to convert them together.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".dxf,.zip,.xlsx"
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
                      Drag and drop .dxf, .zip (Shapefile), or .xlsx files (or a folder) here
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
                <Select value={sourceCrs} onValueChange={setSourceCrs}>
                  <SelectTrigger id="source-crs" className="w-full sm:w-100">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SUPPORTED_SOURCE_CRS.map((crs) => (
                      <SelectItem key={crs.code} value={crs.code}>
                        {crs.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-sm text-muted-foreground">
                  Used when the file doesn&apos;t specify its own coordinate system — always for
                  DXF; for a Shapefile only if it has no .prj file; for Excel only if its geom
                  column (or coordinate columns) don&apos;t declare one. The output GeoJSON is
                  always in WGS 84 (EPSG:4326).
                </p>
              </div>

              <div className="flex gap-3">
                <Button
                  type="button"
                  disabled={files.length === 0 || status === "converting"}
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
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {layers.length > 1 && (
              <LayerLegend layers={layers} hiddenLayers={hiddenLayers} onToggle={toggleLayer} />
            )}
            <Tabs defaultValue="map">
              <TabsList>
                <TabsTrigger value="map">Map</TabsTrigger>
                <TabsTrigger value="list">List</TabsTrigger>
                <TabsTrigger value="validation">Validation</TabsTrigger>
              </TabsList>
              <TabsContent value="map">
                <div className="h-125 overflow-hidden rounded-lg border">
                  <ClientOnly
                    fallback={
                      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                        Loading map…
                      </div>
                    }
                  >
                    <GeoJsonMap featureCollection={visibleFeatureCollection} version={mapVersion} />
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
                  featureCollection={result.featureCollection}
                  layers={layers}
                  layerSchemaIds={layerSchemaIds}
                  onLayerSchemaChange={setLayerSchema}
                  onEditFeature={openEditDialog}
                  onApplyRename={applyPropertyRename}
                />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}

      <PropertyEditDialog
        key={editSessionId}
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
        key={bulkEditSessionId}
        open={bulkEditOpen}
        count={selectedFeatures.size}
        existingKeys={existingPropertyKeys}
        onOpenChange={setBulkEditOpen}
        onApply={applyBulkEdit}
      />
    </div>
  );
}
