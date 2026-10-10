# Features

What GIS Converter does today. For things we might build next, see [IDEAS.md](./IDEAS.md).

## Import & conversion

- **Supported inputs**: DXF, Shapefile (`.zip`), Excel (`.xlsx`), GeoJSON (`.geojson`/`.json`)
  and KML/KMZ. Max 25 MB per file.
- **Batch upload**: select or drag in several files or a whole folder. Each file is converted
  separately, shows its own status, and becomes its own layer in the result.
- **Always WGS 84 output**: everything is reprojected to EPSG:4326 GeoJSON.
- **Source coordinate system**: a curated list of the systems used in Danish data (UTM 32N/33N,
  DKTM1–4, ED50, …). It's only used when the file doesn't carry its own CRS (always for DXF,
  and for Shapefiles without a `.prj`).
- **CRS auto-detection**: for DXF files, the app checks which coordinate system puts the data
  inside Denmark and suggests it.
- **Format details**: DXF block attributes (ATTRIB) become feature properties. Excel reads a
  geometry column or coordinate columns.

## Viewing

- **Map**: an OpenStreetMap preview with features colored by layer. Click a feature to inspect
  its properties. The map zooms to fit only when files are converted or layers are
  shown/hidden, so it stays put while you edit.
- **Layer legend**: show or hide layers (one per source file, or per DXF layer).
- **List**: a table of all features and their properties.
- **Search & filters**: free-text search across all values, plus "property contains value"
  filters that can be stacked.
- **Dark mode** toggle.

## Editing

- **Edit one feature**: add, change or remove properties in a dialog.
- **Bulk edit selected features**, always with a before/after preview:
  - **Set value**: set a property, new or existing, to one value.
  - **Find & replace**: a regular expression across one property or all of them.
  - **Custom JS**: a small script that returns the new properties. Includes predefined scripts.
  - **Remove**: delete features where a property is empty, not empty, equals, doesn't equal,
    contains or matches a pattern, or where it's duplicated (keep the first, or flag all).
- **Saved presets**: Find & replace patterns and scripts can be saved by name in the browser.
- **Ask Claude**: describe a cleanup in plain words and Claude fills in the pattern or script
  for you to review. This needs `ANTHROPIC_API_KEY` on the server.
- **Undo/redo**: every change (edits, bulk edits, deletes, property renames) can be undone
  and redone with the Undo/Redo buttons in the preview header, or Ctrl+Z and Ctrl+Shift+Z
  (Ctrl+Y). After a delete or bulk change, a toast offers an "Undo" button. Up to 50 steps
  are kept, and the history resets when you convert new files.
- **Searchable dropdowns**: every list has a search box and scrolls.

## Validation

- **Schema per layer**: validate properties against a target-system JSON Schema (currently
  Belysning and Elskabe). Errors cover missing required fields, wrong type, values not in the
  allowed list, format problems and conditional rules. Unknown properties show as warnings.
- **Duplicate check**: pick a property per layer (for example `equipment`) to flag features
  that share a value. This works with or without a schema.
- **Fix, delete or show on map** for each feature with issues, straight from the list. "Show
  on map" switches to the Map tab, zooms to the feature and opens its popup.
- **Filter and select issues**: filter the list to errors only or one kind of issue (missing
  required, wrong type, duplicate, …), then "Select N" selects those features. A toast offers
  "Edit selected", which opens bulk edit.
- **Issues on the map**: while validating, features with errors are red, features with only
  warnings are amber, and the rest are grey. Turn off "Highlight validation issues" to go back
  to layer colors.
- **Match property names**: rename source properties to the schema's names. Suggestions come
  from schema aliases, names and fuzzy matching. The dialog has search, "set all to Don't
  rename / Remove", reviewed checkboxes, and "save progress" so you can come back later.
- **Adding a schema**: drop a new JSON file into `/schemas` and it appears in the picker.

## Export

- **Download GeoJSON**: downloads the edited, merged result.

## Command-line helpers (`scripts/`)

- `split-by-postnr.mjs`: split a GeoJSON into one file per postal code.
- `check-unique-equipment.mjs`: check that a property is unique within each GeoJSON file.
