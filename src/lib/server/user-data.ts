import type { JsonValue } from "#/lib/auth-types";
import { getDb } from "#/lib/server/db";

// Keys a member can store data under: their settings, their bulk-edit
// presets, and "mapping:<schemaId>:<layer>" for Match property names progress.
const MAPPING_PREFIX = "mapping:";
const MAX_KEY_LENGTH = 300;
const MAX_VALUE_BYTES = 512 * 1024;

export function isAllowedKey(key: string): boolean {
  if (key.length > MAX_KEY_LENGTH) return false;
  return key === "settings" || key === "presets" || key.startsWith(MAPPING_PREFIX);
}

export function getUserData(userId: number, key: string): JsonValue {
  const row = getDb()
    .prepare("SELECT value FROM user_data WHERE user_id = ? AND key = ?")
    .get(userId, key) as { value: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value) as JsonValue;
  } catch {
    return null;
  }
}

// null deletes the key.
export function setUserData(userId: number, key: string, value: unknown) {
  if (value === null || value === undefined) {
    getDb().prepare("DELETE FROM user_data WHERE user_id = ? AND key = ?").run(userId, key);
    return;
  }
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json) > MAX_VALUE_BYTES) throw new Error("That's too much data to save.");
  getDb()
    .prepare(
      `INSERT INTO user_data (user_id, key, value, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(userId, key, json, Date.now());
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function countUserDataWithPrefix(userId: number, prefix: string): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS count FROM user_data WHERE user_id = ? AND key LIKE ? ESCAPE '\\'")
    .get(userId, `${escapeLike(prefix)}%`) as { count: number };
  return Number(row.count);
}

export function deleteUserDataWithPrefix(userId: number, prefix: string) {
  getDb()
    .prepare("DELETE FROM user_data WHERE user_id = ? AND key LIKE ? ESCAPE '\\'")
    .run(userId, `${escapeLike(prefix)}%`);
}

// One-time copy of data that used to live in the browser. Only fills keys
// the member doesn't have yet, so a stale browser never overwrites what's
// already on their account.
export function importMissingUserData(userId: number, entries: Record<string, unknown>) {
  for (const [key, value] of Object.entries(entries)) {
    if (!isAllowedKey(key) || value === null || value === undefined) continue;
    if (getUserData(userId, key) !== null) continue;
    setUserData(userId, key, value);
  }
}
