// SILENT_MIND and scriptedMind (DESIGN §2.2, seam-S0-birth.md). Written before
// src/minds.ts exists.
import { describe, it, expect } from "vitest";
import { SILENT_MIND, scriptedMind } from "./minds.js";
import type { Mind, Proposal, InertRecord } from "./types.js";

describe("SILENT_MIND", () => {
  it("always answers null", async () => {
    await expect(SILENT_MIND.consider({})).resolves.toBeNull();
  });

  it("is assignable to Mind<{ a: string }, Proposal>", async () => {
    const mind: Mind<{ a: string }, Proposal> = SILENT_MIND;
    await expect(mind.consider({ a: "x" })).resolves.toBeNull();
  });

  it("is assignable to Mind<{ b: readonly string[] }, Proposal & { c?: string }>", async () => {
    type Ctx = { b: readonly string[] };
    type Prop = Proposal & { c?: string };
    const mind: Mind<Ctx, Prop> = SILENT_MIND;
    await expect(mind.consider({ b: ["x"] })).resolves.toBeNull();
  });
});

describe("scriptedMind — a fixed proposal", () => {
  it("returns the same proposal twice without consuming it", async () => {
    const proposal: Proposal = { intent: "press on" };
    const mind = scriptedMind<InertRecord, Proposal>(proposal);
    await expect(mind.consider({})).resolves.toEqual(proposal);
    await expect(mind.consider({})).resolves.toEqual(proposal);
  });

  it("returns null for a null script", async () => {
    const mind = scriptedMind<InertRecord, Proposal>(null);
    await expect(mind.consider({})).resolves.toBeNull();
  });
});

describe("scriptedMind — a function script", () => {
  it("sees the context it was given", async () => {
    type Ctx = { seatId: string };
    const seen: Ctx[] = [];
    const mind = scriptedMind<Ctx, Proposal>((context) => {
      seen.push(context);
      return { intent: `acting for ${context.seatId}` };
    });

    await mind.consider({ seatId: "RUSSIA" });
    expect(seen).toEqual([{ seatId: "RUSSIA" }]);
  });

  it("can decline with null", async () => {
    type Ctx = { seatId: string };
    const mind = scriptedMind<Ctx, Proposal>(() => null);
    await expect(mind.consider({ seatId: "RUSSIA" })).resolves.toBeNull();
  });

  it("runs assertInert on the context it captures", async () => {
    type Ctx = InertRecord & { get leak(): string };
    const bad: Record<string, unknown> = {};
    Object.defineProperty(bad, "leak", { get: () => "reads storage", enumerable: true });

    const mind = scriptedMind<Ctx, Proposal>(() => ({ intent: "x" }));
    await expect(mind.consider(bad as Ctx)).rejects.toThrow(/leak/);
  });
});
