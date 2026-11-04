import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import {
  deleteCookie,
  getCookie,
  getRequestIP,
  getRequestProtocol,
  getRequestUrl,
  setCookie,
} from "@tanstack/react-start/server";

import { MIN_PASSWORD_LENGTH, type Member, type Role, type SessionUser } from "#/lib/auth-types";
import { getDb, transaction } from "#/lib/server/db";

const SESSION_COOKIE = "gis_session";
const DAY_MS = 24 * 60 * 60 * 1000;
const SESSION_TTL_MS = 30 * DAY_MS;
const INVITE_TTL_MS = 7 * DAY_MS;
// Self-service reset links travel by email, so they're kept short-lived.
const EMAIL_RESET_TTL_MS = 60 * 60 * 1000;

// ---- passwords ---------------------------------------------------------

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 } as const;
const SCRYPT_KEY_LENGTH = 64;

function scryptAsync(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolvePromise, reject) => {
    scrypt(password, salt, SCRYPT_KEY_LENGTH, options, (error, key) =>
      error ? reject(error) : resolvePromise(key),
    );
  });
}

// Stored as "scrypt$N$r$p$salt$hash" so the parameters can be raised later
// without breaking existing hashes.
async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, SCRYPT_PARAMS);
  const { N, r, p } = SCRYPT_PARAMS;
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, N, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const key = await scryptAsync(password, Buffer.from(salt, "base64"), {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

// Spent on unknown emails too, so response time doesn't reveal which emails
// have accounts.
let dummyHash: Promise<string> | undefined;
function getDummyHash() {
  dummyHash ??= hashPassword(randomBytes(16).toString("hex"));
  return dummyHash;
}

export function validatePassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

// ---- tokens ------------------------------------------------------------

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// ---- rows --------------------------------------------------------------

interface UserRow {
  id: number;
  email: string;
  name: string;
  role: Role;
  password_hash: string | null;
  disabled: number;
  invite_token_hash: string | null;
  invite_expires_at: number | null;
  created_at: number;
  last_login_at: number | null;
}

function toSessionUser(row: UserRow): SessionUser {
  return { id: row.id, email: row.email, name: row.name, role: row.role };
}

function toMember(row: UserRow): Member {
  return {
    ...toSessionUser(row),
    status: row.disabled ? "disabled" : row.password_hash ? "active" : "invited",
    inviteExpiresAt: row.invite_expires_at,
    inviteExpired: row.invite_expires_at !== null && row.invite_expires_at <= Date.now(),
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

function findUserById(id: number): UserRow | undefined {
  return getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hasUsers(): boolean {
  return getDb().prepare("SELECT 1 FROM users LIMIT 1").get() !== undefined;
}

// ---- sessions ----------------------------------------------------------

function setSessionCookie(token: string, expiresAt: number) {
  setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // Only over HTTPS (directly or behind a TLS-terminating proxy); a plain
    // HTTP deployment would otherwise never get the cookie back.
    secure: getRequestProtocol({ xForwardedProto: true }) === "https",
    path: "/",
    expires: new Date(expiresAt),
  });
}

function startSession(userId: number) {
  const token = newToken();
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  const db = getDb();
  db.prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(
    hashToken(token),
    userId,
    expiresAt,
    now,
  );
  db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(now, userId);
  setSessionCookie(token, expiresAt);
}

// The signed-in user for the current request, or null. Sessions slide: one
// used in the second half of its lifetime is extended.
export function getCurrentUser(): SessionUser | null {
  const token = getCookie(SESSION_COOKIE);
  if (!token) return null;
  const db = getDb();
  const sessionId = hashToken(token);
  const row = db
    .prepare(
      `SELECT users.*, sessions.expires_at AS session_expires_at
       FROM sessions JOIN users ON users.id = sessions.user_id
       WHERE sessions.id = ?`,
    )
    .get(sessionId) as (UserRow & { session_expires_at: number }) | undefined;
  const now = Date.now();
  if (!row || row.disabled || row.session_expires_at <= now) {
    if (row) db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
    return null;
  }
  if (row.session_expires_at - now < SESSION_TTL_MS / 2) {
    const expiresAt = now + SESSION_TTL_MS;
    db.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").run(expiresAt, sessionId);
    setSessionCookie(token, expiresAt);
  }
  return toSessionUser(row);
}

export function endSession() {
  const token = getCookie(SESSION_COOKIE);
  if (token) getDb().prepare("DELETE FROM sessions WHERE id = ?").run(hashToken(token));
  deleteCookie(SESSION_COOKIE, { path: "/" });
}

function endAllSessions(userId: number) {
  getDb().prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

// ---- login -------------------------------------------------------------

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_LOGINS = 5;
// In-memory and per process — enough to slow down password guessing against
// a single instance without another moving part.
const failedLogins = new Map<string, { count: number; since: number }>();

function loginThrottleKey(email: string) {
  return `${getRequestIP({ xForwardedFor: true }) ?? "unknown"}|${email}`;
}

export async function login(email: string, password: string): Promise<string | null> {
  const normalized = normalizeEmail(email);
  const key = loginThrottleKey(normalized);
  const now = Date.now();
  const attempts = failedLogins.get(key);
  if (attempts && now - attempts.since < LOGIN_WINDOW_MS && attempts.count >= MAX_FAILED_LOGINS) {
    return "Too many failed attempts. Try again in 15 minutes.";
  }

  const user = getDb().prepare("SELECT * FROM users WHERE email = ?").get(normalized) as
    | UserRow
    | undefined;
  let valid = false;
  if (user?.password_hash && !user.disabled) {
    valid = await verifyPassword(password, user.password_hash);
  } else {
    await verifyPassword(password, await getDummyHash());
  }

  if (!user || !valid) {
    const current = attempts && now - attempts.since < LOGIN_WINDOW_MS ? attempts : null;
    failedLogins.set(key, { count: (current?.count ?? 0) + 1, since: current?.since ?? now });
    return "Wrong email or password.";
  }
  failedLogins.delete(key);
  startSession(user.id);
  return null;
}

// ---- first-run setup ---------------------------------------------------

export async function createFirstAdmin(email: string, name: string, password: string) {
  const passwordHash = await hashPassword(password);
  const userId = transaction((db) => {
    if (db.prepare("SELECT 1 FROM users LIMIT 1").get()) {
      throw new Error("Setup has already been completed.");
    }
    const result = db
      .prepare(
        "INSERT INTO users (email, name, role, password_hash, created_at) VALUES (?, ?, 'admin', ?, ?)",
      )
      .run(normalizeEmail(email), name.trim(), passwordHash, Date.now());
    return Number(result.lastInsertRowid);
  });
  startSession(userId);
}

// ---- invites -----------------------------------------------------------

function findUserByInvite(token: string): UserRow | undefined {
  const row = getDb()
    .prepare("SELECT * FROM users WHERE invite_token_hash = ?")
    .get(hashToken(token)) as UserRow | undefined;
  if (!row || row.disabled || !row.invite_expires_at || row.invite_expires_at <= Date.now()) {
    return undefined;
  }
  return row;
}

export function describeInvite(token: string) {
  const user = findUserByInvite(token);
  if (!user) return null;
  return { email: user.email, name: user.name, isReset: user.password_hash !== null };
}

// Sets the member's password from a valid invite/reset link, signs them in,
// and signs out any other sessions (a reset usually means "lost access").
export async function acceptInvite(token: string, password: string) {
  const user = findUserByInvite(token);
  if (!user)
    throw new Error(
      "This link is invalid or has expired. Request a new one from the sign-in page.",
    );
  const passwordHash = await hashPassword(password);
  getDb()
    .prepare(
      "UPDATE users SET password_hash = ?, invite_token_hash = NULL, invite_expires_at = NULL WHERE id = ?",
    )
    .run(passwordHash, user.id);
  endAllSessions(user.id);
  startSession(user.id);
}

// Returns the raw token; only its hash is stored, so this is the one chance
// to hand it out.
function issueInvite(userId: number, ttlMs = INVITE_TTL_MS): string {
  const token = newToken();
  getDb()
    .prepare("UPDATE users SET invite_token_hash = ?, invite_expires_at = ? WHERE id = ?")
    .run(hashToken(token), Date.now() + ttlMs, userId);
  return token;
}

// ---- forgotten password ------------------------------------------------

const RESET_WINDOW_MS = 15 * 60 * 1000;
const MAX_RESETS_PER_EMAIL = 3;
const MAX_RESETS_PER_IP = 10;
// In-memory and per process, like the login throttle: stops the form being
// used to flood someone's inbox.
const resetRequests = new Map<string, { count: number; since: number }>();

function overResetLimit(key: string, max: number, now: number): boolean {
  const current = resetRequests.get(key);
  const entry =
    current && now - current.since < RESET_WINDOW_MS ? current : { count: 0, since: now };
  entry.count += 1;
  resetRequests.set(key, entry);
  return entry.count > max;
}

// Links in emails point at APP_URL when set. Without it they use the address
// the request came in on — fine for development, but set APP_URL in
// production so a forged Host header can't point a link elsewhere.
function appOrigin(): string {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  return configured || getRequestUrl({ xForwardedHost: true, xForwardedProto: true }).origin;
}

// Emails a one-time link for choosing a new password. Returns an error only
// for throttling: unknown or disabled emails look exactly like a sent link,
// and the mail goes out in the background, so neither the answer nor its
// timing reveals who has an account.
export function requestPasswordReset(email: string): string | null {
  const normalized = normalizeEmail(email);
  const now = Date.now();
  const ip = getRequestIP({ xForwardedFor: true }) ?? "unknown";
  if (
    overResetLimit(`ip|${ip}`, MAX_RESETS_PER_IP, now) ||
    overResetLimit(`email|${normalized}`, MAX_RESETS_PER_EMAIL, now)
  ) {
    return "Too many requests. Try again in 15 minutes.";
  }

  const user = getDb().prepare("SELECT * FROM users WHERE email = ?").get(normalized) as
    | UserRow
    | undefined;
  if (!user || user.disabled) return null;

  const link = `${appOrigin()}/invite/${issueInvite(user.id, EMAIL_RESET_TTL_MS)}`;
  const action = user.password_hash ? "choose a new password" : "set up your account";
  void import("#/lib/server/mail")
    .then(({ sendMail }) =>
      sendMail({
        to: user.email,
        subject: "Reset your GIS Converter password",
        text: [
          `Hi ${user.name},`,
          "",
          `Someone asked to reset the password for your GIS Converter account. Open this link to ${action}:`,
          "",
          link,
          "",
          "The link works once and expires in 1 hour. If you didn't ask for this, ignore this email — your password stays the same.",
        ].join("\n"),
      }),
    )
    .catch((error: unknown) => console.error("Password reset email failed:", error));
  return null;
}

// ---- member maintenance (callers must check the admin role) -------------

export function listMembers(): Member[] {
  const rows = getDb().prepare("SELECT * FROM users ORDER BY name COLLATE NOCASE").all();
  return (rows as unknown as UserRow[]).map(toMember);
}

export function inviteMember(
  email: string,
  name: string,
  role: Role,
): { userId: number; token: string } {
  const normalized = normalizeEmail(email);
  const userId = transaction((db) => {
    if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(normalized)) {
      throw new Error(`${normalized} is already a member.`);
    }
    const result = db
      .prepare("INSERT INTO users (email, name, role, created_at) VALUES (?, ?, ?, ?)")
      .run(normalized, name.trim(), role, Date.now());
    return Number(result.lastInsertRowid);
  });
  return { userId, token: issueInvite(userId) };
}

export function newSignInLink(userId: number): string {
  const user = findUserById(userId);
  if (!user) throw new Error("Member not found.");
  if (user.disabled) throw new Error("Enable this member first.");
  return issueInvite(userId);
}

// Emails an admin-issued invite or sign-in link to the member. Unlike the
// self-service reset, this waits for the relay and reports failure, so the
// admin knows to send the link some other way.
export async function emailSignInLink(userId: number, token: string): Promise<boolean> {
  const user = findUserById(userId);
  if (!user) return false;
  const link = `${appOrigin()}/invite/${token}`;
  const isInvite = !user.password_hash;
  try {
    const { sendMail } = await import("#/lib/server/mail");
    await sendMail({
      to: user.email,
      subject: isInvite
        ? "You're invited to GIS Converter"
        : "Choose a new password for GIS Converter",
      text: [
        `Hi ${user.name},`,
        "",
        isInvite
          ? "You've been invited to GIS Converter. Open this link to choose your password and sign in:"
          : "An admin created a link for you to choose a new GIS Converter password:",
        "",
        link,
        "",
        "The link works once and expires in 7 days.",
      ].join("\n"),
    });
    return true;
  } catch (error) {
    console.error("Sign-in link email failed:", error);
    return false;
  }
}

function activeAdminCount(db: ReturnType<typeof getDb>): number {
  const row = db
    .prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND disabled = 0")
    .get() as { count: number };
  return Number(row.count);
}

// Admins can't change their own role/status or delete themselves, and the
// last active admin can't be removed — either would risk locking everyone
// out of member maintenance.
function assertCanChange(actorId: number, target: UserRow, removesAdmin: boolean) {
  if (target.id === actorId) throw new Error("You can't change your own account here.");
  if (removesAdmin && target.role === "admin" && !target.disabled) {
    if (activeAdminCount(getDb()) <= 1) throw new Error("There must be at least one admin.");
  }
}

export function updateMember(
  actorId: number,
  userId: number,
  changes: { role?: Role; disabled?: boolean; name?: string },
) {
  transaction((db) => {
    const target = findUserById(userId);
    if (!target) throw new Error("Member not found.");
    const removesAdmin =
      (changes.role !== undefined && changes.role !== "admin") || changes.disabled === true;
    if (changes.role !== undefined || changes.disabled !== undefined) {
      assertCanChange(actorId, target, removesAdmin);
    }
    if (changes.role !== undefined) {
      db.prepare("UPDATE users SET role = ? WHERE id = ?").run(changes.role, userId);
    }
    if (changes.name !== undefined) {
      db.prepare("UPDATE users SET name = ? WHERE id = ?").run(changes.name.trim(), userId);
    }
    if (changes.disabled !== undefined) {
      db.prepare("UPDATE users SET disabled = ? WHERE id = ?").run(
        changes.disabled ? 1 : 0,
        userId,
      );
      if (changes.disabled) endAllSessions(userId);
    }
  });
}

export function deleteMember(actorId: number, userId: number) {
  transaction((db) => {
    const target = findUserById(userId);
    if (!target) return;
    assertCanChange(actorId, target, true);
    db.prepare("DELETE FROM users WHERE id = ?").run(userId);
  });
}

export async function changePassword(userId: number, current: string, next: string) {
  const user = findUserById(userId);
  if (!user?.password_hash || !(await verifyPassword(current, user.password_hash))) {
    throw new Error("Your current password is wrong.");
  }
  const passwordHash = await hashPassword(next);
  getDb().prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, userId);
  // Keep this browser signed in, sign out everywhere else.
  endAllSessions(userId);
  startSession(userId);
}
