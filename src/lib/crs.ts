export interface CrsDefinition {
  code: string;
  label: string;
  proj4: string;
}

// DXF has no standard way to embed a coordinate reference system, so the
// source CRS has to be told to us. This is a curated list covering the
// projections used in Danish DXF exports (the app's primary use case) rather
// than the full EPSG registry.
export const SUPPORTED_SOURCE_CRS: CrsDefinition[] = [
  {
    code: "EPSG:25832",
    label: "ETRS89 / UTM zone 32N (EPSG:25832) — Denmark (most of the country)",
    proj4: "+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs",
  },
  {
    code: "EPSG:25833",
    label: "ETRS89 / UTM zone 33N (EPSG:25833) — Denmark (Bornholm)",
    proj4: "+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs",
  },
  {
    code: "EPSG:23032",
    label: "ED50 / UTM zone 32N (EPSG:23032) — older Danish surveys",
    proj4:
      "+proj=utm +zone=32 +ellps=intl +towgs84=-87,-98,-121,0,0,0,0 +units=m +no_defs +type=crs",
  },
  {
    code: "EPSG:4326",
    label: "WGS 84 (EPSG:4326) — coordinates are already lon/lat",
    proj4: "+proj=longlat +datum=WGS84 +no_defs",
  },
];

export const DEFAULT_SOURCE_CRS = "EPSG:25832";

export function isSupportedSourceCrs(code: string): boolean {
  return SUPPORTED_SOURCE_CRS.some((crs) => crs.code === code);
}
