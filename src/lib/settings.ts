import { useCallback, useMemo, useSyncExternalStore } from "react";

import type { JsonValue } from "#/lib/auth-types";
import { DEFAULT_SOURCE_CRS, isSupportedSourceCrs } from "#/lib/crs";
import { useSetUserData, useUserData } from "#/lib/user-data";

export type ThemePreference = "light" | "dark" | "system";
export type PreviewTab = "map" | "list" | "validation";
export type Basemap = "osm" | "carto-light" | "carto-dark" | "none";

// User preferences, stored per member on the server (user_data "settings")
// and loaded with the page. Every field has a default that matches how the
// app behaved before settings existed.
export interface Settings {
  theme: ThemePreference;
  defaultSourceCrs: string;
  defaultTab: PreviewTab;
  highlightIssues: boolean;
  basemap: Basemap;
  // Decimal places kept in downloaded coordinates; null keeps full precision.
  coordinatePrecision: number | null;
  prettyPrint: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  defaultSourceCrs: DEFAULT_SOURCE_CRS,
  defaultTab: "map",
  highlightIssues: true,
  basemap: "osm",
  coordinatePrecision: null,
  prettyPrint: true,
};

// Where settings lived in the browser before they moved to the member's
// account; read once to migrate them (see BrowserDataMigration).
export const LEGACY_SETTINGS_KEY = "gisconverter:settings";
export const LEGACY_THEME_KEY = "theme";

const THEMES: ThemePreference[] = ["light", "dark", "system"];
const TABS: PreviewTab[] = ["map", "list", "validation"];
const BASEMAPS: Basemap[] = ["osm", "carto-light", "carto-dark", "none"];

// Anything missing or no longer valid (e.g. a CRS dropped from the supported
// list) falls back to its default rather than breaking the app.
export function parseSettings(raw: JsonValue | undefined): Settings {
  const stored: Record<string, unknown> =
    raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const precision = stored.coordinatePrecision;
  return {
    theme: THEMES.includes(stored.theme as ThemePreference)
      ? (stored.theme as ThemePreference)
      : DEFAULT_SETTINGS.theme,
    defaultSourceCrs:
      typeof stored.defaultSourceCrs === "string" && isSupportedSourceCrs(stored.defaultSourceCrs)
        ? stored.defaultSourceCrs
        : DEFAULT_SETTINGS.defaultSourceCrs,
    defaultTab: TABS.includes(stored.defaultTab as PreviewTab)
      ? (stored.defaultTab as PreviewTab)
      : DEFAULT_SETTINGS.defaultTab,
    highlightIssues:
      typeof stored.highlightIssues === "boolean"
        ? stored.highlightIssues
        : DEFAULT_SETTINGS.highlightIssues,
    basemap: BASEMAPS.includes(stored.basemap as Basemap)
      ? (stored.basemap as Basemap)
      : DEFAULT_SETTINGS.basemap,
    coordinatePrecision:
      precision === null || (Number.isInteger(precision) && (precision as number) >= 0)
        ? (precision as number | null)
        : DEFAULT_SETTINGS.coordinatePrecision,
    prettyPrint:
      typeof stored.prettyPrint === "boolean" ? stored.prettyPrint : DEFAULT_SETTINGS.prettyPrint,
  };
}

export function useSettings(): Settings {
  const raw = useUserData("settings");
  return useMemo(() => parseSettings(raw), [raw]);
}

export function useUpdateSettings() {
  const setUserData = useSetUserData();
  return useCallback(
    (patch: Partial<Settings>) =>
      setUserData("settings", (previous) => ({ ...parseSettings(previous), ...patch })),
    [setUserData],
  );
}

export function useResetSettings() {
  const setUserData = useSetUserData();
  return useCallback(() => setUserData("settings", () => ({ ...DEFAULT_SETTINGS })), [setUserData]);
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

function subscribeToColorScheme(listener: () => void) {
  const query = matchMedia(DARK_QUERY);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

// The theme actually in effect — "system" resolved against the OS setting.
export function useResolvedTheme(): "light" | "dark" {
  const { theme } = useSettings();
  const systemDark = useSyncExternalStore(
    subscribeToColorScheme,
    () => matchMedia(DARK_QUERY).matches,
    () => false,
  );
  if (theme === "system") return systemDark ? "dark" : "light";
  return theme;
}
