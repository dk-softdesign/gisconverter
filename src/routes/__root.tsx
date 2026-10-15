import { useEffect } from "react";
import {
  HeadContent,
  Link,
  ScriptOnce,
  Scripts,
  createRootRouteWithContext,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { TanStackDevtools } from "@tanstack/react-devtools";

import { Button } from "#/components/ui/button";
import { Toaster } from "#/components/ui/sonner";
import { authQueryOptions } from "#/lib/auth-query";
import {
  getSettings,
  resolveTheme,
  SETTINGS_STORAGE_KEY,
  subscribeToColorScheme,
  subscribeToSettings,
} from "#/lib/settings";
import TanStackQueryDevtools from "../integrations/tanstack-query/devtools";

import appCss from "../styles.css?url";

import type { QueryClient } from "@tanstack/react-query";

interface MyRouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
  beforeLoad: async ({ context }) => ({
    auth: await context.queryClient.ensureQueryData(authQueryOptions()),
  }),
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      {
        title: "GIS Converter",
      },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
  }),
  notFoundComponent: NotFound,
  shellComponent: RootDocument,
});

function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-4xl font-bold">404</h1>
      <p className="text-lg text-muted-foreground">This page doesn&apos;t exist.</p>
      <Button asChild>
        <Link to="/" className="text-primary-foreground!">
          Go back home
        </Link>
      </Button>
    </div>
  );
}

// The inline script above sets the initial theme before first paint; this
// keeps it in step afterwards (settings changes, OS theme changes under
// "System"). Reads the store directly rather than through useSettings, which
// reports the defaults during hydration and would briefly undo a dark theme.
function ThemeSync() {
  useEffect(() => {
    function apply() {
      const dark = resolveTheme(getSettings().theme) === "dark";
      document.documentElement.classList.toggle("dark", dark);
    }
    apply();
    const unsubscribeSettings = subscribeToSettings(apply);
    const unsubscribeColorScheme = subscribeToColorScheme(apply);
    return () => {
      unsubscribeSettings();
      unsubscribeColorScheme();
    };
  }, []);
  return null;
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <ScriptOnce>
          {`(function () {
            try {
              var settings = JSON.parse(localStorage.getItem('${SETTINGS_STORAGE_KEY}') || '{}');
              var theme = settings.theme || localStorage.getItem('theme') || 'system';
              var isDark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
              if (isDark) document.documentElement.classList.add('dark');
            } catch (e) {}
          })();`}
        </ScriptOnce>
      </head>
      <body>
        <ThemeSync />
        {children}
        <Toaster position="bottom-center" />
        <TanStackDevtools
          config={{
            position: "bottom-right",
          }}
          plugins={[
            {
              name: "Tanstack Router",
              render: <TanStackRouterDevtoolsPanel />,
            },
            TanStackQueryDevtools,
          ]}
        />
        <Scripts />
      </body>
    </html>
  );
}
