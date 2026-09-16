import { Helper } from "dxf";
import proj4 from "proj4";

import { SUPPORTED_SOURCE_CRS } from "#/lib/crs";

export interface DxfConversionResult {
  featureCollection: GeoJSON.FeatureCollection;
  warnings: string[];
}

const WGS84 = "EPSG:4326";

let crsDefsRegistered = false;
function ensureCrsDefsRegistered() {
  if (crsDefsRegistered) return;
  for (const crs of SUPPORTED_SOURCE_CRS) {
    proj4.defs(crs.code, crs.proj4);
  }
  crsDefsRegistered = true;
}

function reprojectPosition(position: GeoJSON.Position, sourceCrs: string): GeoJSON.Position {
  const [x, y, ...rest] = position;
  const [lon, lat] = proj4(sourceCrs, WGS84, [x, y]);
  return rest.length > 0 ? [lon, lat, ...rest] : [lon, lat];
}

// The DXF entities this module produces only ever become one of these three
// geometry types (see the feature-building loop below).
type SupportedGeometry = GeoJSON.Point | GeoJSON.LineString | GeoJSON.Polygon;

function reprojectGeometry(geometry: SupportedGeometry, sourceCrs: string): SupportedGeometry {
  if (geometry.type === "Point") {
    return { ...geometry, coordinates: reprojectPosition(geometry.coordinates, sourceCrs) };
  }
  if (geometry.type === "LineString") {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((p) => reprojectPosition(p, sourceCrs)),
    };
  }
  return {
    ...geometry,
    coordinates: geometry.coordinates.map((ring) =>
      ring.map((p) => reprojectPosition(p, sourceCrs)),
    ),
  };
}

interface DxfTransform {
  x?: number;
  y?: number;
  scaleX?: number;
  scaleY?: number;
  rotation?: number;
  extrusionZ?: number;
}

interface DxfPolyline {
  vertices: [number, number][];
  layer?: { name?: string } | null;
}

interface DxfEntity {
  type: string;
  x?: number;
  y?: number;
  layer?: string;
  transforms?: DxfTransform[];
  block?: string;
  tag?: string;
  text?: { string?: string };
}

// Entity types whose geometry `Helper#toPolylines` already resolves to line
// segments (including bulge arcs, block-inserted copies, and interpolated
// curves). POINT is handled separately since it has no line representation.
const CURVE_ENTITY_TYPES = new Set([
  "LINE",
  "LWPOLYLINE",
  "POLYLINE",
  "CIRCLE",
  "ARC",
  "ELLIPSE",
  "SPLINE",
]);

function applyTransforms(x: number, y: number, transforms: DxfTransform[] = []): [number, number] {
  let px = x;
  let py = y;
  for (const t of transforms) {
    if (t.scaleX) px *= t.scaleX;
    if (t.scaleY) py *= t.scaleY;
    if (t.rotation) {
      const angle = (t.rotation / 180) * Math.PI;
      const rx = px * Math.cos(angle) - py * Math.sin(angle);
      const ry = py * Math.cos(angle) + px * Math.sin(angle);
      px = rx;
      py = ry;
    }
    if (t.x) px += t.x;
    if (t.y) py += t.y;
    if (t.extrusionZ === -1) px = -px;
  }
  return [px, py];
}

function isClosedRing(vertices: [number, number][]): boolean {
  if (vertices.length < 4) return false;
  const [x1, y1] = vertices[0];
  const [x2, y2] = vertices[vertices.length - 1];
  return Math.abs(x1 - x2) < 1e-9 && Math.abs(y1 - y2) < 1e-9;
}

