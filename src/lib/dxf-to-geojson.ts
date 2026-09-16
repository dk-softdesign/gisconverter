import { Helper } from "dxf";

export interface DxfConversionResult {
  featureCollection: GeoJSON.FeatureCollection;
  warnings: string[];
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

export function convertDxfToGeoJson(dxfText: string): DxfConversionResult {
  const helper = new Helper(dxfText);
  if (!helper.parsed) {
    throw new Error("Could not parse DXF file");
  }

  const warnings: string[] = [];
  const features: GeoJSON.Feature[] = [];

  const { polylines } = helper.toPolylines() as unknown as { polylines: DxfPolyline[] };
  for (const polyline of polylines) {
    const vertices = polyline.vertices;
    if (vertices.length < 2) continue;
    const layer = polyline.layer?.name ?? null;
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

  const denormalised = (helper.denormalised ?? []) as unknown as DxfEntity[];
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
    } else if (!CURVE_ENTITY_TYPES.has(entity.type)) {
      skippedTypes.add(entity.type);
    }
  }

  if (skippedTypes.size > 0) {
    warnings.push(`Skipped unsupported entity types: ${[...skippedTypes].sort().join(", ")}`);
  }
  if (features.length === 0) {
    warnings.push("No convertible geometry was found in this DXF file.");
  }

  return {
    featureCollection: { type: "FeatureCollection", features },
    warnings,
  };
}
