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

export function getLayerColor(layer: string): string {
  let hash = 0;
  for (let i = 0; i < layer.length; i++) {
    hash = (hash * 31 + layer.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}
