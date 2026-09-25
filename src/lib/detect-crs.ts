import proj4 from "proj4";

import { ensureCrsDefsRegistered, WGS84 } from "#/lib/reproject";

type LonLatBox = [minLon: number, minLat: number, maxLon: number, maxLat: number];

const DENMARK: LonLatBox = [7.8, 54.5, 15.3, 57.8];

// Candidates in order of preference, each with the area (lon/lat) its
// coordinates should land in. Several candidates can fit the same numbers, so
// the order matters: EPSG:25832 is by far the most common, EPSG:23032 (ED50)
// differs from it by only ~200 m so it comes last, and EPSG:25833 (Bornholm)
// also fits as EPSG:25832 in South Jutland. DKTM zones are checked against
// their own region, since the same numbers read in the wrong DKTM zone still
// land somewhere in or near Denmark.
const CANDIDATES: { code: string; area: LonLatBox }[] = [
  { code: WGS84, area: DENMARK },
  { code: "EPSG:25832", area: DENMARK },
  { code: "EPSG:4093", area: [7.8, 54.7, 10.0, 57.8] },
  { code: "EPSG:4094", area: [9.6, 54.7, 11.0, 55.7] },
  { code: "EPSG:4095", area: [10.8, 54.5, 12.8, 56.2] },
  { code: "EPSG:4096", area: [14.6, 54.9, 15.3, 55.4] },
  { code: "EPSG:25833", area: [14.6, 54.9, 15.3, 55.4] },
  { code: "EPSG:23032", area: DENMARK },
];

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function collectPositions(geometry: GeoJSON.Geometry, out: GeoJSON.Position[]) {
  if (geometry.type === "GeometryCollection") {
    for (const g of geometry.geometries) collectPositions(g, out);
    return;
  }
  const visit = (value: unknown): void => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === "number") out.push(value as GeoJSON.Position);
    else for (const item of value) visit(item);
  };
  visit(geometry.coordinates);
}

function landsIn(code: string, centre: number[], area: LonLatBox): boolean {
  const [lon, lat] = code === WGS84 ? centre : proj4(code, WGS84, centre);
  return lon >= area[0] && lon <= area[2] && lat >= area[1] && lat <= area[3];
}

// Returns every candidate CRS that puts these not-yet-reprojected features
// where expected, most likely first. Empty if none puts them in Denmark.
export function matchingSourceCrs(features: GeoJSON.Feature[]): string[] {
  const positions: GeoJSON.Position[] = [];
  for (const feature of features) collectPositions(feature.geometry, positions);
  if (positions.length === 0) return [];
  // The median rather than the mean, so stray points at a block's local
  // origin (0, 0) don't drag the centre away from the real drawing.
  const centre = [median(positions.map((p) => p[0])), median(positions.map((p) => p[1]))];

  ensureCrsDefsRegistered();
  return CANDIDATES.filter(({ code, area }) => landsIn(code, centre, area)).map((c) => c.code);
}
