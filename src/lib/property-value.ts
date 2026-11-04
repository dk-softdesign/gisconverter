// oxlint-disable typescript/no-base-to-string
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

// Some values are HTML — most often KML descriptions from Google Earth or
// ArcGIS. For display only, turn them into readable text: line breaks for
// block elements, " | " between table cells. The stored value is never
// changed, so an export writes the HTML back exactly as it was read. Parsed
// with DOMParser as an inert document (no scripts run, nothing is fetched)
// and only text is read out, so the markup can't affect the page.
const LOOKS_LIKE_HTML = /<\/?[a-z][a-z0-9]*(\s[^<>]*)?\/?>/i;
const BLOCK_TAGS = new Set([
  "BR",
  "P",
  "DIV",
  "TR",
  "LI",
  "UL",
  "OL",
  "TABLE",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
]);
const SKIPPED_TAGS = new Set(["SCRIPT", "STYLE", "HEAD", "TITLE"]);

export function isHtmlValue(value: unknown): boolean {
  return typeof value === "string" && LOOKS_LIKE_HTML.test(value);
}

export function propertyValueToDisplayText(value: unknown): string {
  const text = propertyValueToInputString(value);
  if (!LOOKS_LIKE_HTML.test(text) || typeof DOMParser === "undefined") return text;
  const body = new DOMParser().parseFromString(text, "text/html").body;
  let out = "";
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += (node.textContent ?? "").replace(/\s+/g, " ");
      return;
    }
    if (!(node instanceof Element)) return;
    const tag = node.tagName.toUpperCase();
    if (SKIPPED_TAGS.has(tag)) return;
    if (tag === "TD" || tag === "TH") {
      // A row starts on a new line, so only later cells get a separator.
      if (out && !out.endsWith("\n")) out += " | ";
    } else if (BLOCK_TAGS.has(tag)) {
      out += "\n";
    }
    for (const child of Array.from(node.childNodes)) walk(child);
    if (BLOCK_TAGS.has(tag)) out += "\n";
  };
  walk(body);
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}
