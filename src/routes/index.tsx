import { useEffect, useMemo, useRef, useState } from "react";
import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { Loader2, UploadCloud } from "lucide-react";

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
import { GeoJsonMap } from "#/components/geojson-map";
import { LayerLegend } from "#/components/layer-legend";
import { ThemeToggle } from "#/components/theme-toggle";
import { DEFAULT_SOURCE_CRS, SUPPORTED_SOURCE_CRS, isSupportedSourceCrs } from "#/lib/crs";
import { layerNameOf } from "#/lib/layer-colors";
import { cn } from "#/lib/utils";

export const Route = createFileRoute("/")({ component: Home });

interface ConvertResponse {
  featureCollection: GeoJSON.FeatureCollection;
  warnings: string[];
}

const SOURCE_CRS_STORAGE_KEY = "gisconverter:sourceCrs";

function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [sourceCrs, setSourceCrsState] = useState(DEFAULT_SOURCE_CRS);
  const [status, setStatus] = useState<"idle" | "converting" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ConvertResponse | null>(null);
  const [version, setVersion] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [hiddenLayers, setHiddenLayers] = useState<Set<string>>(new Set());
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

  function selectFile(next: File | null) {
    if (next && !next.name.toLowerCase().endsWith(".dxf")) {
      setError("Only .dxf files are supported right now.");
      setStatus("error");
      return;
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
      setVersion((v) => v + 1);
      setStatus("idle");
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
    link.download = `${file?.name.replace(/\.dxf$/i, "") ?? "converted"}.geojson`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold">GIS Converter</h1>
          <p className="mt-2 text-lg text-muted-foreground">
            Convert a DXF file to GeoJSON and preview it on a map.
          </p>
        </div>
        <ClientOnly>
          <ThemeToggle />
        </ClientOnly>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Convert a file</CardTitle>
          <CardDescription>Currently supported: DXF → GeoJSON.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div>
            <input
              ref={inputRef}
              type="file"
              accept=".dxf"
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
                <span className="font-medium">Drag and drop a .dxf file here</span>, or click to
                browse.
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
              DXF files don&apos;t embed a coordinate system, so tell us which one the file uses.
              The output GeoJSON is always reprojected to WGS 84 (EPSG:4326).
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

          {result && result.warnings.length > 0 && (
            <Alert>
              <AlertTitle>Heads up</AlertTitle>
              <AlertDescription>
                {result.warnings.map((warning) => (
                  <p key={warning}>{warning}</p>
                ))}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
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
          </CardContent>
        </Card>
      )}
    </div>
  );
}
