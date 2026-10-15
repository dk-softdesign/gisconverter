import { createMiddleware, createServerFn } from "@tanstack/react-start";

import type { AuthState, Member, Role, SessionUser } from "#/lib/auth-types";

// Server functions for login and member maintenance. The server-only auth
// module is imported lazily inside each handler so node:sqlite/node:crypto
// never end up in the client bundle.
const auth = () => import("#/lib/server/auth");
const userData = () => import("#/lib/server/user-data");

// A failure the user should see as-is (wrong password, last admin, …).
// Anything else stays a generic server error.
type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

async function attempt<T extends object>(fn: () => Promise<T> | T): Promise<Result<T>> {
  try {
    return { ok: true, ...(await fn()) };
  } catch (error) {
    if (error instanceof Error && !(error as { code?: unknown }).code) {
      return { ok: false, error: error.message };
    }
    throw error;
  }
}

// Inputs arrive from the browser, so every field is checked at runtime.
function text(value: unknown, field: string, maxLength = 200): string {
  if (typeof value !== "string") throw new TypeError(`${field} is required.`);
  if (value.length > maxLength) throw new TypeError(`${field} is too long.`);
  return value;
}

function nonEmpty(value: unknown, field: string, maxLength = 200): string {
  const result = text(value, field, maxLength).trim();
  if (!result) throw new TypeError(`${field} is required.`);
  return result;
}

function email(value: unknown): string {
  const result = nonEmpty(value, "Email", 254);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result)) throw new TypeError("Enter a valid email.");
  return result;
}

function role(value: unknown): Role {
  if (value !== "admin" && value !== "member") throw new TypeError("Unknown role.");
  return value;
}

function id(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) throw new TypeError("Invalid id.");
  return value;
}

function record(data: unknown): Record<string, unknown> {
  if (typeof data !== "object" || data === null) throw new TypeError("Invalid request.");
  return data as Record<string, unknown>;
}

async function checkedPassword(value: unknown): Promise<string> {
  const password = text(value, "Password", 1000);
  const problem = (await auth()).validatePassword(password);
  if (problem) throw new Error(problem);
  return password;
}

const requireUser = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const user = (await auth()).getCurrentUser();
  if (!user) throw new Error("Your session has expired — sign in again.");
  return next({ context: { user } });
});

const requireAdmin = createMiddleware({ type: "function" })
  .middleware([requireUser])
  .server(({ next, context }) => {
    if (context.user.role !== "admin") throw new Error("Only admins can manage members.");
    return next();
  });

// ---- session -----------------------------------------------------------

export const getAuthState = createServerFn({ method: "GET" }).handler(
  async (): Promise<AuthState> => {
    const { getCurrentUser, hasUsers } = await auth();
    const user = getCurrentUser();
    if (!user)
      return { user, userData: { settings: null, presets: null }, needsSetup: !hasUsers() };
    const { getUserData } = await userData();
    return {
      user,
      userData: {
        settings: getUserData(user.id, "settings"),
        presets: getUserData(user.id, "presets"),
      },
      needsSetup: false,
    };
  },
);

export const loginFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const input = record(data);
    return {
      email: text(input.email, "Email", 254),
      password: text(input.password, "Password", 1000),
    };
  })
  .handler(async ({ data }): Promise<Result> => {
    const error = await (await auth()).login(data.email, data.password);
    return error ? { ok: false, error } : { ok: true };
  });

export const logoutFn = createServerFn({ method: "POST" }).handler(async () => {
  (await auth()).endSession();
});

export const setupFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const input = record(data);
    return {
      email: email(input.email),
      name: nonEmpty(input.name, "Name"),
      password: input.password,
    };
  })
  .handler(({ data }) =>
    attempt(async () => {
      const password = await checkedPassword(data.password);
      await (await auth()).createFirstAdmin(data.email, data.name, password);
      return {};
    }),
  );

export const getInviteFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => ({ token: nonEmpty(record(data).token, "Token", 100) }))
  .handler(async ({ data }) => (await auth()).describeInvite(data.token));

