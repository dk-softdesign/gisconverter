import { useEffect, useMemo, useRef, useState } from "react";
import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Loader2, UploadCloud } from "lucide-react";

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
import { ThemeToggle } from "#/components/theme-toggle";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { DEFAULT_SOURCE_CRS, SUPPORTED_SOURCE_CRS, isSupportedSourceCrs } from "#/lib/crs";
import { layerNameOf } from "#/lib/layer-colors";
import { cn } from "#/lib/utils";

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

function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [sourceCrs, setSourceCrsState] = useState(DEFAULT_SOURCE_CRS);
  const [status, setStatus] = useState<"idle" | "converting" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ConvertResponse | null>(null);
  const [version, setVersion] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [hiddenLayers, setHiddenLayers] = useState<Set<string>>(new Set());
  const [selectedFeatures, setSelectedFeatures] = useState<Set<GeoJSON.Feature>>(new Set());
  const [editingFeature, setEditingFeature] = useState<GeoJSON.Feature | null>(null);
  const [editSessionId, setEditSessionId] = useState(0);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkEditSessionId, setBulkEditSessionId] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [propertyFilters, setPropertyFilters] = useState<PropertyFilter[]>([]);
  const [isUploadCollapsed, setIsUploadCollapsed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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
    return [
      ...new Set(result.featureCollection.features.map((f) => layerNameOf(f.properties?.layer))),
    ].sort();
  }, [result]);

  const visibleFeatureCollection = useMemo((): GeoJSON.FeatureCollection => {
    if (!result) return { type: "FeatureCollection", features: [] };
    if (hiddenLayers.size === 0) return result.featureCollection;
    return {
      type: "FeatureCollection",
      features: result.featureCollection.features.filter(
        (f) => !hiddenLayers.has(layerNameOf(f.properties?.layer)),
      ),
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
    setPropertyFilters((prev) => [...prev, { id: crypto.randomUUID(), key, value }]);
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

  function selectFile(next: File | null) {
    if (next) {
      const name = next.name.toLowerCase();
      if (!name.endsWith(".dxf") && !name.endsWith(".zip") && !name.endsWith(".xlsx")) {
        setError("Only .dxf, .zip (Shapefile), and .xlsx files are supported right now.");
        setStatus("error");
        return;
      }
    }
    setFile(next);
    setResult(null);
    setError(null);
    setStatus("idle");
  }

  async function handleConvert() {
    if (!file) return;
    setStatus("converting");
    setError(null);

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
      setResult(data as ConvertResponse);
      setHiddenLayers(new Set());
      setSelectedFeatures(new Set());
      setSearchQuery("");
      setPropertyFilters([]);
      setVersion((v) => v + 1);
      setStatus("idle");
      setIsUploadCollapsed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to convert this file.");
      setStatus("error");
    }
  }

  function downloadGeoJson() {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result.featureCollection, null, 2)], {
      type: "application/geo+json; charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${file?.name.replace(/\.(dxf|zip|xlsx)$/i, "") ?? "converted"}.geojson`;
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
              Convert a DXF, Shapefile (zipped), or Excel file to GeoJSON and preview it on a map.
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
              <span className="font-medium">{file?.name}</span>
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
                Change file
              </Button>
            </div>
          </CardContent>
        ) : (
          <>
            <CardHeader>
              <CardTitle>Convert a file</CardTitle>
              <CardDescription>
                Currently supported: DXF, Shapefile (.zip), Excel (.xlsx) → GeoJSON.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".dxf,.zip,.xlsx"
                  className="hidden"
                  onChange={(e) => selectFile(e.target.files?.[0] ?? null)}
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
                    selectFile(e.dataTransfer.files?.[0] ?? null);
                  }}
                  className={cn(
                    "flex w-full cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors",
                    isDragging ? "border-primary bg-primary/5" : "border-input hover:bg-accent/50",
                  )}
                >
                  <UploadCloud className="size-8 text-muted-foreground" />
                  <p className="text-sm">
                    <span className="font-medium">
                      Drag and drop a .dxf, .zip (Shapefile), or .xlsx file here
                    </span>
                    , or click to browse.
                  </p>
                  {file && <span className="text-sm text-muted-foreground">{file.name}</span>}
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
                  disabled={!file || status === "converting"}
                  onClick={handleConvert}
                >
                  {status === "converting" && <Loader2 className="size-4 animate-spin" />}
                  Convert to GeoJSON
                </Button>
                {result && (
                  <Button type="button" variant="secondary" onClick={downloadGeoJson}>
                    Download GeoJSON
                  </Button>
                )}
              </div>

              {status === "error" && error && (
                <Alert variant="destructive">
                  <AlertTitle>Conversion failed</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
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
