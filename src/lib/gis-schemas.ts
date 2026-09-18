// Target-system JSON Schemas (draft 2020-12, plus custom keys) that describe
// what a converted GeoJSON's feature properties should look like. Dropped
// into /schemas at the repo root and picked up automatically here — add a
// new file there and it shows up in the schema picker with no code changes.
const modules = import.meta.glob("/schemas/*.json", { eager: true, import: "default" }) as Record<
  string,
  GisSchema
>;

export interface GisSchemaPropertyDef {
  type?: string;
  format?: string;
  enum?: string[];
  title?: string;
  synch_alias?: string;
  index?: number;
  ui_type?: string;
  readOnly?: boolean;
  default?: unknown;
  excludeFromActions?: boolean;
  [key: string]: unknown;
}

export interface GisSchema {
  $schema?: string;
  type: string;
  properties: Record<string, GisSchemaPropertyDef>;
  required?: string[];
  // dependentSchemas / dependentRequired / layout / relations pass through
  // to ajv (or are ignored by it) untouched — no need to type them here.
  [key: string]: unknown;
}

export interface SchemaEntry {
  id: string;
  label: string;
  schema: GisSchema;
}

function labelFromId(id: string): string {
  return id.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export const schemaRegistry: SchemaEntry[] = Object.entries(modules)
  .map(([path, schema]) => {
    const id = path.replace(/^.*\//, "").replace(/\.json$/, "");
    return { id, label: labelFromId(id), schema };
  })
  .sort((a, b) => a.label.localeCompare(b.label));

export function getSchemaEntry(id: string | null | undefined): SchemaEntry | undefined {
  return schemaRegistry.find((entry) => entry.id === id);
}
