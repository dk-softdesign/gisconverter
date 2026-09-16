// Property values arrive from very different sources (DXF text, Excel cells,
// DBF fields) and this app treats them as string | number | boolean | null.
// When a user types a replacement value in an edit form, infer the same kind
// of type a spreadsheet would, rather than always producing a string.
export function coercePropertyValue(input: string): string | number | boolean | null {
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
