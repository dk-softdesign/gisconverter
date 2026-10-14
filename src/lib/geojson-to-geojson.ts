import { isSupportedSourceCrs } from "#/lib/crs";
import { NoGeometryError, propertiesOnlyFeature, propertiesOnlyWarning } from "#/lib/no-geometry";
import { reprojectGeometry, ensureCrsDefsRegistered, WGS84 } from "#/lib/reproject";

export interface GeoJsonConversionResult {
  featureCollection: GeoJSON.FeatureCollection;
  warnings: string[];
}

const GEOMETRY_TYPES = new Set([
  "Point",
  "MultiPoint",
  "LineString",
  "MultiLineString",
  "Polygon",
  "MultiPolygon",
  "GeometryCollection",
]);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isGeometry(value: unknown): value is GeoJSON.Geometry {
  return isObject(value) && typeof value.type === "string" && GEOMETRY_TYPES.has(value.type);
}

// Pre-RFC 7946 GeoJSON (the 2008 spec, still written by QGIS/GDAL for
// projected data) can declare its CRS in a top-level `crs` member, e.g.
// `{"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::25832"}}`.
// Returns the matching EPSG code, or null if there's no such member.
function declaredCrs(root: Record<string, unknown>): string | null {
  const crs = root.crs;
  if (!isObject(crs) || !isObject(crs.properties)) return null;
  const name = crs.properties.name;
  if (typeof name !== "string") return null;
  if (/CRS84$/i.test(name)) return WGS84;
  const match = /EPSG:{1,2}(\d+)$/i.exec(name);
  if (!match) throw new Error(`Unrecognized coordinate system in the file's "crs" member: ${name}`);
  return `EPSG:${match[1]}`;
}

function everyPosition(
  geometry: GeoJSON.Geometry,
  test: (p: GeoJSON.Position) => boolean,
): boolean {
  if (geometry.type === "GeometryCollection") {
    return geometry.geometries.every((g) => everyPosition(g, test));
  }
  const visit = (value: unknown): boolean => {
    if (!Array.isArray(value)) return true;
    if (typeof value[0] === "number") return test(value as GeoJSON.Position);
    return value.every(visit);
  };
  return visit(geometry.coordinates);
}

function looksLikeLonLat(features: GeoJSON.Feature[]): boolean {
  return features.every((f) =>
    everyPosition(f.geometry, ([x, y]) => Math.abs(x) <= 180 && Math.abs(y) <= 90),
  );
}

// Accepts a FeatureCollection, a single Feature, or a bare Geometry, and
// returns it as a WGS 84 FeatureCollection. Properties and feature ids are
// kept untouched so the file round-trips through editing/validation as-is.
export function convertGeoJsonToGeoJson(
  text: string,
  fallbackSourceCrs: string,
  allowNoGeometry = false,
): GeoJsonConversionResult {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    throw new Error("This file isn't valid JSON.");
  }
  if (!isObject(root)) throw new Error("This file isn't a GeoJSON object.");

  let candidates: unknown[];
  if (root.type === "FeatureCollection") {
    if (!Array.isArray(root.features)) {
      throw new Error('This FeatureCollection has no "features" array.');
    }
    candidates = root.features;
  } else if (root.type === "Feature") {
    candidates = [root];
  } else if (isGeometry(root)) {
    candidates = [{ type: "Feature", properties: {}, geometry: root }];
  } else {
    throw new Error("This file isn't GeoJSON (expected a FeatureCollection, Feature or Geometry).");
  }

  const warnings: string[] = [];
  const features: GeoJSON.Feature[] = [];
  const withoutGeometry: GeoJSON.Feature[] = [];
  let invalid = 0;
  for (const candidate of candidates) {
    if (!isObject(candidate) || candidate.type !== "Feature") {
      invalid++;
      continue;
    }
    if (!isGeometry(candidate.geometry)) {
      if (candidate.geometry == null) {
        const properties = isObject(candidate.properties) ? candidate.properties : {};
        const id =
          typeof candidate.id === "string" || typeof candidate.id === "number"
            ? candidate.id
            : undefined;
        withoutGeometry.push(propertiesOnlyFeature(properties, id));
      } else invalid++;
      continue;
    }
    // Strip any feature-level bbox: it would be stale after reprojection.
    const { bbox: _bbox, ...feature } = candidate as unknown as GeoJSON.Feature;
    features.push({ ...feature, properties: feature.properties ?? {} });
  }
  if (features.length === 0 && withoutGeometry.length > 0) {
    const reason = "None of the features in this file have a geometry.";
    if (!allowNoGeometry) throw new NoGeometryError(reason, withoutGeometry.length);
    warnings.push(propertiesOnlyWarning(withoutGeometry.length, "feature"));
    if (invalid > 0) {
      warnings.push(`Skipped ${invalid} invalid feature${invalid === 1 ? "" : "s"}.`);
    }
    return {
      featureCollection: { type: "FeatureCollection", features: withoutGeometry },
      warnings,
    };
  }
  if (withoutGeometry.length > 0) {
    warnings.push(
      `Skipped ${withoutGeometry.length} feature${withoutGeometry.length === 1 ? "" : "s"} without a geometry.`,
    );
  }
  if (invalid > 0) {
    warnings.push(`Skipped ${invalid} invalid feature${invalid === 1 ? "" : "s"}.`);
  }
  if (features.length === 0) {
    warnings.push("No features with a geometry were found in this file.");
  }

  // RFC 7946 GeoJSON is always WGS 84, but files exported with projected
  // coordinates and no `crs` member are common, so fall back to the selected
  // source CRS when the numbers can't be lon/lat.
  let sourceCrs = declaredCrs(root);
  if (sourceCrs && !isSupportedSourceCrs(sourceCrs)) {
    throw new Error(`Unsupported coordinate system declared in this file: ${sourceCrs}`);
  }
  if (!sourceCrs) {
    if (looksLikeLonLat(features)) {
      sourceCrs = WGS84;
    } else {
      sourceCrs = fallbackSourceCrs;
      warnings.push(
        `This GeoJSON's coordinates aren't longitude/latitude and it declares no coordinate system, so it was assumed to be in ${fallbackSourceCrs} and reprojected accordingly.`,
      );
    }
  }

  if (sourceCrs !== WGS84) ensureCrsDefsRegistered();
  return {
    featureCollection: {
      type: "FeatureCollection",
      features:
        sourceCrs === WGS84
          ? features
          : features.map((f) => ({ ...f, geometry: reprojectGeometry(f.geometry, sourceCrs) })),
    },
    warnings,
  };
}
