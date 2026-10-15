// Thrown by a converter when its source has records but no geometry could be
// identified for any of them. The API reports it with NO_GEOMETRY_ERROR_CODE
// so the UI can ask whether to import the records with properties only, and
// retry with `allowNoGeometry` set if the user agrees.
export const NO_GEOMETRY_ERROR_CODE = "no-geometry";

export class NoGeometryError extends Error {
  constructor(
    message: string,
    readonly recordCount: number,
  ) {
    super(message);
    this.name = "NoGeometryError";
  }
}

// GeoJSON allows an unlocated feature (`"geometry": null`), but @types/geojson's
// default Feature type doesn't. Rather than widen that type through the whole
// app, properties-only features are built here and the few places that read a
// feature's geometry treat it as possibly null.
export function propertiesOnlyFeature(
  properties: GeoJSON.GeoJsonProperties,
  id?: string | number,
): GeoJSON.Feature {
  return {
    type: "Feature",
    ...(id !== undefined && { id }),
    properties,
    geometry: null as unknown as GeoJSON.Geometry,
  };
}

export function propertiesOnlyWarning(count: number, noun: string): string {
  const records = count === 1 ? `1 ${noun} was` : `${count} ${noun}s were`;
  const them = count === 1 ? "it won't" : "they won't";
  return `No geometry was identified, so ${records} imported with properties only — ${them} appear on the map.`;
}
