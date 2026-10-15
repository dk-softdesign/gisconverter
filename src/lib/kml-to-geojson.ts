import { kmlWithFolders, type Folder, type Root } from "@tmcw/togeojson";
import { DOMParser } from "@xmldom/xmldom";
import JSZip from "jszip";

import { NoGeometryError, propertiesOnlyFeature, propertiesOnlyWarning } from "#/lib/no-geometry";

export interface KmlConversionResult {
  featureCollection: GeoJSON.FeatureCollection;
  warnings: string[];
}

// A KMZ is a zip holding one main KML (conventionally `doc.kml`) plus any
// icons/overlays it references. Prefer `doc.kml`, else the first .kml found.
async function kmlFromKmz(buffer: ArrayBuffer): Promise<string> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch {
    throw new Error("This .kmz isn't a valid zip archive.");
  }
  const kmlEntries = Object.values(zip.files).filter(
    (entry) =>
      !entry.dir && !entry.name.includes("__MACOSX") && entry.name.toLowerCase().endsWith(".kml"),
  );
  const main =
    kmlEntries.find((entry) => entry.name.toLowerCase().endsWith("doc.kml")) ?? kmlEntries[0];
  if (!main) throw new Error("This .kmz doesn't contain a .kml file.");
  return main.async("string");
}

function parseKml(text: string): Root {
  let doc;
  try {
    doc = new DOMParser().parseFromString(text, "text/xml");
  } catch {
    throw new Error("This file isn't valid XML.");
  }
  if (doc.getElementsByTagName("kml").length === 0) {
    throw new Error("This file isn't KML (no <kml> root element).");
  }
  return kmlWithFolders(doc);
}

// KML is always WGS 84 lon/lat (the spec allows nothing else), so unlike the
// other formats there's no source CRS to apply. Folders become the `layer`
// property (nested ones joined with " / ") so they slot into the existing
// layer legend; placemarks outside any folder use the uploaded file's name,
// same as a Shapefile.
export async function convertKmlToGeoJson(
  buffer: ArrayBuffer,
  uploadedFileName: string,
  allowNoGeometry = false,
): Promise<KmlConversionResult> {
  const isKmz = uploadedFileName.toLowerCase().endsWith(".kmz");
  const text = isKmz ? await kmlFromKmz(buffer) : new TextDecoder().decode(buffer);
  const root = parseKml(text);
  const baseName = uploadedFileName.replace(/\.[^./]+$/, "");

  const features: GeoJSON.Feature[] = [];
  const withoutGeometry: GeoJSON.Feature[] = [];
  const visit = (children: Root["children"], path: string[]) => {
    for (const child of children) {
      if (child.type === "folder") {
        const folder = child as Folder;
        const name = typeof folder.meta.name === "string" ? folder.meta.name.trim() : "";
        visit(folder.children, name ? [...path, name] : path);
        continue;
      }
      const properties = child.properties ?? {};
      const layer = path.length > 0 ? path.join(" / ") : baseName;
      if (!child.geometry) {
        withoutGeometry.push(
          propertiesOnlyFeature(properties.layer ? properties : { ...properties, layer }, child.id),
        );
        continue;
      }
      features.push({
        type: "Feature",
        ...(child.id !== undefined && { id: child.id }),
        properties: properties.layer ? properties : { ...properties, layer },
        geometry: child.geometry,
      });
    }
  };
  visit(root.children, []);

  const warnings: string[] = [];
  if (features.length === 0 && withoutGeometry.length > 0) {
    const reason = "None of the placemarks in this file have a geometry.";
    if (!allowNoGeometry) throw new NoGeometryError(reason, withoutGeometry.length);
    warnings.push(propertiesOnlyWarning(withoutGeometry.length, "placemark"));
    return {
      featureCollection: { type: "FeatureCollection", features: withoutGeometry },
      warnings,
    };
  }
  if (withoutGeometry.length > 0) {
    warnings.push(
      `Skipped ${withoutGeometry.length} placemark${withoutGeometry.length === 1 ? "" : "s"} without a geometry.`,
    );
  }
  if (features.length === 0) {
    warnings.push("No placemarks with a geometry were found in this file.");
  }

  return { featureCollection: { type: "FeatureCollection", features }, warnings };
}
