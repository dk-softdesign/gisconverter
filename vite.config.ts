import { defineConfig } from "vite";
import { devtools } from "@tanstack/devtools-vite";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  // Bind to all interfaces (not just ::1) so the dev server is reachable via
  // 127.0.0.1 too — needed for devcontainer port forwarding, which targets IPv4.
  // usePolling: native filesystem events don't reliably reach the container
  // across the WSL2/Docker bind mount, so without it edits can go unnoticed
  // until the dev server is restarted.
  server: { host: true, watch: { usePolling: true } },
  plugins: [
    devtools(),
    nitro({ rollupConfig: { external: [/^@sentry\//] } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
});

export default config;
