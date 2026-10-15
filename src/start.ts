import { createCsrfMiddleware, createMiddleware, createStart } from "@tanstack/react-start";

// Defining a start instance replaces TanStack Start's default request
// middleware, so its CSRF check for server functions has to be added back
// explicitly. It also covers the POST API routes.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) =>
    ctx.handlerType === "serverFn" ||
    (ctx.pathname.startsWith("/api/") && ctx.request.method !== "GET"),
});

const PUBLIC_PAGES = ["/login", "/setup"];
const PUBLIC_PREFIXES = ["/invite/"];
const PUBLIC_API = ["/api/health"];

function redirectTo(location: string) {
  return new Response(null, { status: 302, headers: { Location: location } });
}

// The whole app sits behind login. Pages without a session redirect to
// /login (or /setup until the first admin exists), API routes get a 401.
// Server functions do their own checks (see src/lib/auth-functions.ts), since
// the login/setup/invite pages need some of them before anyone is signed in.
const authMiddleware = createMiddleware({ type: "request" }).server(
  async ({ next, pathname, request, handlerType }) => {
    if (handlerType === "serverFn" || PUBLIC_API.includes(pathname)) return next();

    const { getCurrentUser, hasUsers } = await import("#/lib/server/auth");
    const isApi = pathname.startsWith("/api/");
    const isPublicPage =
      PUBLIC_PAGES.includes(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));

    if (!hasUsers()) {
      if (pathname === "/setup") return next();
      return isApi
        ? Response.json({ error: "The app hasn't been set up yet." }, { status: 401 })
        : redirectTo("/setup");
    }
    if (isPublicPage || getCurrentUser()) return next();
    if (isApi) {
      return Response.json({ error: "Your session has expired — sign in again." }, { status: 401 });
    }
    const { pathname: path, search } = new URL(request.url);
    return redirectTo(`/login?redirect=${encodeURIComponent(path + search)}`);
  },
);

export const startInstance = createStart(() => ({
  requestMiddleware: [csrfMiddleware, authMiddleware],
}));
