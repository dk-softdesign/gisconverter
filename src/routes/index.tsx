import { useRef, useState } from "react";
import { ClientOnly, createFileRoute } from "@tanstack/react-router";
import { Loader2, UploadCloud } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "#/components/ui/alert";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card";
import { GeoJsonMap } from "#/components/geojson-map";

export const Route = createFileRoute("/")({ component: Home });

interface ConvertResponse {
  featureCollection: GeoJSON.FeatureCollection;
  warnings: string[];
}

function Home() {
  const [file, setFile] = useState<File | null>(null);
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
              {result.featureCollection.features.length === 1 ? "" : "s"}. DXF drawing units are
              shown as-is (not reprojected to real-world coordinates).
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
