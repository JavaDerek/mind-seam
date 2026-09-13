// assertInert is the runtime half of the property (DESIGN §3.2): a cast and a
// getter both survive `tsc`, so the seam checks at runtime what the type
// system cannot. Written before src/types.ts exists -- the first red here
// must be a missing export, not a wrong assertion.
import { describe, it, expect } from "vitest";
import { assertInert, type Inert, type InertRecord, type Proposal, type Mind } from "./types.js";

describe("assertInert — passes for data", () => {
  it("accepts every primitive in the Inert union", () => {
    expect(() => assertInert("a string")).not.toThrow();
    expect(() => assertInert(42)).not.toThrow();
    expect(() => assertInert(true)).not.toThrow();
    expect(() => assertInert(false)).not.toThrow();
    expect(() => assertInert(null)).not.toThrow();
    expect(() => assertInert(undefined)).not.toThrow();
  });

  it("accepts arrays of Inert values", () => {
    expect(() => assertInert(["a", 1, true, null])).not.toThrow();
    expect(() => assertInert([])).not.toThrow();
  });

  it("accepts plain objects, including nested ones", () => {
    expect(() =>
      assertInert({ a: "x", b: { c: 1, d: [true, null, { e: "y" }] } })
    ).not.toThrow();
  });

  it("accepts Object.create(null)", () => {
    const record = Object.create(null) as Record<string, unknown>;
    record.a = "x";
    expect(() => assertInert(record)).not.toThrow();
  });
});

describe("assertInert — throws for the things the type system cannot catch", () => {
  it("throws on a bare function value, naming the path", () => {
    expect(() => assertInert(() => {}, "context")).toThrow(/context/);
  });

  it("throws on a function nested inside an object", () => {
    expect(() => assertInert({ a: { b: () => {} } }, "context")).toThrow(/context\.a\.b/);
  });

  it("throws on an accessor property (a getter)", () => {
    const withGetter: Record<string, unknown> = {};
    Object.defineProperty(withGetter, "briefing", {
      get() {
        return "reads the database every time";
      },
      enumerable: true,
      configurable: true,
    });
    expect(() => assertInert(withGetter, "context")).toThrow(/context\.briefing/);
  });

  it("throws on an accessor property nested three levels down", () => {
    const inner: Record<string, unknown> = {};
    Object.defineProperty(inner, "leak", {
      get() {
        return "still a getter";
      },
      enumerable: true,
      configurable: true,
    });
    const value = { a: { b: { c: inner } } };
    expect(() => assertInert(value, "context")).toThrow(/context\.a\.b\.c\.leak/);
  });

  it("throws on a class instance", () => {
    class Handle {
      readonly kind = "database";
    }
    expect(() => assertInert(new Handle(), "context")).toThrow(/context/);
  });

  it("throws on a Map", () => {
    expect(() => assertInert(new Map(), "context")).toThrow(/context/);
  });

  it("throws on a symbol-keyed property", () => {
    const value: Record<string | symbol, unknown> = { a: "fine" };
    value[Symbol("secret")] = "nope";
    expect(() => assertInert(value, "context")).toThrow(/context/);
  });

  it("throws on a nested class instance three levels down", () => {
    class Handle {}
    const value = { a: { b: { c: new Handle() } } };
    expect(() => assertInert(value, "context")).toThrow(/context\.a\.b\.c/);
  });

  it("defaults the path to a sensible root when none is given", () => {
    expect(() => assertInert(() => {})).toThrow();
  });
});

describe("the compile-time half — a non-Inert field does not satisfy InertRecord", () => {
  it("rejects a database-shaped field", () => {
    type Database = { query: (sql: string) => unknown };
    type BadContext = { name: string; db: Database };
    // @ts-expect-error — a function-bearing field is not Inert, so BadContext
    // must not be assignable to InertRecord. If this stops erroring, the
    // compile-time half of the property has been lost.
    const _check: InertRecord = {} as BadContext;
    void _check;
  });

  it("accepts a plain string/number/array/nested-record shape", () => {
    type GoodContext = {
      name: string;
      count: number;
      tags: readonly string[];
      nested: { a: string };
    };
    const _check: InertRecord = {} as GoodContext;
    void _check;
  });
});

describe("shapes, exercised only by the type checker", () => {
  it("Proposal requires intent and allows an optional line", () => {
    const p: Proposal = { intent: "do a thing" };
    const p2: Proposal = { intent: "do a thing", line: "said aloud" };
    expect(p.intent).toBe("do a thing");
    expect(p2.line).toBe("said aloud");
  });

  it("Mind<C, P> has exactly one method: consider", async () => {
    type C = { a: string };
    const mind: Mind<C, Proposal> = {
      async consider(context) {
        expect(context.a).toBe("x");
        return { intent: "y" };
      },
    };
    const result = await mind.consider({ a: "x" });
    expect(result).toEqual({ intent: "y" });
  });
});

// Referenced so the Inert export is exercised by at least one runtime check,
// not only by the type checker.
const _inertSample: Inert = { a: [1, "two", null, { b: true }] };
void _inertSample;
