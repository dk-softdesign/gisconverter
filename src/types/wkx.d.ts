// wkx has no published types (and no @types/wkx package), so declare the
// minimal shape we actually use.
//
// NOTE: TypeScript 7.0.2's checker has a bug where a `declare module` member
// named "Geometry" (matching wkx's real export name) whose method returns a
// *different* interface gets its return type resolved incorrectly, no
// matter how that member or interface is declared (const, namespace, plain
// object type, named interface — all reproduce it; a differently-named
// export does not). Since the export must be named "Geometry" to match
// wkx's actual runtime export, the type is declared accurately here for
// documentation, but callers must assert past `.parse()`'s return type
// (see the cast in dxf/excel-to-geojson.ts) until this is fixed upstream.
declare module "wkx" {
  export interface ParsedGeometry {
    srid?: number;
    toGeoJSON(): GeoJSON.Geometry;
  }

  export const Geometry: {
    parse(input: string | Buffer): ParsedGeometry;
  };
}
