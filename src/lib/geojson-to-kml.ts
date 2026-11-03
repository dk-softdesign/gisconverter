import { getLayerColor, groupNameOf } from "#/lib/layer-colors";

// Writes a GeoJSON FeatureCollection (WGS 84, like everything the converters
// produce) as KML 2.2. Features are grouped into one Folder per layer — the
// same grouping as the map legend — and each folder gets a style in the
// layer's legend color. Properties go into ExtendedData; `name` and
// `description` also become the placemark's own name and description.

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// "#rrggbb" → KML's "aabbggrr".
function kmlColor(hex: string, alpha: string): string {
  const r = hex.slice(1, 3);
  const g = hex.slice(3, 5);
  const b = hex.slice(5, 7);
  return `${alpha}${b}${g}${r}`;
}

function coordinates(positions: GeoJSON.Position[]): string {
  return positions.map((p) => p.join(",")).join(" ");
}

function ring(tag: "outerBoundaryIs" | "innerBoundaryIs", positions: GeoJSON.Position[]): string {
  return `<${tag}><LinearRing><coordinates>${coordinates(positions)}</coordinates></LinearRing></${tag}>`;
}

function polygon(rings: GeoJSON.Position[][]): string {
  const [outer, ...inner] = rings;
  if (!outer) return "";
  return `<Polygon>${ring("outerBoundaryIs", outer)}${inner.map((r) => ring("innerBoundaryIs", r)).join("")}</Polygon>`;
}

function geometryToKml(geometry: GeoJSON.Geometry): string {
  switch (geometry.type) {
    case "Point":
      return `<Point><coordinates>${geometry.coordinates.join(",")}</coordinates></Point>`;
    case "LineString":
      return `<LineString><coordinates>${coordinates(geometry.coordinates)}</coordinates></LineString>`;
    case "Polygon":
      return polygon(geometry.coordinates);
    case "MultiPoint":
      return `<MultiGeometry>${geometry.coordinates.map((c) => geometryToKml({ type: "Point", coordinates: c })).join("")}</MultiGeometry>`;
    case "MultiLineString":
      return `<MultiGeometry>${geometry.coordinates.map((c) => geometryToKml({ type: "LineString", coordinates: c })).join("")}</MultiGeometry>`;
    case "MultiPolygon":
      return `<MultiGeometry>${geometry.coordinates.map(polygon).join("")}</MultiGeometry>`;
    case "GeometryCollection":
      return `<MultiGeometry>${geometry.geometries.map(geometryToKml).join("")}</MultiGeometry>`;
  }
}

function propertyText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value as string | number | boolean);
}

function placemark(feature: GeoJSON.Feature, styleId: string): string {
  const properties = feature.properties ?? {};
  const name = properties.name ?? properties.Name;
  const description = properties.description ?? properties.Description;
  const data = Object.entries(properties)
    .map(
      ([key, value]) =>
        `<Data name="${escapeXml(key)}"><value>${escapeXml(propertyText(value))}</value></Data>`,
    )
    .join("");
  return [
    "<Placemark>",
    name !== undefined && name !== null ? `<name>${escapeXml(propertyText(name))}</name>` : "",
    description !== undefined && description !== null
      ? `<description>${escapeXml(propertyText(description))}</description>`
      : "",
    `<styleUrl>#${styleId}</styleUrl>`,
    data ? `<ExtendedData>${data}</ExtendedData>` : "",
    feature.geometry ? geometryToKml(feature.geometry) : "",
    "</Placemark>",
  ].join("");
}

export function geojsonToKml(collection: GeoJSON.FeatureCollection, documentName: string): string {
  const groups = new Map<string, GeoJSON.Feature[]>();
  for (const feature of collection.features) {
    const group = groupNameOf(feature);
    const list = groups.get(group);
    if (list) list.push(feature);
    else groups.set(group, [feature]);
  }

  const styles: string[] = [];
  const folders: string[] = [];
  let index = 0;
  for (const [group, features] of groups) {
    const styleId = `layer-${index++}`;
    const color = getLayerColor(group);
    styles.push(
      `<Style id="${styleId}">` +
        `<IconStyle><color>${kmlColor(color, "ff")}</color></IconStyle>` +
        `<LineStyle><color>${kmlColor(color, "ff")}</color><width>2</width></LineStyle>` +
        `<PolyStyle><color>${kmlColor(color, "66")}</color></PolyStyle>` +
        `</Style>`,
    );
    folders.push(
      `<Folder><name>${escapeXml(group)}</name>\n${features.map((f) => placemark(f, styleId)).join("\n")}\n</Folder>`,
    );
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kml xmlns="http://www.opengis.net/kml/2.2">',
    "<Document>",
    `<name>${escapeXml(documentName)}</name>`,
    ...styles,
    ...folders,
    "</Document>",
    "</kml>",
    "",
  ].join("\n");
}
