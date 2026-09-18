// A curated, visually-distinct palette. Layers are mapped onto it
// deterministically by name so the same layer always gets the same color
// across a session, without needing color info from the source file.
const PALETTE = [
  "#2563eb",
  "#dc2626",
  "#16a34a",
  "#d97706",
  "#9333ea",
  "#0891b2",
  "#db2777",
  "#65a30d",
  "#ea580c",
  "#4f46e5",
  "#0d9488",
  "#c026d3",
  "#ca8a04",
  "#059669",
  "#e11d48",
];

export const UNNAMED_LAYER = "(no layer)";

export function layerNameOf(layer: unknown): string {
  return typeof layer === "string" && layer.length > 0 ? layer : UNNAMED_LAYER;
}

// When converting a batch of files together, each feature is stamped with a
// `source` property (the uploaded file it came from) so the legend can group
// by file instead of by each format's own layer concept. Single-file
// conversions never set `source`, so this falls back to `layerNameOf`
// exactly as before.
export function groupNameOf(feature: GeoJSON.Feature): string {
  const source = feature.properties?.source;
  if (typeof source === "string" && source.length > 0) return source;
  return layerNameOf(feature.properties?.layer);
}

export function getLayerColor(layer: string): string {
  let hash = 0;
  for (let i = 0; i < layer.length; i++) {
    hash = (hash * 31 + layer.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}
