# Features

What GIS Converter does today. For things we might build next, see [IDEAS.md](./IDEAS.md).

## Import & conversion

- **Supported inputs**: DXF, Shapefile (`.zip`), Excel (`.xlsx`), GeoJSON (`.geojson`/`.json`),
  KML/KMZ and GeoPackage (`.gpkg`). Max 25 MB per file.
- **Batch upload**: select or drag in several files or a whole folder. Each file is converted
  separately, shows its own status, and becomes its own layer in the result.
- **Always WGS 84 output**: everything is reprojected to EPSG:4326 GeoJSON.
- **Source coordinate system**: a curated list of the systems used in Danish data (UTM 32N/33N,
  DKTM1–4, ED50, …). It's only used when the file doesn't carry its own CRS (always for DXF,
  for Shapefiles without a `.prj`, and for GeoPackage layers with an undefined CRS). The
  pre-selected system can be changed in Settings.
- **CRS auto-detection**: for DXF files, the app checks which coordinate system puts the data
  inside Denmark and suggests it.
- **Format details**: DXF block attributes (ATTRIB) become feature properties. Excel reads a
  geometry column or coordinate columns. GeoPackage: each feature table becomes a layer and is
  reprojected from its own CRS (including ones outside the curated list, via the WKT stored in
  the file); tables without geometry, raster tiles and binary columns are skipped with a
  warning.
- **Properties-only import**: when a file has records but no geometry, the app asks whether to
  import them anyway. They show in the List but not on the map.

## Login and members

- **Everything requires sign-in**, including the converter API and the Ask Claude helpers.
- **First run**: a setup screen creates the first admin account.
- **Roles**: admins manage members; members use the converter.
- **Members page** (admins): invite a member by name, email and role. The admin gets a
  one-time invite link (valid 7 days) to send. The member opens it and chooses their own
  password. No email server is needed.
- **Maintenance**: change role, disable/enable (disabling signs the member out at once),
  delete, and "Reset password", which creates a new one-time link. Admins can't change their
  own account here, and the last admin can't be removed.
- **Account menu** in the header: Members (admins), change password (signs out other
  browsers), sign out.
- **Protection**: passwords hashed with scrypt, sessions in HttpOnly cookies, repeated failed
  logins are throttled (5 per 15 minutes).
- Members and sessions are stored in a SQLite database on the server.

## Layout

- **App header** with the title, a light/dark toggle and the Settings button.
- **Working layout after converting**: the upload form collapses into a left-hand side panel
  (source files with status, Download GeoJSON, Change file, conversion warnings). The panel
  can be hidden to give the preview the full width, and the choice is remembered.
- **Preview fills the window height**, so the map and the list use all the space available.
- **Change file** hides the preview and reopens the upload form; **Back to preview** returns
  without losing the current data.

## Viewing

- **Map**: a preview with features colored by layer. Click a feature to inspect its
  properties. The map zooms to fit only when files are converted or layers are shown/hidden,
  so it stays put while you edit. The background (OpenStreetMap, light, dark or none) is set
  in Settings.
- **Layer legend**: show or hide layers (one per source file, or per DXF layer).
- **List**: a table of all features and their properties.
- **Search & filters**: free-text search across all values, plus "property contains value"
  filters that can be stacked.
- **Theme**: light, dark, or follow the operating system.

## Editing

- **Edit one feature**: add, change or remove properties in a dialog.
- **Rename or delete properties from the List**: each column header has rename and delete
  actions. Changes are staged (shown in a bar above the list) and only applied when you press
  Apply. They apply to every feature in the visible layers, and a rename can't overwrite an
  existing property.
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
- **Match property names**: rename source properties to the schema's names, or type a custom
  name. Suggestions come from schema aliases, names and fuzzy matching. The dialog has search,
  "set all to Don't rename / Remove", reviewed checkboxes, "save progress" so you can come
  back later, and a warning when two properties would end up with the same name.
- **Adding a schema**: drop a new JSON file into `/schemas` and it appears in the picker.

## Export

- **Download GeoJSON**: downloads the edited, merged result. Coordinate precision (full, or
  8 down to 5 decimals) and pretty-printed vs compact output are set in Settings.

## Settings

Opened from the gear in the header. Changes apply at once and are saved in the browser.

- **Appearance**: theme (light / dark / system).
- **Conversion**: default source coordinate system.
- **Preview**: which tab opens after converting, map background, and whether validation issues
  are highlighted on the map by default.
- **Export**: coordinate precision and pretty-printing.
- **Saved data**: clear saved Match property names progress, and reset all settings.

## Command-line helpers (`scripts/`)

- `split-by-postnr.mjs`: split a GeoJSON into one file per postal code.
- `check-unique-equipment.mjs`: check that a property is unique within each GeoJSON file.
