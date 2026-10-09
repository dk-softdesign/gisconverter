# Ideas

Brainstormed feature/UI ideas for GIS Converter. Not commitments, just a backlog to pull from.
What's already built is listed in [FEATURES.md](./FEATURES.md). Remove an idea from here once
it ships.

## Validation & delivery workflow

The app is mostly used to clean utility data (e.g. lighting, cabinets) until it passes a
target-system schema, then hand it over. These ideas tighten that loop.

- **Uniqueness declared in the schema**: a custom keyword such as `"x-unique": true` on a
  property (e.g. `equipment`) so the duplicate check runs automatically, with no need to pick
  the property each time. This would replace `scripts/check-unique-equipment.mjs`.
- **Split export**: download one GeoJSON per value of a property (e.g. postal code) as a zip.
  This would replace `scripts/split-by-postnr.mjs`.
- **Fix enum values in bulk**: for "must be one of …" errors, a dialog that maps each distinct
  bad value to an allowed value (like Match property names, but for values) and applies it to
  every affected feature.
- **Fill schema defaults**: a one-click "fill missing required properties with the schema's
  `default`" action.
- **Fix types in bulk**: convert `"42"` to `42` (or the reverse) for every property whose
  schema type disagrees with the data.
- **Select features with issues**: a button in Validation that selects all features with
  errors (or with a given issue kind), ready for bulk edit or delete.
- **Issues on the map**: color features with errors red. Clicking an issue zooms the map to
  that feature.
- **Validation report**: export the issue list as CSV/Excel to send to whoever supplied the
  data.
- **Reusable mapping templates**: save a Match property names result as a named template per
  schema and apply it to the next file from the same supplier in one click. Today progress is
  only saved per layer+schema as a resume point.
- **Ask Claude in more places**: generate a Remove condition, or suggest matches for properties
  the name matcher couldn't place.

## Safety

- **Undo/redo** for every change (single edit, bulk edit, delete, rename). This matters more
  now that features can be deleted with one click from Validation.
- **Change log**: a running list of what was done in the session ("removed 14 features where
  equipment is empty", …) that can be exported alongside the result.

## More formats (in and out)

- Inputs: GPX, GML, GeoPackage (`.gpkg`), CSV with a WKT column.
- Outputs beyond GeoJSON: Shapefile (zip), KML, CSV/Excel (flattened properties plus WKT or
  lat/lon), GeoPackage. Conversion currently only goes into GeoJSON.
- One-click reverse conversion: WGS84 GeoJSON → EPSG:25832 DXF/Shapefile for round-tripping
  back to Danish survey tools.

## Map & visualization

- Base map switcher (OSM / satellite / Danish Dataforsyningen WMTS).
- Highlight selected features on the map, and select features on the map (click or lasso).
- Measurement tools (distance/area) and a scale bar.
- Draw/edit geometry on the map (add a point, move a vertex) instead of only editing
  attributes.
- Color-by-attribute / choropleth styling instead of only color-by-layer.
- Cluster markers for point-heavy exports.
- Dark-mode-aware map tiles. The app has a theme toggle, but the map always uses light OSM
  tiles.

## Data table / editing

- Sortable, resizable columns in the feature list.
- Inline cell editing in the table itself, not just the modal dialog.
- CSV/Excel export of just the attribute table (no geometry) for non-GIS stakeholders.
- Geometry validation/repair: flag invalid geometries (self-intersections, unclosed polygons,
  empty geometries) and spatial duplicates (points within X m of each other) with a fix action.

## Workflow / UX

- Saved session: export a `.json` "project" bundling the GeoJSON, edits, layer schemas,
  hidden layers and filters, reloadable later. Or keep recent sessions in IndexedDB so a
  refresh doesn't lose work.
- Progress feedback for a single large file. The convert button just spins; batches already
  show per-file status.
- Diff/compare mode: upload two files and see what changed (handy for surveyors re-exporting).
- Keyboard shortcuts (e.g. `/` to focus search).

## Small UI polish

- Richer empty/onboarding state than just the drop zone, maybe with sample files to try.
- Show file size/feature count before conversion, not just after.

## Priority picks

Agreed order (Oct 2026). Cleaned data is imported into the target system as GeoJSON, and
files come both from recurring suppliers and one-off sources, so validation and fixing speed
matter more than new export formats.

1. **Undo/redo**, including an "Undo" toast right after a delete from Validation.
2. **Issues → selection & map**: select features with issues, red issue features on the map,
   click an issue to zoom.
3. **Schema-driven fixes**: `x-unique`, enum value mapping, fill defaults, fix types.

Later: reusable mapping templates and saved sessions (for recurring suppliers), then split
export and validation report.
