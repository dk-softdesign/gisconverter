#!/usr/bin/env node
// Split a GeoJSON FeatureCollection into one file per postal code.
//
// Usage:
//   node scripts/split-by-postnr.mjs <input.geojson> [outDir] [--key=<property>]
//
// Each output file is named "<postnr>_<input basename>", e.g.
// "3600_belysning_v2.geojson". The property defaults to "straeknings_postnr";
// if no feature has that exact key, any key ending in it is used instead
// (e.g. "asstraeknings_postnr" from some exports).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const args = process.argv.slice(2);
const keyArg = args.find((a) => a.startsWith("--key="));
const [input, outDirArg] = args.filter((a) => !a.startsWith("--"));

if (!input) {
  console.error(
    "Usage: node scripts/split-by-postnr.mjs <input.geojson> [outDir] [--key=<property>]",
  );
  process.exit(1);
}

const wantedKey = keyArg ? keyArg.slice("--key=".length) : "straeknings_postnr";
const outDir = outDirArg ?? dirname(input);

const data = JSON.parse(readFileSync(input, "utf8"));
if (data?.type !== "FeatureCollection" || !Array.isArray(data.features)) {
  console.error(`${input} is not a GeoJSON FeatureCollection`);
  process.exit(1);
}

function resolveKey(features, wanted) {
  const keys = new Set();
  for (const f of features) for (const k of Object.keys(f.properties ?? {})) keys.add(k);
  if (keys.has(wanted)) return wanted;
  const fallback = [...keys].find((k) => k.endsWith(wanted));
  if (fallback) return fallback;
  console.error(`No property "${wanted}" found. Available: ${[...keys].join(", ")}`);
  process.exit(1);
}

const key = resolveKey(data.features, wantedKey);
if (key !== wantedKey) console.log(`Using property "${key}" (matched "${wantedKey}")`);

const groups = new Map();
for (const feature of data.features) {
  const value = feature.properties?.[key];
  const postnr =
    value === null || value === undefined || value === "" ? "unknown" : String(value).trim();
  if (!groups.has(postnr)) groups.set(postnr, []);
  groups.get(postnr).push(feature);
}

mkdirSync(outDir, { recursive: true });
const { features: _features, ...rest } = data; // keep top-level members like crs/name
const name = basename(input);

for (const [postnr, features] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
  const file = join(outDir, `${postnr.replace(/[^\w-]/g, "_")}_${name}`);
  writeFileSync(file, JSON.stringify({ ...rest, features }, null, 2));
  console.log(`${postnr}: ${features.length} features -> ${file}`);
}
