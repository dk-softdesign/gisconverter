import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import proj4 from "proj4";
import { Geometry as WkxGeometry, type ParsedGeometry as WkxParsedGeometry } from "wkx";

import { isSupportedSourceCrs } from "#/lib/crs";
import { NoGeometryError, propertiesOnlyFeature, propertiesOnlyWarning } from "#/lib/no-geometry";
import { reprojectFeatureCollection, WGS84 } from "#/lib/reproject";

export interface GeoPackageConversionResult {
  featureCollection: GeoJSON.FeatureCollection;
  warnings: string[];
}

type Row = Record<string, SQLInputValue>;

interface ContentsRow {
  table_name: string;
  data_type: string;
}

interface ColumnInfo {
  name: string;
  type: string;
  pk: number;
}

function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

// Envelope sizes in bytes, indexed by the envelope-indicator bits of the
// GeoPackage geometry header flags (none, XY, XYZ, XYM, XYZM).
const ENVELOPE_BYTES = [0, 32, 48, 48, 64];

// A GeoPackage geometry blob is a small "GP" header (version, flags, SRS id,
// optional bounding envelope) followed by plain WKB. Returns null for empty
// geometries; throws for anything unreadable (bad header, curve types and
// other extended geometries wkx doesn't support).
function parseGeoPackageGeometry(blob: Uint8Array): GeoJSON.Geometry | null {
  if (blob.length < 8 || blob[0] !== 0x47 || blob[1] !== 0x50) {
    throw new Error("Not a GeoPackage geometry");
  }
  const flags = blob[3];
  const isEmpty = (flags & 0b0001_0000) !== 0;
  if (isEmpty) return null;
  const envelopeIndicator = (flags >> 1) & 0b111;
  const envelopeBytes = ENVELOPE_BYTES[envelopeIndicator];
  if (envelopeBytes === undefined) throw new Error("Invalid GeoPackage envelope");
  const wkb = Buffer.from(blob.buffer, blob.byteOffset + 8 + envelopeBytes);
  // See src/types/wkx.d.ts for why this assertion is needed.
  const parsed = WkxGeometry.parse(wkb) as unknown as WkxParsedGeometry;
  return parsed.toGeoJSON();
}

// SQLite integers come back as BigInt (so nothing large is silently rounded);
// keep them as plain numbers where that's exact. BLOBs other than geometry
// have no sensible GeoJSON property form and are dropped by the caller.
function toPropertyValue(value: SQLInputValue, declaredType: string): unknown {
  if (typeof value === "bigint") {
    // GeoPackage BOOLEAN columns are stored as INTEGER 0/1.
    if (declaredType === "BOOLEAN") return value !== 0n;
    return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : value.toString();
  }
  return value;
}

// Works out the proj4 code to reproject a layer from, given its GeoPackage
// SRS id. Returns WGS84 for no reprojection, or null when the layer's CRS is
// undefined/unusable (the caller then falls back to the user's choice).
function resolveSourceCrs(db: DatabaseSync, srsId: number): string | null {
  // -1 and 0 are the spec's reserved "undefined Cartesian" and "undefined
  // geographic" systems; 4326 is plain WGS 84.
  if (srsId === -1) return null;
  if (srsId === 0) return WGS84;
  const srs = db
    .prepare(
      "SELECT organization, organization_coordsys_id, definition FROM gpkg_spatial_ref_sys WHERE srs_id = ?",
    )
    .get(srsId) as
    | { organization: string; organization_coordsys_id: bigint | number; definition: string }
    | undefined;
  if (!srs) return null;

  if (srs.organization.toUpperCase() === "EPSG") {
    const code = `EPSG:${Number(srs.organization_coordsys_id)}`;
    if (code === WGS84) return WGS84;
    if (isSupportedSourceCrs(code)) return code;
  }
  // Not one of the app's curated systems — let proj4 read the WKT the file
  // carries. proj4 handles WKT1 well; anything it can't parse falls back.
  const definition = srs.definition?.trim();
  if (!definition || definition.toLowerCase() === "undefined") return null;
  const code = `GPKG:${srs.organization}:${Number(srs.organization_coordsys_id)}:${srsId}`;
  try {
    proj4.defs(code, definition);
    proj4(code, WGS84, [0, 0]);
    return code;
  } catch {
    return null;
  }
}

