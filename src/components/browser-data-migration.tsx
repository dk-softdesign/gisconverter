import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { importBrowserDataFn } from "#/lib/auth-functions";
import { authQueryOptions } from "#/lib/auth-query";
import type { AuthState, JsonValue } from "#/lib/auth-types";
import { LEGACY_SETTINGS_KEY, LEGACY_THEME_KEY } from "#/lib/settings";

// Browser storage keys used before settings, presets and Match property names
// progress moved to the member's account.
const LEGACY_PRESETS_KEY = "gisconverter:bulk-edit-presets";
const LEGACY_MAPPING_PREFIX = "gisconverter:propertyMapping:";

function readJson(key: string): JsonValue {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as JsonValue) : null;
  } catch {
    return null;
  }
}

// What this browser still holds from before, keyed the way the server
// stores it, plus the browser keys to remove once it's safely copied.
function collectBrowserData(): { entries: Record<string, JsonValue>; keys: string[] } {
  const entries: Record<string, JsonValue> = {};
  const keys: string[] = [];
  let storageKeys: string[];
  try {
    storageKeys = Object.keys(localStorage);
  } catch {
    return { entries, keys };
  }

  const settings = readJson(LEGACY_SETTINGS_KEY);
  const theme = storageKeys.includes(LEGACY_THEME_KEY)
    ? localStorage.getItem(LEGACY_THEME_KEY)
    : null;
  if (settings || theme) {
    const base =
      settings && typeof settings === "object" && !Array.isArray(settings) ? settings : {};
    entries.settings = theme && !("theme" in base) ? { ...base, theme } : base;
  }
  const presets = readJson(LEGACY_PRESETS_KEY);
  if (presets) entries.presets = presets;
  for (const key of storageKeys) {
    if (!key.startsWith(LEGACY_MAPPING_PREFIX)) continue;
    const value = readJson(key);
    if (value) entries[`mapping:${key.slice(LEGACY_MAPPING_PREFIX.length)}`] = value;
  }

  for (const key of [LEGACY_SETTINGS_KEY, LEGACY_THEME_KEY, LEGACY_PRESETS_KEY]) {
    if (storageKeys.includes(key)) keys.push(key);
  }
  keys.push(...storageKeys.filter((key) => key.startsWith(LEGACY_MAPPING_PREFIX)));
  return { entries, keys };
}

// One-time move of data saved in this browser (before accounts existed) onto
// the signed-in member's account. Whoever signs in first on a browser gets
// it; it's then removed from the browser so it can't reach anyone else.
export function BrowserDataMigration() {
  const { data } = useQuery(authQueryOptions());
  const queryClient = useQueryClient();
  const userId = data?.user?.id;

  useEffect(() => {
    if (!userId) return;
    const { entries, keys } = collectBrowserData();
    if (keys.length === 0) return;
    importBrowserDataFn({ data: { entries } })
      .then((userData) => {
        for (const key of keys) localStorage.removeItem(key);
        queryClient.setQueryData<AuthState>(authQueryOptions().queryKey, (state) =>
          state ? { ...state, userData } : state,
        );
      })
      .catch(() => {
        // Leave the browser copy in place and try again on the next load.
      });
  }, [userId, queryClient]);

  return null;
}
