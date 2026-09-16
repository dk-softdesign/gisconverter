import proj4 from "proj4";

import { SUPPORTED_SOURCE_CRS } from "#/lib/crs";

export const WGS84 = "EPSG:4326";

let crsDefsRegistered = false;
export function ensureCrsDefsRegistered() {
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

export function reprojectGeometry(geometry: GeoJSON.Geometry, sourceCrs: string): GeoJSON.Geometry {
  switch (geometry.type) {
    case "Point":
      return { ...geometry, coordinates: reprojectPosition(geometry.coordinates, sourceCrs) };
    case "MultiPoint":
    case "LineString":
      return {
        ...geometry,
        coordinates: geometry.coordinates.map((p) => reprojectPosition(p, sourceCrs)),
      };
    case "MultiLineString":
    case "Polygon":
      return {
        ...geometry,
        coordinates: geometry.coordinates.map((ring) =>
          ring.map((p) => reprojectPosition(p, sourceCrs)),
        ),
      };
    case "MultiPolygon":
      return {
        ...geometry,
        coordinates: geometry.coordinates.map((poly) =>
          poly.map((ring) => ring.map((p) => reprojectPosition(p, sourceCrs))),
        ),
      };
    case "GeometryCollection":
      return {
        ...geometry,
        geometries: geometry.geometries.map((g) => reprojectGeometry(g, sourceCrs)),
      };
  }
}

export function reprojectFeatureCollection(
  featureCollection: GeoJSON.FeatureCollection,
  sourceCrs: string,
): GeoJSON.FeatureCollection {
  if (sourceCrs === WGS84) return featureCollection;
  ensureCrsDefsRegistered();
  return {
    ...featureCollection,
    features: featureCollection.features.map((feature) => ({
      ...feature,
      geometry: reprojectGeometry(feature.geometry, sourceCrs),
    })),
  };
}
