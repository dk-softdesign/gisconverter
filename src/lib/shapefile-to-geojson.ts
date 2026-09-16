import JSZip from "jszip";
import { parseZip } from "shpjs";

import { reprojectFeatureCollection } from "#/lib/reproject";

export interface ShapefileConversionResult {
  featureCollection: GeoJSON.FeatureCollection;
  warnings: string[];
}

// A Shapefile's .prj (if present) is WKT for its real coordinate system, and
// `shpjs` reprojects to WGS84 using it automatically. `shpjs` doesn't tell us
// whether it found one, so we check for it ourselves to know whether to fall
// back to the user-selected source CRS.
async function zipHasPrj(buffer: ArrayBuffer): Promise<boolean> {
  const zip = await JSZip.loadAsync(buffer);
  return Object.values(zip.files).some(
    (entry) =>
      !entry.dir && !entry.name.includes("__MACOSX") && entry.name.toLowerCase().endsWith(".prj"),
  );
}

export async function convertShapefileToGeoJson(
  zipBuffer: ArrayBuffer,
  fallbackSourceCrs: string,
  uploadedFileName: string,
): Promise<ShapefileConversionResult> {
  const warnings: string[] = [];

  let parsed;
  try {
    parsed = await parseZip(zipBuffer);
  } catch {
    throw new Error("This zip doesn't contain a valid Shapefile (a matching .shp and .dbf pair).");
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
      const properties = feature.properties ?? {};
      features.push({
        type: "Feature",
        properties: properties.layer ? properties : { ...properties, layer },
        geometry: feature.geometry,
      });
    }
  }

  if (features.length === 0) {
    warnings.push("No features were found in this Shapefile.");
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
