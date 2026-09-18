// The first wire, reachable as a Provider: the same POST `createLocalMind`
// makes, for a caller whose call is not a mind and whose answer is not a
// proposal. Injected fetch; nothing here reaches a network.
import { describe, it, expect, vi } from "vitest";
import { createHttpProvider } from "./httpProvider.js";

const ok = (content: string) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

function provider(fetchFn: typeof fetch, model = "qwen3.5:27b") {
  return createHttpProvider({ endpoint: "http://a-box:11434/v1", model, fetchFn });
}

describe("createHttpProvider", () => {
  it("returns the model's own text, not a parsed proposal", async () => {
    const fetchFn = vi.fn(async () => ok("  some prose  ")) as unknown as typeof fetch;
    await expect(provider(fetchFn).ask("a question")).resolves.toEqual({
      ok: true,
      text: "some prose",
    });
  });

  it("sends no tools and does not stream, like the mind wire it shares", async () => {
    const fetchFn = vi.fn(async () => ok("x")) as unknown as typeof fetch;
    await provider(fetchFn).ask("a question");
    const body = JSON.parse((fetchFn as unknown as { mock: { calls: [string, { body: string }][] } }).mock.calls[0][1].body);
    expect(body.tools).toEqual([]);
    expect(body.stream).toBe(false);
    expect(body.model).toBe("qwen3.5:27b");
    expect(body.messages).toEqual([{ role: "user", content: "a question" }]);
  });

  it("carries no credential header", async () => {
    const fetchFn = vi.fn(async () => ok("x")) as unknown as typeof fetch;
    await provider(fetchFn).ask("a question");
    const headers = (fetchFn as unknown as { mock: { calls: [string, { headers: Record<string, string> }][] } })
      .mock.calls[0][1].headers;
    expect(Object.keys(headers).map((k) => k.toLowerCase())).toEqual(["content-type"]);
  });

  it("is silent with a reason rather than throwing", async () => {
    const unreachable = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    await expect(provider(unreachable).ask("q")).resolves.toEqual({ ok: false, reason: "unreachable" });

    const bad = vi.fn(async () => new Response("nope", { status: 500 })) as unknown as typeof fetch;
    await expect(provider(bad).ask("q")).resolves.toEqual({ ok: false, reason: "status" });

    const empty = vi.fn(async () => ok("   ")) as unknown as typeof fetch;
    await expect(provider(empty).ask("q")).resolves.toMatchObject({ ok: false, reason: "unparseable" });
  });

  it("reports its kind and model, so a transcript can name what answered", () => {
    const fetchFn = vi.fn() as unknown as typeof fetch;
    const p = provider(fetchFn, "ancient-awakening:12b");
    expect(p.kind).toBe("http");
    expect(p.model).toBe("ancient-awakening:12b");
  });
});
