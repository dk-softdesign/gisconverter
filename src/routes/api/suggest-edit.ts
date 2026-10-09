import Anthropic from "@anthropic-ai/sdk";
import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

const MAX_INSTRUCTION_LENGTH = 2000;
const MAX_SAMPLES = 20;
const MAX_SAMPLE_VALUE_LENGTH = 200;

type SuggestMode = "replace" | "script";

interface SuggestRequest {
  mode: SuggestMode;
  instruction: string;
  scopeKey: string | null;
  samples: Record<string, unknown>[];
}

const SYSTEM_PROMPT = `You help users of a GIS converter clean up GeoJSON feature properties in bulk.
The user describes the change they want in plain language; you turn it into something the app can run.
You get the property keys and a few sample property objects from the features they selected — base
your answer on what those values actually look like.

Modes:
- "replace": produce a JavaScript regular expression (source only, no slashes or flags) and a
  replacement string for String.prototype.replace. The app always adds the "g" flag; set
  caseInsensitive when the "i" flag is needed. Use $1, $2, $<name> for capture groups. Each property
  value is converted to a string, replaced, then converted back to a number/boolean if it looks like
  one. If scopeKey is given only that property is touched, otherwise every property is.
- "script": produce a JavaScript function body. It receives \`props\` (a shallow copy of the feature's
  properties) and \`feature\` (the GeoJSON feature), and must \`return\` the full new properties object.
  Guard against null/undefined/non-string values. No imports, no async, no network.

Keep the explanation to one or two short sentences.`;

const RESPONSE_SCHEMAS: Record<SuggestMode, Record<string, unknown>> = {
  replace: {
    type: "object",
    properties: {
      pattern: { type: "string" },
      replacement: { type: "string" },
      caseInsensitive: { type: "boolean" },
      explanation: { type: "string" },
    },
    required: ["pattern", "replacement", "caseInsensitive", "explanation"],
    additionalProperties: false,
  },
  script: {
    type: "object",
    properties: {
      script: { type: "string" },
      explanation: { type: "string" },
    },
    required: ["script", "explanation"],
    additionalProperties: false,
  },
};

function truncateSample(sample: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(sample)) {
    out[key] =
      typeof value === "string" && value.length > MAX_SAMPLE_VALUE_LENGTH
        ? `${value.slice(0, MAX_SAMPLE_VALUE_LENGTH)}…`
        : value;
  }
  return out;
}

function parseRequest(body: unknown): SuggestRequest | null {
  if (!body || typeof body !== "object") return null;
  const { mode, instruction, scopeKey, samples } = body as Record<string, unknown>;
  if (mode !== "replace" && mode !== "script") return null;
  if (typeof instruction !== "string" || !instruction.trim()) return null;
  if (instruction.length > MAX_INSTRUCTION_LENGTH) return null;
  if (!Array.isArray(samples)) return null;
  return {
    mode,
    instruction: instruction.trim(),
    scopeKey: typeof scopeKey === "string" ? scopeKey : null,
    samples: samples
      .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
      .slice(0, MAX_SAMPLES)
      .map(truncateSample),
  };
}

// Turns a plain-language instruction into a regex or a script for the bulk
// edit dialog. The key stays server-side (ANTHROPIC_API_KEY); the browser only
// ever sees the generated suggestion.
export const Route = createFileRoute("/api/suggest-edit")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!process.env.ANTHROPIC_API_KEY) {
          return Response.json(
            { error: "Claude isn't configured — set ANTHROPIC_API_KEY on the server." },
            { status: 503 },
          );
        }

        const parsed = parseRequest(await request.json().catch(() => null));
        if (!parsed) return Response.json({ error: "Invalid request." }, { status: 400 });

        const keys = [...new Set(parsed.samples.flatMap((s) => Object.keys(s)))];
        const userContent = JSON.stringify(
          {
            mode: parsed.mode,
            instruction: parsed.instruction,
            scopeKey: parsed.mode === "replace" ? parsed.scopeKey : undefined,
            propertyKeys: keys,
            samples: parsed.samples,
          },
          null,
          2,
        );

        const client = new Anthropic();
        try {
          const response = await client.beta.messages.create({
            model: "claude-opus-5",
            max_tokens: 16000,
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            system: SYSTEM_PROMPT,
            output_config: {
              effort: "medium",
              format: { type: "json_schema", schema: RESPONSE_SCHEMAS[parsed.mode] },
            },
            messages: [{ role: "user", content: userContent }],
          });

          if (response.stop_reason === "refusal") {
            return Response.json({ error: "Claude declined this request." }, { status: 422 });
          }
          const text = response.content.find((block) => block.type === "text");
          if (!text || text.type !== "text") {
            return Response.json({ error: "Claude returned no suggestion." }, { status: 502 });
          }
          return Response.json(JSON.parse(text.text));
        } catch (error) {
          if (error instanceof Anthropic.AuthenticationError) {
            return Response.json(
              { error: "The server's Anthropic API key was rejected." },
              { status: 502 },
            );
          }
          if (error instanceof Anthropic.RateLimitError) {
            return Response.json(
              { error: "Claude is rate limited — try again shortly." },
              { status: 429 },
            );
          }
          if (error instanceof Anthropic.APIError) {
            return Response.json(
              { error: `Claude request failed: ${error.message}` },
              { status: 502 },
            );
          }
          return Response.json(
            { error: error instanceof Error ? error.message : "Claude request failed." },
            { status: 500 },
          );
        }
      },
    },
  },
});