// An INSERT (a block placed on the drawing, e.g. a valve or tree symbol) can
// be followed by one ATTRIB entity per named attribute the block defines
// (e.g. DIAMETER, MATERIAL, ID) — these hold the real per-instance values a
// user typed in when placing that symbol. ATTDEF, in contrast, only lives
// inside the block *definition* as a template/default and carries no
// per-instance data, so there's nothing useful to pull out of it.
//
// The `dxf` package doesn't link an ATTRIB back to its owning INSERT, but
// ATTRIB entities always immediately follow their INSERT in the raw entity
// list, so we recover the association positionally. This only covers
// top-level inserts (not one block referencing another), which covers the
// common case of attributed point symbols placed directly on the drawing.
function extractAttributedInsertFeatures(entities: DxfEntity[]): GeoJSON.Feature[] {
  const features: GeoJSON.Feature[] = [];

  for (let i = 0; i < entities.length; i++) {
    const insert = entities[i];
    if (insert.type !== "INSERT" || typeof insert.x !== "number" || typeof insert.y !== "number") {
      continue;
    }

    const attributes: Record<string, string> = {};
    let j = i + 1;
    while (j < entities.length && entities[j].type === "ATTRIB") {
      const tag = entities[j].tag;
      if (tag) attributes[tag] = entities[j].text?.string ?? "";
      j++;
    }

    if (Object.keys(attributes).length === 0) continue;

    features.push({
      type: "Feature",
      properties: { ...attributes, block: insert.block ?? null, layer: insert.layer ?? null },
      geometry: { type: "Point", coordinates: [insert.x, insert.y] },
    });
  }

  return features;
}

export function convertDxfToGeoJson(dxfText: string, sourceCrs: string): DxfConversionResult {
  ensureCrsDefsRegistered();

  const helper = new Helper(dxfText);
  if (!helper.parsed) {
    throw new Error("Could not parse DXF file");
  }

  const warnings: string[] = [];
  const features: GeoJSON.Feature[] = [];

  const denormalised = (helper.denormalised ?? []) as unknown as DxfEntity[];

  // `toPolylines()` maps 1:1 over the same denormalised entity list (in the
  // same order), so we zip them by index to recover each polyline's real
  // layer name. `polyline.layer` is only the DXF's LAYER *table* entry,
  // which isn't guaranteed to exist for every layer name actually used.
  const { polylines } = helper.toPolylines() as unknown as { polylines: DxfPolyline[] };
  for (const [index, polyline] of polylines.entries()) {
    const vertices = polyline.vertices;
    if (vertices.length < 2) continue;
    const layer = denormalised[index]?.layer ?? null;
    if (isClosedRing(vertices)) {
      features.push({
        type: "Feature",
        properties: { layer },
        geometry: { type: "Polygon", coordinates: [vertices] },
      });
    } else {
      features.push({
        type: "Feature",
        properties: { layer },
        geometry: { type: "LineString", coordinates: vertices },
      });
    }
  }

  const skippedTypes = new Set<string>();
  for (const entity of denormalised) {
    if (entity.type === "POINT") {
      if (typeof entity.x !== "number" || typeof entity.y !== "number") continue;
      const coordinates = applyTransforms(entity.x, entity.y, entity.transforms);
      features.push({
        type: "Feature",
        properties: { layer: entity.layer ?? null },
        geometry: { type: "Point", coordinates },
      });
    } else if (entity.type !== "ATTRIB" && !CURVE_ENTITY_TYPES.has(entity.type)) {
      skippedTypes.add(entity.type);
    }
  }

  const rawEntities = (helper.parsed.entities ?? []) as unknown as DxfEntity[];
  features.push(...extractAttributedInsertFeatures(rawEntities));

  if (skippedTypes.size > 0) {
    warnings.push(`Skipped unsupported entity types: ${[...skippedTypes].sort().join(", ")}`);
  }
  if (features.length === 0) {
    warnings.push("No convertible geometry was found in this DXF file.");
  }

  const reprojected =
    sourceCrs === WGS84
      ? features
      : features.map((feature) => ({
          ...feature,
          geometry: reprojectGeometry(feature.geometry as SupportedGeometry, sourceCrs),
        }));

  return {
    featureCollection: { type: "FeatureCollection", features: reprojected },
    warnings,
  };
}
