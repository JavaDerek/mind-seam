// The wire: the seam's one piece of behaviour (DESIGN §7.3). A POST to an
// OpenAI-compatible endpoint with `tools: []`, no credential of any kind, and
// every failure returned as `null` with a reason -- never thrown, never hung.
import { assertInert, type Inert, type InertRecord, type Mind, type Proposal } from "../types.js";

export type SilenceReason = "unreachable" | "timeout" | "status" | "unparseable" | "rejected";

/**
 * What went past silence, when there is anything to say. `text` is the
 * closest thing to "what the model actually sent" available at the point of
 * failure -- the extracted `message.content` once that much parsed, or the
 * raw HTTP body when even that failed. `parsed` is the JSON value
 * `firstJsonObject` pulled out of `text`, present only when parsing got that
 * far and `coerce` is what rejected it (reason `"rejected"`). Neither field
 * applies to `"unreachable"`, `"timeout"`, or `"status"` -- those pass no
 * detail at all, so an existing two-argument `onSilence` keeps working
 * unchanged. `parsed` is always `Inert`: it comes straight out of
 * `JSON.parse`, which never produces a function, a symbol, or a getter.
 */
export interface SilenceDetail {
  text?: string;
  parsed?: Inert;
}

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
  /**
   * Opt-in: `"json"` sends `response_format: { type: "json_object" }`, which
   * an OpenAI-compatible endpoint uses to constrain generation to a JSON
   * object instead of leaving JSON-or-prose to the model's own habits.
   * Omitted, the request body is byte-for-byte what it always was.
   */
  responseFormat?: "json";
  /** Injectable, so every test runs offline. */
  fetchFn?: typeof fetch;
  onSilence?: (reason: SilenceReason, context: C, detail?: SilenceDetail) => void;
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
    responseFormat,
    fetchFn = fetch,
    onSilence,
  } = options;

  return {
    async consider(context: C): Promise<P | null> {
      assertInert(context, "context");

      // No `detail` argument at all for a reason that has none -- keeps a
      // caller's existing two-argument onSilence working unchanged.
      const silence = (reason: SilenceReason, detail?: SilenceDetail): null => {
        if (detail === undefined) {
          onSilence?.(reason, context);
        } else {
          onSilence?.(reason, context, detail);
        }
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
            ...(responseFormat === "json" ? { response_format: { type: "json_object" } } : {}),
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
        return silence("unparseable", { text: bodyText });
      }

      const content = (
        body as { choices?: Array<{ message?: { content?: unknown } }> } | null
      )?.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        return silence("unparseable", { text: bodyText });
      }

      const raw = firstJsonObject(content);
      if (raw === null) {
        return silence("unparseable", { text: content });
      }

      const proposal = coerce(raw, context);
      if (proposal === null) {
        return silence("rejected", { text: content, parsed: raw as Inert });
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
