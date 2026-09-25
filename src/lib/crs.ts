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
  // Danish Transverse Mercator zones. Common in Danish CAD/utility drawings;
  // their -5,000,000 m false northing makes coordinates look like UTM 32N
  // with the leading "6" of the northing dropped.
  {
    code: "EPSG:4093",
    label: "ETRS89 / DKTM1 (EPSG:4093) — Jutland",
    proj4:
      "+proj=tmerc +lat_0=0 +lon_0=9 +k=0.99998 +x_0=200000 +y_0=-5000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs",
  },
  {
    code: "EPSG:4094",
    label: "ETRS89 / DKTM2 (EPSG:4094) — Funen",
    proj4:
      "+proj=tmerc +lat_0=0 +lon_0=10 +k=0.99998 +x_0=400000 +y_0=-5000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs",
  },
  {
    code: "EPSG:4095",
    label: "ETRS89 / DKTM3 (EPSG:4095) — Zealand",
    proj4:
      "+proj=tmerc +lat_0=0 +lon_0=11.75 +k=0.99998 +x_0=600000 +y_0=-5000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs",
  },
  {
    code: "EPSG:4096",
    label: "ETRS89 / DKTM4 (EPSG:4096) — Bornholm",
    proj4:
      "+proj=tmerc +lat_0=0 +lon_0=15 +k=1 +x_0=800000 +y_0=-5000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs",
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

export function crsLabel(code: string): string {
  return SUPPORTED_SOURCE_CRS.find((crs) => crs.code === code)?.label ?? code;
}
