// @types/shpjs on npm is written for an older, CommonJS-shaped version of
// this package; the installed version (6.x) is pure ESM with named exports,
// so we declare the real shape ourselves instead of installing that package.
declare module "shpjs" {
  interface ShpFeatureCollection extends GeoJSON.FeatureCollection {
    fileName?: string;
  }

  export function parseZip(
    buffer: ArrayBuffer | ArrayBufferView,
    whiteList?: string[],
  ): Promise<ShpFeatureCollection | ShpFeatureCollection[]>;
}
