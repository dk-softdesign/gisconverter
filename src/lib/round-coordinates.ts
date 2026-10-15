type Position = GeoJSON.Position;

function roundPosition(position: Position, factor: number): Position {
  return position.map((value) => Math.round(value * factor) / factor);
}

function roundGeometry(geometry: GeoJSON.Geometry, factor: number): GeoJSON.Geometry {
  switch (geometry.type) {
    case "Point":
      return { ...geometry, coordinates: roundPosition(geometry.coordinates, factor) };
    case "MultiPoint":
    case "LineString":
      return {
        ...geometry,
        coordinates: geometry.coordinates.map((p) => roundPosition(p, factor)),
      };
    case "MultiLineString":
    case "Polygon":
      return {
        ...geometry,
        coordinates: geometry.coordinates.map((ring) => ring.map((p) => roundPosition(p, factor))),
      };
    case "MultiPolygon":
      return {
        ...geometry,
        coordinates: geometry.coordinates.map((polygon) =>
          polygon.map((ring) => ring.map((p) => roundPosition(p, factor))),
        ),
      };
    case "GeometryCollection":
      return { ...geometry, geometries: geometry.geometries.map((g) => roundGeometry(g, factor)) };
  }
}

// Trims coordinates to a number of decimal places for export — in WGS 84,
// 6 decimals is roughly 10 cm, which is plenty for most uses and noticeably
// shrinks the file.
export function roundCoordinates(
  collection: GeoJSON.FeatureCollection,
  decimals: number,
): GeoJSON.FeatureCollection {
  const factor = 10 ** decimals;
  return {
    ...collection,
    features: collection.features.map((feature) =>
      feature.geometry
        ? { ...feature, geometry: roundGeometry(feature.geometry, factor) }
        : feature,
    ),
  };
}
