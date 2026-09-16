import { useRef, useState } from "react";
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
import { DEFAULT_SOURCE_CRS, SUPPORTED_SOURCE_CRS } from "#/lib/crs";

export const Route = createFileRoute("/")({ component: Home });

interface ConvertResponse {
  featureCollection: GeoJSON.FeatureCollection;
  warnings: string[];
}

function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [sourceCrs, setSourceCrs] = useState(DEFAULT_SOURCE_CRS);
  const [status, setStatus] = useState<"idle" | "converting" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ConvertResponse | null>(null);
  const [version, setVersion] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

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
      type: "application/geo+json",
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
      <div>
        <h1 className="text-4xl font-bold">GIS Converter</h1>
        <p className="mt-2 text-lg text-muted-foreground">
          Convert a DXF file to GeoJSON and preview it on a map.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Convert a file</CardTitle>
          <CardDescription>Currently supported: DXF → GeoJSON.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <input
              ref={inputRef}
              type="file"
              accept=".dxf"
              className="hidden"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setResult(null);
                setError(null);
                setStatus("idle");
              }}
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => inputRef.current?.click()}
              className="gap-2"
            >
              <UploadCloud className="size-4" />
              {file ? "Choose a different file" : "Choose DXF file"}
            </Button>
            {file && <span className="text-sm text-muted-foreground">{file.name}</span>}
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
          <CardContent>
            <div className="h-125 overflow-hidden rounded-lg border">
              <ClientOnly
                fallback={
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    Loading map…
                  </div>
                }
              >
                <GeoJsonMap featureCollection={result.featureCollection} version={version} />
              </ClientOnly>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
