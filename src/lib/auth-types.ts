// Shared between the server-side auth code and the UI.

export const MIN_PASSWORD_LENGTH = 10;

export type Role = "admin" | "member";

export interface SessionUser {
  id: number;
  email: string;
  name: string;
  role: Role;
}

export interface Member extends SessionUser {
  // invited: hasn't set a password yet; disabled: can't sign in.
  status: "active" | "invited" | "disabled";
  inviteExpiresAt: number | null;
  inviteExpired: boolean;
  createdAt: number;
  lastLoginAt: number | null;
}

// Per-member data that comes with the page (raw JSON as stored; each
// consumer validates its own shape). Match property names progress is
// fetched separately, when that dialog opens.
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface PreloadedUserData {
  settings: JsonValue;
  presets: JsonValue;
}

export interface AuthState {
  user: SessionUser | null;
  userData: PreloadedUserData;
  // True until the first admin account has been created.
  needsSetup: boolean;
}
