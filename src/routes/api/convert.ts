import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

import { DEFAULT_SOURCE_CRS, isSupportedSourceCrs } from "#/lib/crs";
import { convertDxfToGeoJson, type DxfConversionResult } from "#/lib/dxf-to-geojson";
import { convertExcelToGeoJson, type ExcelConversionResult } from "#/lib/excel-to-geojson";
import { convertGeoJsonToGeoJson, type GeoJsonConversionResult } from "#/lib/geojson-to-geojson";
import {
  convertGeoPackageToGeoJson,
  type GeoPackageConversionResult,
} from "#/lib/geopackage-to-geojson";
import { convertKmlToGeoJson, type KmlConversionResult } from "#/lib/kml-to-geojson";
import { NO_GEOMETRY_ERROR_CODE, NoGeometryError } from "#/lib/no-geometry";
import {
  convertShapefileToGeoJson,
  type ShapefileConversionResult,
} from "#/lib/shapefile-to-geojson";

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

type ConversionResult =
  | DxfConversionResult
  | ShapefileConversionResult
  | ExcelConversionResult
  | GeoJsonConversionResult
  | KmlConversionResult
  | GeoPackageConversionResult;

function jsonResponse(result: ConversionResult) {
  return Response.json(result, {
    headers: { "Content-Type": "application/geo+json; charset=utf-8" },
  });
}

export const Route = createFileRoute("/api/convert")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const formData = await request.formData();
        const file = formData.get("file");

        if (!(file instanceof File)) {
          return Response.json({ error: "No file was provided." }, { status: 400 });
        }
        const fileName = file.name.toLowerCase();
        const isDxf = fileName.endsWith(".dxf");
        const isZip = fileName.endsWith(".zip");
        const isExcel = fileName.endsWith(".xlsx");
        const isGeoJson = fileName.endsWith(".geojson") || fileName.endsWith(".json");
        const isKml = fileName.endsWith(".kml") || fileName.endsWith(".kmz");
        const isGeoPackage = fileName.endsWith(".gpkg");
        if (!isDxf && !isZip && !isExcel && !isGeoJson && !isKml && !isGeoPackage) {
          return Response.json(
            {
              error:
                "Only .dxf, .zip (Shapefile), .xlsx, .geojson, .kml/.kmz, and .gpkg (GeoPackage) files are supported right now.",
            },
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

        // Set when the user has agreed to import a source with no geometry
        // as properties-only features (see NoGeometryError).
        const allowNoGeometry = formData.get("allowNoGeometry") === "true";

        try {
          if (isDxf) {
            const text = await file.text();
            return jsonResponse(convertDxfToGeoJson(text, crs));
          }
          if (isGeoJson) {
            return jsonResponse(convertGeoJsonToGeoJson(await file.text(), crs, allowNoGeometry));
          }
          if (isKml) {
            return jsonResponse(
              await convertKmlToGeoJson(await file.arrayBuffer(), file.name, allowNoGeometry),
            );
          }
          if (isGeoPackage) {
            return jsonResponse(
              convertGeoPackageToGeoJson(await file.arrayBuffer(), crs, allowNoGeometry),
            );
          }
          if (isZip) {
            const buffer = await file.arrayBuffer();
            return jsonResponse(
              await convertShapefileToGeoJson(buffer, crs, file.name, allowNoGeometry),
            );
          }
          const buffer = await file.arrayBuffer();
          return jsonResponse(await convertExcelToGeoJson(buffer, crs, allowNoGeometry));
        } catch (error) {
          if (error instanceof NoGeometryError) {
            return Response.json(
              {
                error: error.message,
                code: NO_GEOMETRY_ERROR_CODE,
                recordCount: error.recordCount,
              },
              { status: 422 },
            );
          }
          return Response.json(
            { error: error instanceof Error ? error.message : "Failed to convert this file." },
            { status: 422 },
          );
        }
      },
    },
  },
});
