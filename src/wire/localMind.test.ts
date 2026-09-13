// createLocalMind, coerceProposal, firstJsonObject (DESIGN §7.3,
// seam-S1-wire.md). Every test here runs offline against an injected fetch.
// Written before src/wire/localMind.ts exists.
import { describe, it, expect, vi } from "vitest";
import {
  createLocalMind,
  coerceProposal,
  firstJsonObject,
  type SilenceReason,
} from "./localMind.js";
import type { InertRecord, Proposal } from "../types.js";

type Ctx = InertRecord & { briefing: string };

function jsonResponse(content: string, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function capturingFetch(response: Response | (() => Response | Promise<Response>)): {
  fetchFn: typeof fetch;
  url: () => string;
  init: () => RequestInit;
  body: () => Record<string, unknown>;
} {
  let capturedUrl = "";
  let capturedInit: RequestInit = {};
  const fetchFn = vi.fn(async (url: unknown, init?: RequestInit) => {
    capturedUrl = String(url);
    capturedInit = init ?? {};
    return typeof response === "function" ? await response() : response;
  }) as unknown as typeof fetch;
  return {
    fetchFn,
    url: () => capturedUrl,
    init: () => capturedInit,
    body: () => JSON.parse((capturedInit.body as string) ?? "{}") as Record<string, unknown>,
  };
}

function identityCoerce(raw: unknown): Proposal | null {
  return coerceProposal(raw);
}

describe("createLocalMind — the request", () => {
  it("POSTs to {baseUrl}/chat/completions", async () => {
    const { fetchFn, url } = capturingFetch(jsonResponse(JSON.stringify({ intent: "x" })));
    const mind = createLocalMind<Ctx, Proposal>({
      baseUrl: "http://endpoint/v1",
      model: "m",
      prompt: (c) => c.briefing,
      coerce: identityCoerce,
      fetchFn,
    });

    await mind.consider({ briefing: "hello" });
    expect(url()).toBe("http://endpoint/v1/chat/completions");
  });

  it("sends tools: [] and stream: false", async () => {
    const { fetchFn, body } = capturingFetch(jsonResponse(JSON.stringify({ intent: "x" })));
    const mind = createLocalMind<Ctx, Proposal>({
      baseUrl: "http://endpoint/v1",
      model: "m",
      prompt: (c) => c.briefing,
      coerce: identityCoerce,
      fetchFn,
    });

    await mind.consider({ briefing: "hello" });
    expect(body().tools).toEqual([]);
    expect(body().stream).toBe(false);
  });

  it("sends the prompt as one user message", async () => {
    const { fetchFn, body } = capturingFetch(jsonResponse(JSON.stringify({ intent: "x" })));
    const mind = createLocalMind<Ctx, Proposal>({
      baseUrl: "http://endpoint/v1",
      model: "m",
      prompt: (c) => `Briefing: ${c.briefing}`,
      coerce: identityCoerce,
      fetchFn,
    });

    await mind.consider({ briefing: "hello" });
    expect(body().messages).toEqual([{ role: "user", content: "Briefing: hello" }]);
    expect(body().model).toBe("m");
  });

  it("sends content-type as the only header — no Authorization, no api-key", async () => {
    const { fetchFn, init } = capturingFetch(jsonResponse(JSON.stringify({ intent: "x" })));
    const mind = createLocalMind<Ctx, Proposal>({
      baseUrl: "http://endpoint/v1",
      model: "m",
      prompt: (c) => c.briefing,
      coerce: identityCoerce,
      fetchFn,
    });

    await mind.consider({ briefing: "hello" });
    const headers = init().headers as Record<string, string>;
    expect(Object.keys(headers).map((h) => h.toLowerCase())).toEqual(["content-type"]);
    for (const name of Object.keys(headers)) {
      expect(name.toLowerCase()).not.toBe("authorization");
      expect(name.toLowerCase()).not.toContain("api-key");
    }
  });

  it("passes temperature through, defaulting to 0.9", async () => {
    const { fetchFn, body } = capturingFetch(jsonResponse(JSON.stringify({ intent: "x" })));
    const mind = createLocalMind<Ctx, Proposal>({
      baseUrl: "http://endpoint/v1",
      model: "m",
      prompt: (c) => c.briefing,
      coerce: identityCoerce,
      fetchFn,
    });
    await mind.consider({ briefing: "hello" });
    expect(body().temperature).toBe(0.9);

    const { fetchFn: fetchFn2, body: body2 } = capturingFetch(
      jsonResponse(JSON.stringify({ intent: "x" }))
    );
    const mind2 = createLocalMind<Ctx, Proposal>({
      baseUrl: "http://endpoint/v1",
      model: "m",
      prompt: (c) => c.briefing,
      coerce: identityCoerce,
      temperature: 0.2,
      fetchFn: fetchFn2,
    });
    await mind2.consider({ briefing: "hello" });
    expect(body2().temperature).toBe(0.2);
  });
});

describe("createLocalMind — success", () => {
  it("returns what coerce produces from the parsed content", async () => {
    const { fetchFn } = capturingFetch(
      jsonResponse(JSON.stringify({ intent: "press the eastern line" }))
    );
    const mind = createLocalMind<Ctx, Proposal>({
      baseUrl: "http://endpoint/v1",
      model: "m",
      prompt: (c) => c.briefing,
      coerce: identityCoerce,
      fetchFn,
    });

    await expect(mind.consider({ briefing: "hello" })).resolves.toEqual({
      intent: "press the eastern line",
    });
  });

  it("passes the parsed value and the context to coerce", async () => {
    const { fetchFn } = capturingFetch(jsonResponse(JSON.stringify({ intent: "x" })));
    const seen: Array<{ raw: unknown; context: Ctx }> = [];
    const mind = createLocalMind<Ctx, Proposal>({
      baseUrl: "http://endpoint/v1",
      model: "m",
      prompt: (c) => c.briefing,
      coerce: (raw, context) => {
        seen.push({ raw, context });
        return coerceProposal(raw);
      },
      fetchFn,
    });

    await mind.consider({ briefing: "hello" });
    expect(seen).toEqual([{ raw: { intent: "x" }, context: { briefing: "hello" } }]);
  });

  it("parses a fenced or sentence-wrapped JSON object", async () => {
    const { fetchFn } = capturingFetch(
      jsonResponse('Sure, here you go:\n```json\n{"intent": "wrapped"}\n```\nHope that helps!')
    );
    const mind = createLocalMind<Ctx, Proposal>({
      baseUrl: "http://endpoint/v1",
      model: "m",
      prompt: (c) => c.briefing,
      coerce: identityCoerce,
      fetchFn,
    });

    await expect(mind.consider({ briefing: "hello" })).resolves.toEqual({ intent: "wrapped" });
  });
});

describe("createLocalMind — every failure is null, with a reason", () => {
  it("unreachable → null, reason unreachable", async () => {
    const reasons: SilenceReason[] = [];
    const fetchFn = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const mind = createLocalMind<Ctx, Proposal>({
      baseUrl: "http://endpoint/v1",
      model: "m",
      prompt: (c) => c.briefing,
      coerce: identityCoerce,
      fetchFn,
      onSilence: (reason) => reasons.push(reason),
    });

    await expect(mind.consider({ briefing: "hello" })).resolves.toBeNull();
    expect(reasons).toEqual(["unreachable"]);
  });

  it("a DOMException named TimeoutError → null, reason timeout", async () => {
    const reasons: SilenceReason[] = [];
    const fetchFn = vi.fn(async () => {
      throw new DOMException("timed out", "TimeoutError");
    }) as unknown as typeof fetch;
    const mind = createLocalMind<Ctx, Proposal>({
      baseUrl: "http://endpoint/v1",
      model: "m",
      prompt: (c) => c.briefing,
      coerce: identityCoerce,
      fetchFn,
      onSilence: (reason) => reasons.push(reason),
    });

    await expect(mind.consider({ briefing: "hello" })).resolves.toBeNull();
    expect(reasons).toEqual(["timeout"]);
  });

  it("non-200 → null, reason status", async () => {
    const reasons: SilenceReason[] = [];
    const fetchFn = vi.fn(async () => new Response("nope", { status: 503 })) as unknown as typeof fetch;
    const mind = createLocalMind<Ctx, Proposal>({
      baseUrl: "http://endpoint/v1",
      model: "m",
      prompt: (c) => c.briefing,
      coerce: identityCoerce,
      fetchFn,
      onSilence: (reason) => reasons.push(reason),
    });

    await expect(mind.consider({ briefing: "hello" })).resolves.toBeNull();
    expect(reasons).toEqual(["status"]);
  });

  it("a body that is not JSON and contains no balanced object → null, reason unparseable", async () => {
    const reasons: SilenceReason[] = [];
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: "no object here" } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
    ) as unknown as typeof fetch;
    const mind = createLocalMind<Ctx, Proposal>({
      baseUrl: "http://endpoint/v1",
      model: "m",
      prompt: (c) => c.briefing,
      coerce: identityCoerce,
      fetchFn,
      onSilence: (reason) => reasons.push(reason),
    });

    await expect(mind.consider({ briefing: "hello" })).resolves.toBeNull();
    expect(reasons).toEqual(["unparseable"]);
  });

  it("a body that is not even JSON at the outer level → null, reason unparseable", async () => {
    const reasons: SilenceReason[] = [];
    const fetchFn = vi.fn(
      async () => new Response("not json at all", { status: 200 })
    ) as unknown as typeof fetch;
    const mind = createLocalMind<Ctx, Proposal>({
      baseUrl: "http://endpoint/v1",
      model: "m",
      prompt: (c) => c.briefing,
      coerce: identityCoerce,
      fetchFn,
      onSilence: (reason) => reasons.push(reason),
    });

    await expect(mind.consider({ briefing: "hello" })).resolves.toBeNull();
    expect(reasons).toEqual(["unparseable"]);
  });

  it("coerce returning null → null, reason rejected", async () => {
    const reasons: SilenceReason[] = [];
    const { fetchFn } = capturingFetch(jsonResponse(JSON.stringify({ nothing: "usable" })));
    const mind = createLocalMind<Ctx, Proposal>({
      baseUrl: "http://endpoint/v1",
      model: "m",
      prompt: (c) => c.briefing,
      coerce: identityCoerce,
      fetchFn,
      onSilence: (reason) => reasons.push(reason),
    });

    await expect(mind.consider({ briefing: "hello" })).resolves.toBeNull();
    expect(reasons).toEqual(["rejected"]);
  });

  it("calls onSilence exactly once per failure", async () => {
    const onSilence = vi.fn();
    const fetchFn = vi.fn(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    const mind = createLocalMind<Ctx, Proposal>({
      baseUrl: "http://endpoint/v1",
      model: "m",
      prompt: (c) => c.briefing,
      coerce: identityCoerce,
      fetchFn,
      onSilence,
    });

    await mind.consider({ briefing: "hello" });
    expect(onSilence).toHaveBeenCalledTimes(1);
    expect(onSilence).toHaveBeenCalledWith("status", { briefing: "hello" });
  });

  it("never throws past assertInert — a failure resolves to null, it does not reject", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("boom");
    }) as unknown as typeof fetch;
    const mind = createLocalMind<Ctx, Proposal>({
      baseUrl: "http://endpoint/v1",
      model: "m",
      prompt: (c) => c.briefing,
      coerce: identityCoerce,
      fetchFn,
    });

    await expect(mind.consider({ briefing: "hello" })).resolves.toBeNull();
  });
});

