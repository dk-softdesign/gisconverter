import { useSyncExternalStore } from "react";

import { DEFAULT_SOURCE_CRS, isSupportedSourceCrs } from "#/lib/crs";

export type ThemePreference = "light" | "dark" | "system";
export type PreviewTab = "map" | "list" | "validation";
export type Basemap = "osm" | "carto-light" | "carto-dark" | "none";

// User preferences, kept per browser in localStorage. Every field has a
// default that matches how the app behaved before settings existed.
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

// Read by the inline theme script in __root.tsx before hydration too — keep
// the key and the `theme` field name in sync with it.
export const SETTINGS_STORAGE_KEY = "gisconverter:settings";
// Where the header theme toggle stored its choice before settings existed.
const LEGACY_THEME_KEY = "theme";

const THEMES: ThemePreference[] = ["light", "dark", "system"];
const TABS: PreviewTab[] = ["map", "list", "validation"];
const BASEMAPS: Basemap[] = ["osm", "carto-light", "carto-dark", "none"];

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

// Anything missing or no longer valid (e.g. a CRS dropped from the supported
// list) falls back to its default rather than breaking the app.
function parseSettings(raw: string | null): Settings {
  let stored: Record<string, unknown> = {};
  try {
    if (raw) stored = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // Corrupt value — start from defaults.
  }
  const theme = stored.theme ?? readStorage(LEGACY_THEME_KEY);
  const precision = stored.coordinatePrecision;
  return {
    theme: THEMES.includes(theme as ThemePreference)
      ? (theme as ThemePreference)
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

const listeners = new Set<() => void>();
// useSyncExternalStore needs the same object back while nothing has changed,
// so the parsed value is cached against the raw string it came from.
let cachedRaw: string | null | undefined;
let cachedSettings: Settings = DEFAULT_SETTINGS;

export function getSettings(): Settings {
  const raw = readStorage(SETTINGS_STORAGE_KEY);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedSettings = parseSettings(raw);
  }
  return cachedSettings;
}

function getServerSnapshot(): Settings {
  return DEFAULT_SETTINGS;
}

function notify() {
  for (const listener of listeners) listener();
}

export function subscribeToSettings(listener: () => void) {
  listeners.add(listener);
  // Picks up changes made in another tab.
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function writeSettings(next: Settings) {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage unavailable — the change lasts for this page load only.
  }
  cachedRaw = readStorage(SETTINGS_STORAGE_KEY);
  cachedSettings = next;
  notify();
}

export function updateSettings(patch: Partial<Settings>) {
  writeSettings({ ...getSettings(), ...patch });
}

export function resetSettings() {
  writeSettings(DEFAULT_SETTINGS);
}

// Server render and hydration see the defaults; the stored settings take over
// right after.
export function useSettings(): Settings {
  return useSyncExternalStore(subscribeToSettings, getSettings, getServerSnapshot);
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

export function resolveTheme(theme: ThemePreference): "light" | "dark" {
  if (theme === "system") return matchMedia(DARK_QUERY).matches ? "dark" : "light";
  return theme;
}

export function subscribeToColorScheme(listener: () => void) {
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