export const acceptInviteFn = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    const input = record(data);
    return { token: nonEmpty(input.token, "Token", 100), password: input.password };
  })
  .handler(({ data }) =>
    attempt(async () => {
      const password = await checkedPassword(data.password);
      await (await auth()).acceptInvite(data.token, password);
      return {};
    }),
  );

export const changePasswordFn = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator((data: unknown) => {
    const input = record(data);
    return { current: text(input.current, "Current password", 1000), next: input.next };
  })
  .handler(({ data, context }) =>
    attempt(async () => {
      const next = await checkedPassword(data.next);
      await (await auth()).changePassword(context.user.id, data.current, next);
      return {};
    }),
  );

// ---- member maintenance (admins only) -----------------------------------

export const listMembersFn = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async ({ context }): Promise<{ members: Member[]; me: SessionUser }> => ({
    members: (await auth()).listMembers(),
    me: context.user,
  }));

export const inviteMemberFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((data: unknown) => {
    const input = record(data);
    return {
      email: email(input.email),
      name: nonEmpty(input.name, "Name"),
      role: role(input.role),
    };
  })
  .handler(({ data }) =>
    attempt(async () => ({
      token: (await auth()).inviteMember(data.email, data.name, data.role),
    })),
  );

export const newSignInLinkFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((data: unknown) => ({ id: id(record(data).id) }))
  .handler(({ data }) => attempt(async () => ({ token: (await auth()).newSignInLink(data.id) })));

export const updateMemberFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((data: unknown) => {
    const input = record(data);
    return {
      id: id(input.id),
      role: input.role === undefined ? undefined : role(input.role),
      disabled: typeof input.disabled === "boolean" ? input.disabled : undefined,
      name: input.name === undefined ? undefined : nonEmpty(input.name, "Name"),
    };
  })
  .handler(({ data, context }) =>
    attempt(async () => {
      const { id: userId, ...changes } = data;
      (await auth()).updateMember(context.user.id, userId, changes);
      return {};
    }),
  );

export const deleteMemberFn = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .validator((data: unknown) => ({ id: id(record(data).id) }))
  .handler(({ data, context }) =>
    attempt(async () => {
      (await auth()).deleteMember(context.user.id, data.id);
      return {};
    }),
  );

// ---- per-member data (settings, presets, mapping progress) --------------

async function dataKey(value: unknown): Promise<string> {
  const key = text(value, "Key", 300);
  if (!(await userData()).isAllowedKey(key)) throw new TypeError("Unknown data key.");
  return key;
}

function prefix(value: unknown): string {
  if (value !== "mapping:") throw new TypeError("Unknown data prefix.");
  return value;
}

export const getUserDataFn = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator((data: unknown) => ({ key: record(data).key }))
  .handler(async ({ data, context }) => {
    const key = await dataKey(data.key);
    return { value: (await userData()).getUserData(context.user.id, key) };
  });

export const setUserDataFn = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator((data: unknown) => {
    const input = record(data);
    return { key: input.key, value: input.value };
  })
  .handler(({ data, context }) =>
    attempt(async () => {
      const key = await dataKey(data.key);
      (await userData()).setUserData(context.user.id, key, data.value);
      return {};
    }),
  );

export const countUserDataFn = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator((data: unknown) => ({ prefix: prefix(record(data).prefix) }))
  .handler(async ({ data, context }) => ({
    count: (await userData()).countUserDataWithPrefix(context.user.id, data.prefix),
  }));

export const clearUserDataFn = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator((data: unknown) => ({ prefix: prefix(record(data).prefix) }))
  .handler(async ({ data, context }) => {
    (await userData()).deleteUserDataWithPrefix(context.user.id, data.prefix);
  });

// Copies what used to be stored in this browser onto the member's account
// (keys they already have win), then returns the preloaded data afresh.
export const importBrowserDataFn = createServerFn({ method: "POST" })
  .middleware([requireUser])
  .validator((data: unknown) => ({ entries: record(record(data).entries) }))
  .handler(async ({ data, context }) => {
    const { getUserData, importMissingUserData } = await userData();
    importMissingUserData(context.user.id, data.entries);
    return {
      settings: getUserData(context.user.id, "settings"),
      presets: getUserData(context.user.id, "presets"),
    };
  });
