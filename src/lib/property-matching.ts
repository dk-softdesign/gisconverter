import type { GisSchema } from "#/lib/gis-schemas";

// How confidently a source property key was matched to a schema property:
// - exact: already spelled exactly like the schema property key — nothing to do.
// - alias: matched the schema's `synch_alias` (the source system's own field
//   name, e.g. a Shapefile DBF field or DXF block attribute tag).
// - name: matched the schema property's key or title, case/diacritics-insensitive.
// - fuzzy: no exact match, but similar enough by edit distance to guess.
// - none: no reasonable match found.
export type MatchConfidence = "exact" | "alias" | "name" | "fuzzy" | "none";

export interface PropertyMatchSuggestion {
  sourceKey: string;
  targetKey: string | null;
  confidence: MatchConfidence;
}

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[][] = Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0));
  for (let i = 0; i < rows; i++) dp[i][0] = i;
  for (let j = 0; j < cols; j++) dp[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

function similarity(a: string, b: string): number {
  if (a.length === 0 && b.length === 0) return 1;
  return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
}

const FUZZY_THRESHOLD = 0.6;

// Suggests, for each distinct property key found in the converted data, the
// schema property it most likely corresponds to — so a batch of source-system
// field names (or arbitrary Excel column headers) can be migrated to the
// schema's own names in one pass instead of by hand.
export function suggestPropertyMatches(
  sourceKeys: string[],
  schema: GisSchema,
): PropertyMatchSuggestion[] {
  const entries = Object.entries(schema.properties);

  const aliasIndex = new Map<string, string>();
  const nameIndex = new Map<string, string>();
  for (const [key, def] of entries) {
    if (def.synch_alias) aliasIndex.set(normalize(def.synch_alias), key);
    nameIndex.set(normalize(key), key);
    if (def.title) nameIndex.set(normalize(def.title), key);
  }

  return sourceKeys.map((sourceKey) => {
    if (sourceKey in schema.properties) {
      return { sourceKey, targetKey: sourceKey, confidence: "exact" as const };
    }

    const normalized = normalize(sourceKey);

    const aliasMatch = aliasIndex.get(normalized);
    if (aliasMatch) return { sourceKey, targetKey: aliasMatch, confidence: "alias" as const };

    const nameMatch = nameIndex.get(normalized);
    if (nameMatch) return { sourceKey, targetKey: nameMatch, confidence: "name" as const };

    let best: { key: string; score: number } | null = null;
    for (const [key, def] of entries) {
      for (const candidate of [key, def.title]) {
        if (typeof candidate !== "string") continue;
        const score = similarity(normalized, normalize(candidate));
        if (score >= FUZZY_THRESHOLD && (!best || score > best.score)) best = { key, score };
      }
    }
    if (best) return { sourceKey, targetKey: best.key, confidence: "fuzzy" as const };

    return { sourceKey, targetKey: null, confidence: "none" as const };
  });
}
