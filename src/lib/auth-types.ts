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

export interface AuthState {
  user: SessionUser | null;
  // True until the first admin account has been created.
  needsSetup: boolean;
}
