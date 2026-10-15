#!/usr/bin/env node
// Check that a property (default "equipment") is unique within each GeoJSON file.
//
// Usage:
//   node scripts/check-unique-equipment.mjs [dir-or-files...] [--key=<property>]
//
// Defaults to every *.geojson in temp/by-postnr. Uniqueness is checked per file,
// not across files. Features missing the property are reported separately.
// Exits with code 1 if any file has duplicates or missing values.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const keyArg = args.find((a) => a.startsWith("--key="));
const key = keyArg ? keyArg.slice("--key=".length) : "equipment";
const targets = args.filter((a) => !a.startsWith("--"));
if (targets.length === 0) targets.push("temp/by-postnr");

const files = targets.flatMap((t) =>
  statSync(t).isDirectory()
    ? readdirSync(t)
        .filter((f) => f.endsWith(".geojson"))
        .sort()
        .map((f) => join(t, f))
    : [t],
);

let failed = false;

for (const file of files) {
  const { features = [] } = JSON.parse(readFileSync(file, "utf8"));
  const seen = new Map(); // value -> feature indexes
  const missing = [];

  features.forEach((feature, i) => {
    const value = feature.properties?.[key];
    if (value === null || value === undefined || value === "") {
      missing.push(i);
      return;
    }
    const id = String(value).trim();
    if (!seen.has(id)) seen.set(id, []);
    seen.get(id).push(i);
  });

  const duplicates = [...seen].filter(([, idx]) => idx.length > 1);
  const ok = duplicates.length === 0 && missing.length === 0;
  if (!ok) failed = true;

  console.log(
    `${ok ? "OK  " : "FAIL"} ${file}: ${features.length} features, ${seen.size} unique "${key}"` +
      (duplicates.length ? `, ${duplicates.length} duplicated` : "") +
      (missing.length ? `, ${missing.length} missing` : ""),
  );
  for (const [value, idx] of duplicates) {
    const ids = idx.map((i) => features[i].properties?.id ?? `#${i}`).join(", ");
    console.log(`       ${key}=${value} appears ${idx.length}x (id: ${ids})`);
  }
  if (missing.length) {
    const ids = missing.map((i) => features[i].properties?.id ?? `#${i}`).join(", ");
    console.log(`       missing ${key} (id: ${ids})`);
  }
}

process.exit(failed ? 1 : 0);