function tableColumns(db: DatabaseSync, table: string): ColumnInfo[] {
  return db
    .prepare(`PRAGMA table_info(${quoteIdentifier(table)})`)
    .all() as unknown as ColumnInfo[];
}

function readRows(db: DatabaseSync, table: string): Row[] {
  const statement = db.prepare(`SELECT * FROM ${quoteIdentifier(table)}`);
  statement.setReadBigInts(true);
  return statement.all() as Row[];
}

interface LayerRead {
  features: GeoJSON.Feature[];
  droppedBlobColumns: Set<string>;
  unreadableGeometries: number;
}

function readLayer(
  db: DatabaseSync,
  table: string,
  layerName: string,
  geometryColumn: string | null,
  // Set when several tables are imported: row ids are only unique within a
  // table, so ids become "<table>.<id>" to stay unique in the output.
  idPrefix: string | null,
): LayerRead {
  const columns = tableColumns(db, table);
  const pkColumn = columns.find((column) => column.pk === 1)?.name;
  const declaredTypes = new Map(columns.map((c) => [c.name, c.type.toUpperCase()]));
  const droppedBlobColumns = new Set<string>();
  let unreadableGeometries = 0;

  const features: GeoJSON.Feature[] = [];
  for (const row of readRows(db, table)) {
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (key === geometryColumn || key === pkColumn) continue;
      if (value instanceof Uint8Array) {
        droppedBlobColumns.add(key);
        continue;
      }
      properties[key] = toPropertyValue(value, declaredTypes.get(key) ?? "");
    }
    if (!("layer" in properties)) properties.layer = layerName;

    const rawId = pkColumn ? row[pkColumn] : undefined;
    const rowId =
      typeof rawId === "bigint" || typeof rawId === "number" || typeof rawId === "string"
        ? (toPropertyValue(rawId, "") as string | number)
        : undefined;
    const id = rowId !== undefined && idPrefix ? `${idPrefix}.${rowId}` : rowId;

    let geometry: GeoJSON.Geometry | null = null;
    const blob = geometryColumn ? row[geometryColumn] : null;
    if (blob instanceof Uint8Array) {
      try {
        geometry = parseGeoPackageGeometry(blob);
      } catch {
        unreadableGeometries++;
      }
    }
    features.push(
      geometry
        ? { type: "Feature", ...(id !== undefined && { id }), properties, geometry }
        : propertiesOnlyFeature(properties, id),
    );
  }
  // A column is dropped as a whole once any row holds binary data in it,
  // rather than appearing on some features and not others.
  if (droppedBlobColumns.size > 0) {
    for (const feature of features) {
      for (const column of droppedBlobColumns) delete feature.properties?.[column];
    }
  }
  return { features, droppedBlobColumns, unreadableGeometries };
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export function convertGeoPackageToGeoJson(
  buffer: ArrayBuffer,
  fallbackSourceCrs: string,
  allowNoGeometry = false,
): GeoPackageConversionResult {
  const db = new DatabaseSync(":memory:");
  try {
    // deserialize() accepts any bytes; a non-SQLite file only fails on the
    // first query, so both belong in this check.
    let hasContents: unknown;
    try {
      db.deserialize(new Uint8Array(buffer));
      hasContents = db
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'gpkg_contents'")
        .get();
    } catch {
      throw new Error("This file isn't a valid GeoPackage (it couldn't be opened as SQLite).");
    }
    if (!hasContents) {
      throw new Error("This file isn't a GeoPackage — it has no gpkg_contents table.");
    }

    const contents = db
      .prepare("SELECT table_name, data_type FROM gpkg_contents ORDER BY table_name")
      .all() as unknown as ContentsRow[];
    const featureTables = contents.filter((c) => c.data_type === "features");
    const attributeTables = contents.filter((c) => c.data_type === "attributes");
    const otherTables = contents.filter(
      (c) => c.data_type !== "features" && c.data_type !== "attributes",
    );

    const warnings: string[] = [];
    if (otherTables.length > 0) {
      warnings.push(
        `Skipped ${plural(otherTables.length, "non-vector table")} (e.g. raster tiles): ${otherTables.map((t) => t.table_name).join(", ")}.`,
      );
    }

    const geometryColumns = new Map(
      (
        db
          .prepare("SELECT table_name, column_name, srs_id FROM gpkg_geometry_columns")
          .all() as unknown as { table_name: string; column_name: string; srs_id: number }[]
      ).map((row) => [row.table_name, row]),
    );

    // A GeoPackage has no per-feature layer concept, so each table becomes a
    // layer — the same way a zip with several Shapefiles is handled.
    const features: GeoJSON.Feature[] = [];
    let geometryCount = 0;
    let unreadableGeometries = 0;
    const droppedBlobColumns = new Set<string>();
    const assumedCrsLayers: string[] = [];

    for (const { table_name: table } of featureTables) {
      const geometryInfo = geometryColumns.get(table);
      const layer = readLayer(
        db,
        table,
        table,
        geometryInfo?.column_name ?? null,
        featureTables.length > 1 ? table : null,
      );
      unreadableGeometries += layer.unreadableGeometries;
      for (const column of layer.droppedBlobColumns) droppedBlobColumns.add(column);

      let sourceCrs = geometryInfo ? resolveSourceCrs(db, Number(geometryInfo.srs_id)) : WGS84;
      if (!sourceCrs) {
        sourceCrs = fallbackSourceCrs;
        assumedCrsLayers.push(table);
      }
      const collection = reprojectFeatureCollection(
        { type: "FeatureCollection", features: layer.features },
        sourceCrs,
      );
      geometryCount += collection.features.filter((f) => f.geometry).length;
      features.push(...collection.features);
    }

    if (assumedCrsLayers.length > 0) {
      warnings.push(
        `${assumedCrsLayers.length === 1 ? `Layer "${assumedCrsLayers[0]}" has` : `Layers ${assumedCrsLayers.map((l) => `"${l}"`).join(", ")} have`} no usable coordinate system, so ${fallbackSourceCrs} was assumed and reprojected accordingly.`,
      );
    }
    if (unreadableGeometries > 0) {
      warnings.push(
        unreadableGeometries === 1
          ? "1 geometry couldn't be read (e.g. a curved geometry type) and was imported with properties only."
          : `${unreadableGeometries} geometries couldn't be read (e.g. curved geometry types) and were imported with properties only.`,
      );
    }

    // Non-spatial tables only make sense to import when there's nothing else;
    // mixed in with real layers they'd just be unlocated clutter.
    if (featureTables.length > 0 && attributeTables.length > 0) {
      warnings.push(
        `Skipped ${plural(attributeTables.length, "table")} without geometry: ${attributeTables.map((t) => t.table_name).join(", ")}.`,
      );
    }
    if (featureTables.length === 0) {
      for (const { table_name: table } of attributeTables) {
        const layer = readLayer(db, table, table, null, attributeTables.length > 1 ? table : null);
        for (const column of layer.droppedBlobColumns) droppedBlobColumns.add(column);
        features.push(...layer.features);
      }
    }

    if (droppedBlobColumns.size > 0) {
      warnings.push(
        `Binary columns can't be stored as GeoJSON properties and were left out: ${[...droppedBlobColumns].join(", ")}.`,
      );
    }

    if (features.length === 0) {
      warnings.push("No features were found in this GeoPackage.");
      return { featureCollection: { type: "FeatureCollection", features }, warnings };
    }
    if (geometryCount === 0) {
      if (!allowNoGeometry) {
        throw new NoGeometryError(
          featureTables.length === 0
            ? "This GeoPackage only has tables without geometry."
            : "None of the features in this GeoPackage have a geometry.",
          features.length,
        );
      }
      warnings.push(propertiesOnlyWarning(features.length, "record"));
    }

    return { featureCollection: { type: "FeatureCollection", features }, warnings };
  } finally {
    db.close();
  }
}