describe("createLocalMind — the inert-context defect", () => {
  it("throws before any fetch is made when the context has an accessor", async () => {
    const fetchFn = vi.fn();
    const mind = createLocalMind<Ctx, Proposal>({
      baseUrl: "http://endpoint/v1",
      model: "m",
      prompt: (c) => c.briefing,
      coerce: identityCoerce,
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const bad: Record<string, unknown> = {};
    Object.defineProperty(bad, "briefing", { get: () => "reads storage", enumerable: true });

    await expect(mind.consider(bad as Ctx)).rejects.toThrow(/briefing/);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("coerceProposal", () => {
  it("accepts a non-empty intent", () => {
    expect(coerceProposal({ intent: "do a thing" })).toEqual({ intent: "do a thing" });
  });

  it("trims intent and keeps a string line", () => {
    expect(coerceProposal({ intent: "  do a thing  ", line: "  said aloud  " })).toEqual({
      intent: "do a thing",
      line: "said aloud",
    });
  });

  it("drops a non-string line rather than passing it through", () => {
    const proposal = coerceProposal({ intent: "x", line: 42 });
    expect(proposal).toEqual({ intent: "x" });
  });

  it("rejects {} (no intent)", () => {
    expect(coerceProposal({})).toBeNull();
  });

  it("rejects a whitespace-only intent", () => {
    expect(coerceProposal({ intent: "   " })).toBeNull();
  });

  it("rejects a non-string intent", () => {
    expect(coerceProposal({ intent: 7 })).toBeNull();
  });

  it("rejects null", () => {
    expect(coerceProposal(null)).toBeNull();
  });

  it("rejects a bare string", () => {
    expect(coerceProposal("a bare string")).toBeNull();
  });

  it("caps both fields at maxLength (default 600)", () => {
    const proposal = coerceProposal({ intent: "x".repeat(5000) });
    expect(proposal).not.toBeNull();
    expect(proposal!.intent.length).toBe(600);
  });

  it("honors a caller-supplied maxLength", () => {
    const proposal = coerceProposal({ intent: "x".repeat(50) }, 10);
    expect(proposal!.intent.length).toBe(10);
  });
});

describe("firstJsonObject", () => {
  it("parses a whole-string JSON object", () => {
    expect(firstJsonObject('{"a": 1}')).toEqual({ a: 1 });
  });

  it("parses the first balanced object out of a fenced answer", () => {
    expect(firstJsonObject('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
  });

  it("parses the first balanced object out of a sentence-wrapped answer", () => {
    expect(firstJsonObject('Sure! {"a": 1} — hope that helps.')).toEqual({ a: 1 });
  });

  it("returns null for text with no balanced object", () => {
    expect(firstJsonObject("no object here")).toBeNull();
  });

  it("returns null for an empty string", () => {
    expect(firstJsonObject("")).toBeNull();
  });
});
