import ExcelJS from "exceljs";

import { findDuplicateGroups, GEOMETRY_DUPLICATE_KEY } from "#/lib/schema-validation";

// Excel refuses cells longer than this; big polygons can exceed it as WKT.
const EXCEL_MAX_CELL_LENGTH = 32767;

const position = (p: GeoJSON.Position) => p.join(" ");
const ring = (ps: GeoJSON.Position[]) => `(${ps.map(position).join(", ")})`;
const rings = (rs: GeoJSON.Position[][]) => `(${rs.map(ring).join(", ")})`;

// Hand-rolled rather than wkx, whose writer needs Node's Buffer in the browser.
function wktBody(geometry: GeoJSON.Geometry): string {
  switch (geometry.type) {
    case "Point":
      return `POINT (${position(geometry.coordinates)})`;
    case "MultiPoint":
      return `MULTIPOINT ${rings(geometry.coordinates.map((p) => [p]))}`;
    case "LineString":
      return `LINESTRING ${ring(geometry.coordinates)}`;
    case "MultiLineString":
      return `MULTILINESTRING ${rings(geometry.coordinates)}`;
    case "Polygon":
      return `POLYGON ${rings(geometry.coordinates)}`;
    case "MultiPolygon":
      return `MULTIPOLYGON (${geometry.coordinates.map(rings).join(", ")})`;
    case "GeometryCollection":
      return `GEOMETRYCOLLECTION (${geometry.geometries.map(wktBody).join(", ")})`;
  }
}

function geometryToWkt(geometry: GeoJSON.Geometry | null): string {
  if (!geometry) return "";
  const wkt = wktBody(geometry);
  return wkt.length > EXCEL_MAX_CELL_LENGTH
    ? "(geometry too large for an Excel cell — see the GeoJSON)"
    : wkt;
}

function cellValue(value: unknown): ExcelJS.CellValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return JSON.stringify(value);
}

// One row per duplicated feature, grouped so each set of duplicates sits
// together, with every property and the geometry as WKT in a `geom` column
// (the same column the Excel importer reads, so the file can be loaded back).
// Feature numbers match the "#n" shown in the validation panel.
export async function duplicatesToExcel(
  layer: string,
  features: GeoJSON.Feature[],
  duplicateKey: string,
): Promise<Blob> {
  const isGeometry = duplicateKey === GEOMETRY_DUPLICATE_KEY;
  const groups = findDuplicateGroups(features, duplicateKey);
  const duplicated = groups.flatMap((group) => group.indexes.map((i) => features[i]));
  const propertyKeys = [...new Set(duplicated.flatMap((f) => Object.keys(f.properties ?? {})))];

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Duplicates");
  sheet.columns = [
    { header: "Duplicate group", key: "group", width: 16 },
    { header: isGeometry ? "Duplicate geometry" : `Duplicate ${duplicateKey}`, width: 24 },
    { header: "Feature #", width: 11 },
    { header: "Duplicates of", width: 18 },
    { header: "Layer", width: 16 },
    ...propertyKeys.map((key) => ({ header: key, width: Math.max(12, key.length + 2) })),
    { header: "Geometry type", width: 16 },
    { header: "geom", width: 60 },
  ];

  groups.forEach((group, groupIndex) => {
    for (const featureIndex of group.indexes) {
      const feature = features[featureIndex];
      const properties = feature.properties ?? {};
      sheet.addRow([
        groupIndex + 1,
        isGeometry ? "(same geometry)" : group.value,
        featureIndex + 1,
        group.indexes
          .filter((i) => i !== featureIndex)
          .map((i) => `#${i + 1}`)
          .join(", "),
        layer,
        ...propertyKeys.map((key) => cellValue(properties[key])),
        feature.geometry?.type ?? "",
        geometryToWkt(feature.geometry),
      ]);
    }
  });

  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } };

  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
