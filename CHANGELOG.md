# Changelog

What's new in GIS Converter, newest first.

## 2026-10-15

### Added

- **Sign-in and members.** The whole app now requires signing in. Admins invite members from
  the new **Members** page and send them a one-time link to choose their own password. Admins
  can change roles, disable or delete members, and create password-reset links.
- **Account menu** in the header: Members (admins), change password and sign out.
- **Settings follow you.** Settings, saved bulk-edit presets and _Match property names_
  progress are saved to your account, so they're the same in every browser and each member
  has their own. Anything saved in a browser before is moved to your account the first time
  you sign in there.
- **Settings** (gear in the header): theme (light / dark / system), default coordinate system,
  which tab opens after converting, map background, issue highlighting, and export options.
- **GeoPackage (`.gpkg`) import.** Each table becomes a layer and is reprojected from its own
  coordinate system.
- **Export options:** round coordinates (8 down to 5 decimals) and choose pretty-printed or
  compact GeoJSON.
- **Rename and delete properties from the List.** Column headers have rename and delete
  actions. Changes wait in a bar above the list until you press _Apply_.
- **Custom names in _Match property names_**: type any name, not only the schema's, and get a
  warning when two properties would end up with the same name.
- **New layout after converting:** source files, Download and Change file move into a side
  panel you can hide, and the preview fills the window height.
- **App header** with title, theme toggle, settings and account menu.
- **Changelog** button in the header. It opens over the current screen, so closing it (X or
  Esc) takes you straight back to your work.

### Fixed

- The map was empty and the List froze the browser after the preview layout change.
- Docker image builds failed while installing git hooks.
- The header title overlapped the buttons on phone-sized screens.

## 2026-10-14

### Added

- **Import records without geometry.** When a file has rows but no geometry, you're asked
  whether to import them with properties only.

### Fixed

- Dates in Shapefiles and Excel files were converted incorrectly.

## 2026-10-12

### Added

- **Sequence option in bulk edit**: set a property to a running number across the selected
  features.

### Changed

- The duplicate check is more reliable.

## 2026-10-10

### Added

- **Duplicate check** per layer on a chosen property, with or without a schema.
- **Undo and redo** for every change, with Ctrl+Z / Ctrl+Shift+Z and an _Undo_ button in the
  notification after each change.
- **Validation issues on the map**: features with errors red, warnings amber, the rest grey.

## 2026-10-09

### Added

- **KML/KMZ** and **GeoJSON** import (GeoJSON for editing and validating existing files).
- **Ask Claude**: describe a cleanup in plain words and get a find-and-replace pattern or
  script to review.
- **Searchable dropdowns** everywhere.
- Saved presets and predefined scripts in bulk edit.

## 2026-09-25

### Added

- **Coordinate-system detection for DXF**: the app suggests the system that puts the data in
  Denmark.
- More Danish coordinate systems.

## 2026-09-18

### Added

- **Schema validation** per layer (Belysning and Elskabe), with fix, delete and show-on-map
  for each issue.
- **Match property names** to rename source properties to the schema's names.
- **Batch upload**: several files or a whole folder at once.

## 2026-09-17

### Added

- **Search and filters** in the List.
- Docker image and Makefile for deployment.

## 2026-09-16

First version.

- Convert **DXF**, **Shapefile (`.zip`)** and **Excel (`.xlsx`)** to GeoJSON, reprojected to
  WGS 84.
- Map preview with drag-and-drop upload, colored layers, click-to-inspect and dark mode.
- **List** tab, and editing of single features and bulk edits.
