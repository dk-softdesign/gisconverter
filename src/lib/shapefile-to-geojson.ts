import JSZip from "jszip";
import { parseDbf, parseZip } from "shpjs";

import { NoGeometryError, propertiesOnlyFeature, propertiesOnlyWarning } from "#/lib/no-geometry";
import { dateToPropertyValue } from "#/lib/property-value";
import { reprojectFeatureCollection } from "#/lib/reproject";

export interface ShapefileConversionResult {
  featureCollection: GeoJSON.FeatureCollection;
  warnings: string[];
}

function zipEntries(zip: JSZip, extension: string): JSZip.JSZipObject[] {
  return Object.values(zip.files).filter(
    (entry) =>
      !entry.dir &&
      !entry.name.includes("__MACOSX") &&
      entry.name.toLowerCase().endsWith(extension),
  );
}

// A Shapefile's .prj (if present) is WKT for its real coordinate system, and
// `shpjs` reprojects to WGS84 using it automatically. `shpjs` doesn't tell us
// whether it found one, so we check for it ourselves to know whether to fall
// back to the user-selected source CRS.
async function zipHasPrj(buffer: ArrayBuffer): Promise<boolean> {
  const zip = await JSZip.loadAsync(buffer);
  return zipEntries(zip, ".prj").length > 0;
}

// DBF "D" (date) fields come back from parsedbf as Date objects, which would
// otherwise serialize as timestamps; store them as ISO dates instead.
function withIsoDates(properties: GeoJSON.GeoJsonProperties): GeoJSON.GeoJsonProperties {
  if (!properties) return properties;
  return Object.fromEntries(
    Object.entries(properties).map(([key, value]) => [
      key,
      value instanceof Date ? dateToPropertyValue(value, "local") : value,
    ]),
  );
}

// A zip with .dbf attribute tables but no .shp has records and no geometry
// at all. shpjs can't read that as a Shapefile, so read the tables directly.
async function readDbfOnlyRecords(
  buffer: ArrayBuffer,
): Promise<GeoJSON.GeoJsonProperties[] | null> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    return null;
  }
  const dbfEntries = zipEntries(zip, ".dbf");
  if (dbfEntries.length === 0 || zipEntries(zip, ".shp").length > 0) return null;
  const records: GeoJSON.GeoJsonProperties[] = [];
  for (const entry of dbfEntries) {
    const cpgName = entry.name.replace(/\.dbf$/i, ".cpg");
    const cpgEntry = zipEntries(zip, ".cpg").find(
      (e) => e.name.toLowerCase() === cpgName.toLowerCase(),
    );
    const cpg = cpgEntry ? await cpgEntry.async("string") : undefined;
    records.push(...parseDbf(await entry.async("uint8array"), cpg).map(withIsoDates));
  }
  return records;
}

export async function convertShapefileToGeoJson(
  zipBuffer: ArrayBuffer,
  fallbackSourceCrs: string,
  uploadedFileName: string,
  allowNoGeometry = false,
): Promise<ShapefileConversionResult> {
  const warnings: string[] = [];

  let parsed;
  try {
    parsed = await parseZip(zipBuffer);
  } catch {
    const records = await readDbfOnlyRecords(zipBuffer);
    if (!records || records.length === 0) {
      throw new Error(
        "This zip doesn't contain a valid Shapefile (a matching .shp and .dbf pair).",
      );
    }
    const reason = "This zip has a .dbf attribute table but no .shp file with geometry.";
    if (!allowNoGeometry) throw new NoGeometryError(reason, records.length);
    const layer = uploadedFileName.replace(/\.[^./]+$/, "");
    return {
      featureCollection: {
        type: "FeatureCollection",
        features: records.map((properties) =>
          propertiesOnlyFeature(properties?.layer ? properties : { ...properties, layer }),
        ),
      },
      warnings: [propertiesOnlyWarning(records.length, "record")],
    };
  }

  const collections = Array.isArray(parsed) ? parsed : [parsed];

  // A zip can bundle more than one Shapefile (multiple .shp/.dbf/.prj sets).
  // Shapefiles have no per-feature "layer" concept the way DXF does, so tag
  // each feature with which one it came from — this slots straight into the
  // existing layer legend/coloring, and is a no-op single "layer" for the
  // (common) single-Shapefile-per-zip case, which the UI already hides.
  //
  // We use the *uploaded* file name rather than the Shapefile's own internal
  // name (`collection.fileName`): zip entry names have no reliable encoding,
  // so non-ASCII characters in an internal name can come back corrupted,
  // while the uploaded file's name is always the real one from the browser.
  const baseName = uploadedFileName.replace(/\.[^./]+$/, "");

  const features: GeoJSON.Feature[] = [];
  for (const [index, collection] of collections.entries()) {
    const layer = collections.length > 1 ? `${baseName} (${index + 1})` : baseName;
    for (const feature of collection.features) {
      const properties = withIsoDates(feature.properties) ?? {};
      features.push({
        type: "Feature",
        properties: properties.layer ? properties : { ...properties, layer },
        geometry: feature.geometry,
      });
    }
  }

  if (features.length === 0) {
    warnings.push("No features were found in this Shapefile.");
  } else if (features.every((feature) => !feature.geometry)) {
    // Every shape is a null shape: only the .dbf attributes carry data.
    if (!allowNoGeometry) {
      throw new NoGeometryError("Every shape in this Shapefile is empty.", features.length);
    }
    warnings.push(propertiesOnlyWarning(features.length, "record"));
    return { featureCollection: { type: "FeatureCollection", features }, warnings };
  }

  const featureCollection: GeoJSON.FeatureCollection = { type: "FeatureCollection", features };

  if (await zipHasPrj(zipBuffer)) {
    // shpjs already reprojected every coordinate using the .prj it found.
    return { featureCollection, warnings };
  }

  warnings.push(
    `This Shapefile has no .prj (coordinate system) file, so it was assumed to be in ${fallbackSourceCrs} and reprojected accordingly.`,
  );
  return {
    featureCollection: reprojectFeatureCollection(featureCollection, fallbackSourceCrs),
    warnings,
  };
}
