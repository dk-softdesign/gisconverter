import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

// Public liveness check for Docker/Swarm — everything else needs a login.
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: () => Response.json({ ok: true }),
    },
  },
});
