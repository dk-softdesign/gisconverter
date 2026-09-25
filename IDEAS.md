# Ideas

Brainstormed feature/UI ideas for GIS Converter. Not commitments — just a backlog to pull from.

## More formats (in and out)

- Inputs: KML/KMZ, GPX, GML, GeoPackage (.gpkg), CSV with a WKT column.
- Outputs beyond GeoJSON: Shapefile (zip), KML, CSV/Excel (flattened properties + WKT or
  lat/lon), GeoPackage. Conversion is currently one-directional into GeoJSON only.
- Multi-file / batch: drop a folder or several files at once, convert each, merge into one
  map/session with per-file layers.

## Map & visualization

- Base map switcher (OSM / satellite / a Danish source like Dataforsyningen/Kortforsyningen
  WMTS, since this app targets Danish DXF exports).
- Measurement tools (distance/area) and a scale bar.
- Draw/edit geometry on the map (add a point, move a vertex) instead of only editing
  attribute tables.
- Color-by-attribute / choropleth styling instead of only color-by-layer.
- Cluster markers for point-heavy exports (Excel imports could get huge).

## Data table / editing

- Sortable, resizable columns in the feature list (currently a flat list).
- Inline cell editing in the table itself, not just the modal dialog.
- Undo/redo for property edits and bulk edits.
- CSV/Excel export of just the attribute table (no geometry) for non-GIS stakeholders.
- Validation/repair pass: flag invalid geometries (self-intersections, unclosed polygons)
  with a "fix" action.

## Advanced property cleanup

Today's bulk edit (`bulk-edit-dialog.tsx`) only sets one key to one literal value across the
selection — no search/replace, no preview, no undo. In progress: redesigning it into a tabbed
dialog with three modes:

- **Set value** — today's existing behavior, kept as the simple default.
- **Find & replace** — regex pattern + replacement (with capture groups), scoped to one
  property key or all of them, case-insensitive toggle. Covers most real cleanup (trim
  whitespace, normalize casing, strip leading zeros) without needing code.
- **Custom JS** — power-user escape hatch: a snippet like
  `return { ...props, name: props.name.trim().toUpperCase() }` run per-feature via
  `new Function`. No sandboxing needed since this is client-side only; wrap each per-feature
  call in try/catch so one bad row doesn't abort the batch.

All three modes share a live before/after preview (sample rows + "N of M changed / N errored")
before the user commits, since bulk mutation is otherwise blind and un-undoable. Undo for bulk
ops in general is still a separate, unimplemented idea (see above).

## Workflow / UX

- Conversion history — no backend persistence today, so at least a local "recent
  conversions" list (IndexedDB) would survive a refresh.
- Shareable link / saved session: export a `.json` "project" bundling the GeoJSON + edits +
  hidden layers + filters, reloadable later.
- Progress feedback for large files (the convert button just spins — a % or feature count
  would help for big shapefiles/Excel).
- Diff/compare mode: upload two files and see what changed (handy for surveyors re-exporting).
- Keyboard shortcuts (e.g. `/` to focus search, `Esc` to close dialogs).

## Danish-specific niceties

- Auto-detect CRS from a `.prj`-less DXF by sanity-checking coordinate ranges against known
  Danish zones, suggesting the likely one instead of defaulting silently.
- One-click reverse conversion: WGS84 GeoJSON → EPSG:25832 DXF/Shapefile for round-tripping
  back to Danish survey tools.

## Small UI polish

- Richer empty/onboarding state than just the drop zone — maybe sample files to try.
- Show file size/feature count before conversion, not just after.
- Dark-mode-aware map tiles (satellite/dark tiles) — there's already a theme toggle, but the
  map always uses light OSM tiles.

## Priority picks

Highest value given the current architecture:

1. KML/GPX import
2. Shapefile/KML export
3. Inline table editing + undo
