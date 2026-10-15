import { queryOptions } from "@tanstack/react-query";
import { redirect, type ParsedLocation } from "@tanstack/react-router";

import { getAuthState } from "#/lib/auth-functions";
import type { AuthState, SessionUser } from "#/lib/auth-types";

// Who's signed in. Fetched once per page load by the root route (SSR'd and
// handed to the client with the page), so navigating doesn't re-ask.
export const authQueryOptions = () =>
  queryOptions({
    queryKey: ["auth"],
    queryFn: () => getAuthState(),
    staleTime: Infinity,
  });

// Route guard for beforeLoad. The server-side request middleware already
// redirects page loads; this covers client-side navigation.
export function requireSignedIn(
  auth: AuthState,
  location: ParsedLocation,
  { admin = false } = {},
): { user: SessionUser } {
  if (!auth.user) {
    throw redirect({ to: "/login", search: { redirect: location.href } });
  }
  if (admin && auth.user.role !== "admin") throw redirect({ to: "/" });
  return { user: auth.user };
}

// Only same-app paths are followed after login, never another site.
export function safeRedirectPath(value: unknown): string {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
    ? value
    : "/";
}
