import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

import { DEFAULT_SOURCE_CRS, isSupportedSourceCrs } from "#/lib/crs";
import { convertDxfToGeoJson } from "#/lib/dxf-to-geojson";

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

export const Route = createFileRoute("/api/convert")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const formData = await request.formData();
        const file = formData.get("file");

        if (!(file instanceof File)) {
          return Response.json({ error: "No file was provided." }, { status: 400 });
        }
        if (!file.name.toLowerCase().endsWith(".dxf")) {
          return Response.json(
            { error: "Only .dxf files are supported right now." },
            { status: 400 },
          );
        }
        if (file.size > MAX_FILE_SIZE_BYTES) {
          return Response.json({ error: "File is too large (max 25MB)." }, { status: 413 });
        }

        const sourceCrs = formData.get("sourceCrs");
        const crs =
          typeof sourceCrs === "string" && sourceCrs.length > 0 ? sourceCrs : DEFAULT_SOURCE_CRS;
        if (!isSupportedSourceCrs(crs)) {
          return Response.json(
            { error: `Unsupported source coordinate system: ${crs}` },
            { status: 400 },
          );
        }

        const text = await file.text();

        try {
          const result = convertDxfToGeoJson(text, crs);
          return Response.json(result);
        } catch (error) {
          return Response.json(
            { error: error instanceof Error ? error.message : "Failed to convert this DXF file." },
            { status: 422 },
          );
        }
      },
    },
  },
});
