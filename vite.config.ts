import { defineConfig, lazyPlugins } from "vite-plus";
import { devtools } from "@tanstack/devtools-vite";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

const config = defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    ignorePatterns: ["src/routeTree.gen.ts"],
  },
  lint: {
    plugins: ["typescript", "unicorn", "oxc", "react", "react-perf", "jsx-a11y", "node"],
    categories: {
      correctness: "error",
    },
    rules: {
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    env: {
      builtin: true,
    },
    ignorePatterns: ["src/routeTree.gen.ts"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    jsPlugins: [
      {
        name: "vite-plus",
        specifier: "vite-plus/oxlint-plugin",
      },
    ],
  },
  resolve: { tsconfigPaths: true },
  // Bind to all interfaces (not just ::1) so the dev server is reachable via
  // 127.0.0.1 too — needed for devcontainer port forwarding, which targets IPv4.
  // usePolling: native filesystem events don't reliably reach the container
  // across the WSL2/Docker bind mount, so without it edits can go unnoticed
  // until the dev server is restarted.
  server: { host: true, watch: { usePolling: true } },
  plugins: lazyPlugins(() => [
    devtools(),
    nitro({ rollupConfig: { external: [/^@sentry\//] } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ]),
});

export default config;
