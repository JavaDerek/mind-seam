// createLocalMind, coerceProposal, firstJsonObject (DESIGN §7.3,
// seam-S1-wire.md). Every test here runs offline against an injected fetch.
// Written before src/wire/localMind.ts exists.
import { describe, it, expect, vi } from "vitest";
import {
  createLocalMind,
  coerceProposal,
  firstJsonObject,
  type SilenceReason,
  type SilenceDetail,
} from "./localMind.js";
import { assertInert, type InertRecord, type Proposal } from "../types.js";

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

describe("createLocalMind — responseFormat (opt-in JSON mode)", () => {
  it("sends a body byte-for-byte identical to today's when responseFormat is not set", async () => {
    const { fetchFn, init } = capturingFetch(jsonResponse(JSON.stringify({ intent: "x" })));
    const mind = createLocalMind<Ctx, Proposal>({
      baseUrl: "http://endpoint/v1",
      model: "m",
      prompt: (c) => c.briefing,
      coerce: identityCoerce,
      fetchFn,
    });

    await mind.consider({ briefing: "hello" });
    expect(init().body).toBe(
      JSON.stringify({
        model: "m",
        messages: [{ role: "user", content: "hello" }],
        tools: [],
        temperature: 0.9,
        stream: false,
      })
    );
  });

  it("sends response_format: { type: 'json_object' } when responseFormat: 'json' is set", async () => {
    const { fetchFn, body } = capturingFetch(jsonResponse(JSON.stringify({ intent: "x" })));
    const mind = createLocalMind<Ctx, Proposal>({
      baseUrl: "http://endpoint/v1",
      model: "m",
      prompt: (c) => c.briefing,
      coerce: identityCoerce,
      responseFormat: "json",
      fetchFn,
    });

    await mind.consider({ briefing: "hello" });
    expect(body().response_format).toEqual({ type: "json_object" });
  });

  it("sends a strict json_schema response_format, named 'proposal' by default", async () => {
    const { fetchFn, body } = capturingFetch(jsonResponse(JSON.stringify({ intent: "x" })));
    const schema = {
      type: "object",
      properties: { intent: { type: "string" } },
      required: ["intent"],
    };
    const mind = createLocalMind<Ctx, Proposal>({
      baseUrl: "http://endpoint/v1",
      model: "m",
      prompt: (c) => c.briefing,
      coerce: identityCoerce,
      responseFormat: { jsonSchema: schema },
      fetchFn,
    });

    await mind.consider({ briefing: "hello" });
    expect(body().response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "proposal", strict: true, schema },
    });
  });

  it("uses the caller-supplied name for the json_schema response_format", async () => {
    const { fetchFn, body } = capturingFetch(jsonResponse(JSON.stringify({ intent: "x" })));
    const schema = { type: "object", properties: {} };
    const mind = createLocalMind<Ctx, Proposal>({
      baseUrl: "http://endpoint/v1",
      model: "m",
      prompt: (c) => c.briefing,
      coerce: identityCoerce,
      responseFormat: { jsonSchema: schema, name: "rival_proposal" },
      fetchFn,
    });

    await mind.consider({ briefing: "hello" });
    expect(body().response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "rival_proposal", strict: true, schema },
    });
  });

  it("throws at construction when the schema is not inert, before any fetch", () => {
    const fetchFn = vi.fn();
    const notInert: Record<string, unknown> = { type: "object" };
    Object.defineProperty(notInert, "properties", {
      get: () => ({}),
      enumerable: true,
      configurable: true,
    });

    expect(() =>
      createLocalMind<Ctx, Proposal>({
        baseUrl: "http://endpoint/v1",
        model: "m",
        prompt: (c) => c.briefing,
        coerce: identityCoerce,
        responseFormat: { jsonSchema: notInert as InertRecord },
        fetchFn: fetchFn as unknown as typeof fetch,
      })
    ).toThrow(/properties/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("still runs coerce on the answer, and still rejects, when responseFormat requests a schema", async () => {
    const reasons: SilenceReason[] = [];
    const { fetchFn } = capturingFetch(jsonResponse(JSON.stringify({ nothing: "usable" })));
    const mind = createLocalMind<Ctx, Proposal>({
      baseUrl: "http://endpoint/v1",
      model: "m",
      prompt: (c) => c.briefing,
      coerce: identityCoerce,
      responseFormat: { jsonSchema: { type: "object" } },
      fetchFn,
      onSilence: (reason) => reasons.push(reason),
    });

    await expect(mind.consider({ briefing: "hello" })).resolves.toBeNull();
    expect(reasons).toEqual(["rejected"]);
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

describe("createLocalMind — onSilence's detail argument", () => {
  it("omits the detail argument entirely for unreachable, timeout, and status", async () => {
    const calls: unknown[][] = [];
    const onSilence = vi.fn((...args: unknown[]) => calls.push(args));

    const unreachable = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    await createLocalMind<Ctx, Proposal>({
      baseUrl: "http://endpoint/v1",
      model: "m",
      prompt: (c) => c.briefing,
      coerce: identityCoerce,
      fetchFn: unreachable,
      onSilence,
    }).consider({ briefing: "hello" });

    const timeout = vi.fn(async () => {
      throw new DOMException("timed out", "TimeoutError");
    }) as unknown as typeof fetch;
    await createLocalMind<Ctx, Proposal>({
      baseUrl: "http://endpoint/v1",
      model: "m",
      prompt: (c) => c.briefing,
      coerce: identityCoerce,
      fetchFn: timeout,
      onSilence,
    }).consider({ briefing: "hello" });

    const status = vi.fn(async () => new Response("nope", { status: 503 })) as unknown as typeof fetch;
    await createLocalMind<Ctx, Proposal>({
      baseUrl: "http://endpoint/v1",
      model: "m",
      prompt: (c) => c.briefing,
      coerce: identityCoerce,
      fetchFn: status,
      onSilence,
    }).consider({ briefing: "hello" });

    expect(calls).toEqual([
      ["unreachable", { briefing: "hello" }],
      ["timeout", { briefing: "hello" }],
      ["status", { briefing: "hello" }],
    ]);
  });

  it("passes detail.text = the raw response body when the outer body is not JSON at all", async () => {
    const details: (SilenceDetail | undefined)[] = [];
    const fetchFn = vi.fn(async () => new Response("not json at all", { status: 200 })) as unknown as typeof fetch;
    const mind = createLocalMind<Ctx, Proposal>({
      baseUrl: "http://endpoint/v1",
      model: "m",
      prompt: (c) => c.briefing,
      coerce: identityCoerce,
      fetchFn,
      onSilence: (_reason, _context, detail) => details.push(detail),
    });

    await mind.consider({ briefing: "hello" });
    expect(details).toEqual([{ text: "not json at all" }]);
  });

  it("passes detail.text = the raw response body when choices[0].message.content is missing", async () => {
    const details: (SilenceDetail | undefined)[] = [];
    const rawBody = JSON.stringify({ choices: [{ message: {} }] });
    const fetchFn = vi.fn(
      async () => new Response(rawBody, { status: 200 })
    ) as unknown as typeof fetch;
    const mind = createLocalMind<Ctx, Proposal>({
      baseUrl: "http://endpoint/v1",
      model: "m",
      prompt: (c) => c.briefing,
      coerce: identityCoerce,
      fetchFn,
      onSilence: (_reason, _context, detail) => details.push(detail),
    });

    await mind.consider({ briefing: "hello" });
    expect(details).toEqual([{ text: rawBody }]);
  });

  it("passes detail.text = the model's message content when it has no JSON object inside", async () => {
    const details: (SilenceDetail | undefined)[] = [];
    const fetchFn = vi.fn(
      async () => jsonResponse("just talking, no object here")
    ) as unknown as typeof fetch;
    const mind = createLocalMind<Ctx, Proposal>({
      baseUrl: "http://endpoint/v1",
      model: "m",
      prompt: (c) => c.briefing,
      coerce: identityCoerce,
      fetchFn,
      onSilence: (_reason, _context, detail) => details.push(detail),
    });

    await mind.consider({ briefing: "hello" });
    expect(details).toEqual([{ text: "just talking, no object here" }]);
  });

  it("passes detail.text and detail.parsed when coerce rejects the parsed object (reason: rejected)", async () => {
    const details: (SilenceDetail | undefined)[] = [];
    const { fetchFn } = capturingFetch(jsonResponse(JSON.stringify({ nothing: "usable" })));
    const mind = createLocalMind<Ctx, Proposal>({
      baseUrl: "http://endpoint/v1",
      model: "m",
      prompt: (c) => c.briefing,
      coerce: identityCoerce,
      fetchFn,
      onSilence: (_reason, _context, detail) => details.push(detail),
    });

    await mind.consider({ briefing: "hello" });
    expect(details).toEqual([
      { text: JSON.stringify({ nothing: "usable" }), parsed: { nothing: "usable" } },
    ]);
  });

  it("detail.parsed is Inert", async () => {
    let parsed: unknown;
    const { fetchFn } = capturingFetch(jsonResponse(JSON.stringify({ nothing: "usable" })));
    const mind = createLocalMind<Ctx, Proposal>({
      baseUrl: "http://endpoint/v1",
      model: "m",
      prompt: (c) => c.briefing,
      coerce: identityCoerce,
      fetchFn,
      onSilence: (_reason, _context, detail) => (parsed = detail?.parsed),
    });

    await mind.consider({ briefing: "hello" });
    expect(() => assertInert(parsed, "detail.parsed")).not.toThrow();
  });

  it("existing two-argument onSilence callbacks keep working", async () => {
    const reasons: SilenceReason[] = [];
    const fetchFn = vi.fn(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    const mind = createLocalMind<Ctx, Proposal>({
      baseUrl: "http://endpoint/v1",
      model: "m",
      prompt: (c) => c.briefing,
      coerce: identityCoerce,
      fetchFn,
      onSilence: (reason, context) => {
        reasons.push(reason);
        expect(context).toEqual({ briefing: "hello" });
      },
    });

    await mind.consider({ briefing: "hello" });
    expect(reasons).toEqual(["status"]);
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
