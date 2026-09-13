// The wire: the seam's one piece of behaviour (DESIGN §7.3). A POST to an
// OpenAI-compatible endpoint with `tools: []`, no credential of any kind, and
// every failure returned as `null` with a reason -- never thrown, never hung.
import { assertInert, type InertRecord, type Mind, type Proposal } from "../types.js";

export type SilenceReason = "unreachable" | "timeout" | "status" | "unparseable" | "rejected";

export interface CreateLocalMindOptions<C extends InertRecord, P extends Proposal> {
  /** Required: the package knows nobody's box. A hostname is configuration. */
  baseUrl: string;
  model: string;
  /** The caller's; pure; built from context alone. */
  prompt: (context: C) => string;
  /** The caller's; pure; composes coerceProposal(). */
  coerce: (raw: unknown, context: C) => P | null;
  /** Default 0.9 — warm, because a mind cannot write. */
  temperature?: number;
  /** Default 12_000ms — a slow box costs an opinion, never the turn. */
  timeoutMs?: number;
  /** Injectable, so every test runs offline. */
  fetchFn?: typeof fetch;
  onSilence?: (reason: SilenceReason, context: C) => void;
}

const DEFAULT_TEMPERATURE = 0.9;
const DEFAULT_TIMEOUT_MS = 12_000;

/**
 * A mind backed by a local OpenAI-compatible endpoint.
 *
 * `assertInert(context)` runs first and throws if it fails -- a non-inert
 * context reaching the wire is a programming error, not a quiet model.
 * Everything past that line either resolves to `P | null`; it never throws
 * and never hangs.
 */
export function createLocalMind<C extends InertRecord, P extends Proposal>(
  options: CreateLocalMindOptions<C, P>
): Mind<C, P> {
  const {
    baseUrl,
    model,
    prompt,
    coerce,
    temperature = DEFAULT_TEMPERATURE,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchFn = fetch,
    onSilence,
  } = options;

  return {
    async consider(context: C): Promise<P | null> {
      assertInert(context, "context");

      const silence = (reason: SilenceReason): null => {
        onSilence?.(reason, context);
        return null;
      };

      let response: Response;
      try {
        response = await fetchFn(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: prompt(context) }],
            tools: [],
            temperature,
            stream: false,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        if (isTimeoutError(error)) return silence("timeout");
        return silence("unreachable");
      }

      if (!response.ok) {
        return silence("status");
      }

      const bodyText = await response.text();
      let body: unknown;
      try {
        body = JSON.parse(bodyText);
      } catch {
        return silence("unparseable");
      }

      const content = (
        body as { choices?: Array<{ message?: { content?: unknown } }> } | null
      )?.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        return silence("unparseable");
      }

      const raw = firstJsonObject(content);
      if (raw === null) {
        return silence("unparseable");
      }

      const proposal = coerce(raw, context);
      if (proposal === null) {
        return silence("rejected");
      }
      return proposal;
    },
  };
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "TimeoutError";
}

/**
 * intent required and non-empty after trim; line optional; both trimmed and
 * capped. Anything else -> null.
 */
export function coerceProposal(raw: unknown, maxLength = 600): Proposal | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;

  const intent = cleanText(record.intent, maxLength);
  if (intent === null) return null;

  const line = cleanText(record.line, maxLength);
  return line === null ? { intent } : { intent, line };
}

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
}

/**
 * JSON, or nothing: the whole string parsed first; else the first balanced
 * `{...}` in it; else null. A small model wrapping its object in a fence or a
 * sentence is the ordinary case, not an exception.
 */
export function firstJsonObject(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through to the balanced-brace search below
  }

  const start = trimmed.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  for (let i = start; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (char === "{") depth++;
    else if (char === "}") {
      depth--;
      if (depth === 0) {
        const candidate = trimmed.slice(start, i + 1);
        try {
          return JSON.parse(candidate);
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
