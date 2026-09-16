import ExcelJS from "exceljs";
import { Geometry as WkxGeometry, type ParsedGeometry as WkxParsedGeometry } from "wkx";

import { isSupportedSourceCrs } from "#/lib/crs";
import { reprojectFeatureCollection } from "#/lib/reproject";

export interface ExcelConversionResult {
  featureCollection: GeoJSON.FeatureCollection;
  warnings: string[];
}

const GEOM_COLUMN_NAMES = ["geom", "geometry"];

// Recognized (x, y) column-name pairs, tried in this order. Matching is
// case-insensitive. Extend this list as real spreadsheets show new
// conventions — this is deliberately a fixed, predictable set rather than
// fuzzy matching.
const COORDINATE_COLUMN_PAIRS: [string, string][] = [
  ["x", "y"],
  ["lon", "lat"],
  ["lng", "lat"],
  ["longitude", "latitude"],
  ["easting", "northing"],
];

function cellValue(value: ExcelJS.CellValue): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((t) => t.text).join("");
    if ("result" in value) return cellValue(value.result ?? null);
    if ("text" in value) return value.text;
    if ("error" in value) return null;
    return null;
  }
  return value;
}

interface ParsedGeom {
  geometry: GeoJSON.Geometry;
  srid: number | undefined;
}

const HEX_PATTERN = /^[0-9a-f]+$/i;
const WKT_PATTERN =
  /^(SRID=|POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON|GEOMETRYCOLLECTION)/i;

// A "geom" cell holds either hex-encoded WKB/EWKB (PostGIS's usual export
// form) or a WKT/EWKT string. wkx handles both once you hand it the right
// shape (a Buffer for the hex/binary form, the raw string for WKT) — it
// doesn't auto-detect hex text on its own.
function parseGeomCell(value: string | number | boolean | null): ParsedGeom | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  const isHex = trimmed.length >= 16 && trimmed.length % 2 === 0 && HEX_PATTERN.test(trimmed);
  if (!isHex && !WKT_PATTERN.test(trimmed)) return null;

  try {
    // TypeScript 7.0.2 has a checker bug where a `declare module` member
    // named "Geometry" (see src/types/wkx.d.ts) whose method returns a
    // different interface gets that return type resolved incorrectly. The
    // export must be named "Geometry" to match wkx's real runtime export,
    // so work around it with an explicit assertion here instead.
    const parsed = (isHex
      ? WkxGeometry.parse(Buffer.from(trimmed, "hex"))
      : WkxGeometry.parse(trimmed)) as unknown as WkxParsedGeometry;
    return { geometry: parsed.toGeoJSON(), srid: parsed.srid };
  } catch {
    return null;
  }
}

function findHeaderName(headers: string[], target: string): string | undefined {
  return headers.find((name) => name.toLowerCase() === target);
}

export async function convertExcelToGeoJson(
  buffer: ArrayBuffer,
  fallbackSourceCrs: string,
): Promise<ExcelConversionResult> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    throw new Error("Could not read this file as an Excel (.xlsx) workbook.");
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new Error("This workbook has no worksheets.");
  }

  const columns = new Map<number, string>();
  sheet.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const name = cellValue(cell.value);
    if (typeof name === "string" && name.trim().length > 0) {
      columns.set(colNumber, name.trim());
    }
  });

  if (columns.size === 0) {
    throw new Error("Could not find a header row — row 1 appears to be empty.");
  }

  const headerNames = [...columns.values()];
  const geomColumnName = GEOM_COLUMN_NAMES.map((name) => findHeaderName(headerNames, name)).find(
    (name) => name !== undefined,
  );

  let coordinateColumns: { x: string; y: string } | undefined;
  for (const [xName, yName] of COORDINATE_COLUMN_PAIRS) {
    const x = findHeaderName(headerNames, xName);
    const y = findHeaderName(headerNames, yName);
    if (x !== undefined && y !== undefined) {
      coordinateColumns = { x, y };
      break;
    }
  }

  if (geomColumnName === undefined && !coordinateColumns) {
    throw new Error(
      `No geometry column found. Expected a "geom" column (WKT or WKB), or a pair of coordinate ` +
        `columns (e.g. x/y, lon/lat, easting/northing). Columns found: ${headerNames.join(", ")}.`,
    );
  }

  const warnings: string[] = [];
  const features: GeoJSON.Feature[] = [];
  let unparseableGeomCount = 0;
  let missingCoordinatesCount = 0;
  let detectedSrid: number | undefined;

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const properties: Record<string, string | number | boolean | null> = {};
    for (const [colNumber, name] of columns) {
      properties[name] = cellValue(row.getCell(colNumber).value);
    }
    if (Object.values(properties).every((value) => value === null || value === "")) return;

    let geometry: GeoJSON.Geometry | null = null;

    if (geomColumnName !== undefined) {
      const raw = properties[geomColumnName];
      const parsed = parseGeomCell(raw);
      if (parsed) {
        geometry = parsed.geometry;
        if (parsed.srid !== undefined) detectedSrid = parsed.srid;
      } else if (raw !== null && raw !== "") {
        unparseableGeomCount++;
      }
    } else if (coordinateColumns) {
      const x = properties[coordinateColumns.x];
      const y = properties[coordinateColumns.y];
      if (typeof x === "number" && typeof y === "number") {
        geometry = { type: "Point", coordinates: [x, y] };
      } else {
        missingCoordinatesCount++;
      }
    }

    if (!geometry) return;
    features.push({ type: "Feature", properties, geometry });
  });

  if (unparseableGeomCount > 0) {
    warnings.push(`Skipped ${unparseableGeomCount} row(s) with an unparseable geom value.`);
  }
  if (missingCoordinatesCount > 0) {
    warnings.push(
      `Skipped ${missingCoordinatesCount} row(s) with missing or non-numeric coordinates.`,
    );
  }
  if (features.length === 0) {
    warnings.push("No features could be built from this spreadsheet.");
  }

  const featureCollection: GeoJSON.FeatureCollection = { type: "FeatureCollection", features };

  // The geom column's own SRID (embedded in WKB/EWKT) is authoritative when
  // present, the same way a Shapefile's .prj takes priority over the
  // manually selected source CRS.
  if (detectedSrid !== undefined) {
    const sourceCrs = `EPSG:${detectedSrid}`;
    if (!isSupportedSourceCrs(sourceCrs)) {
      throw new Error(
        `The geom column specifies EPSG:${detectedSrid}, which isn't one of the coordinate systems this app supports.`,
      );
    }
    return {
      featureCollection: reprojectFeatureCollection(featureCollection, sourceCrs),
      warnings,
    };
  }

  const reason =
    geomColumnName !== undefined
      ? "The geom column doesn't specify a coordinate system"
      : "The coordinate columns don't specify a coordinate system";
  warnings.push(
    `${reason}, so it was assumed to be in ${fallbackSourceCrs} and reprojected accordingly.`,
  );
  return {
    featureCollection: reprojectFeatureCollection(featureCollection, fallbackSourceCrs),
    warnings,
  };
}
