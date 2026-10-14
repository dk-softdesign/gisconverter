// Property values arrive from very different sources (DXF text, Excel cells,
// DBF fields) and this app treats them as string | number | boolean | null.
export type PropertyValue = string | number | boolean | null;
export type PropertyRecord = Record<string, PropertyValue>;

// When a user types a replacement value in an edit form, infer the same kind
// of type a spreadsheet would, rather than always producing a string.
export function coercePropertyValue(input: string): PropertyValue {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return input;
}

export function propertyValueToInputString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

// Date-only source values (Excel date cells, DBF "D" fields) become ISO dates
// (yyyy-mm-dd) rather than timestamps. `clock` is the clock the Date was built
// on: ExcelJS builds dates in UTC, while shpjs/parsedbf builds DBF dates at
// local midnight — reading those as UTC would shift them a day back in any
// timezone east of UTC (e.g. Denmark). A UTC date with a real time of day is a
// datetime, so it keeps the full ISO timestamp.
export function dateToPropertyValue(date: Date, clock: "utc" | "local"): string {
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  if (clock === "local") {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }
  const iso = date.toISOString();
  return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso;
}
