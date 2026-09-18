// The first wire, as a Provider.
//
// `createLocalMind` makes this same POST and then parses a proposal out of the
// answer. A caller whose call is not a mind -- a classifier reading a turn, a
// model asked for prose -- wants the POST and its failure discipline without
// the proposal. This is that, and it is the adapter BOTH local models share:
// which one answers is a model name, not a code path.
import type { Provider, ProviderAnswer, AskOptions } from "./provider.js";
import { responseFormatBody } from "./localMind.js";

const DEFAULT_TEMPERATURE = 0.9;
const DEFAULT_TIMEOUT_MS = 12_000;

export interface CreateHttpProviderOptions {
  /** Required: the package knows nobody's box. An address is configuration. */
  endpoint: string;
  model: string;
  temperature?: number;
  timeoutMs?: number;
  /** Injectable, so every test runs offline. */
  fetchFn?: typeof fetch;
}

export function createHttpProvider(options: CreateHttpProviderOptions): Provider {
  const {
    endpoint,
    model,
    temperature = DEFAULT_TEMPERATURE,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchFn = fetch,
  } = options;

  return {
    kind: "http",
    model,

    async ask(prompt: string, askOptions: AskOptions = {}): Promise<ProviderAnswer> {
      const format = askOptions.responseFormat;

      let response: Response;
      try {
        response = await fetchFn(`${endpoint}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: prompt }],
            tools: [],
            temperature: askOptions.temperature ?? temperature,
            stream: false,
            ...(format === undefined ? {} : { response_format: responseFormatBody(format) }),
          }),
          signal: AbortSignal.timeout(askOptions.timeoutMs ?? timeoutMs),
        });
      } catch (error) {
        const name = (error as { name?: string } | null)?.name;
        return { ok: false, reason: name === "TimeoutError" ? "timeout" : "unreachable" };
      }

      if (!response.ok) return { ok: false, reason: "status" };

      const bodyText = await response.text();
      let body: unknown;
      try {
        body = JSON.parse(bodyText);
      } catch {
        return { ok: false, reason: "unparseable", detail: { text: bodyText } };
      }

      const content = (body as { choices?: Array<{ message?: { content?: unknown } }> } | null)
        ?.choices?.[0]?.message?.content;
      if (typeof content !== "string" || content.trim() === "") {
        return { ok: false, reason: "unparseable", detail: { text: bodyText } };
      }

      return { ok: true, text: content.trim() };
    },
  };
}
