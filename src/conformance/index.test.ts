// seamConformance (DESIGN §9, seam-S2-conformance.md). Written before
// src/conformance/index.ts exists -- the first red here must be a missing
// export, not a wrong assertion (§9.4).
//
// Exercised against a REFERENCE HARNESS (a toy world with one bounded
// counter and a one-function referee, no run-dmcp) and four PLANTED
// VIOLATIONS, each a harness that differs from the reference in one line
// (§9.2). Every check is idempotent: `pass` builds a fresh world every call,
// so calling the suite twice against the same harness produces the same
// result.
import { describe, it, expect } from "vitest";
import { seamConformance } from "./index.js";
import {
  makeReferenceHarness,
  makeGetterViolation,
  makeActsOnProseViolation,
  makeCredentialLeakViolation,
  makeVacuousPrivateActViolation,
} from "./__tests__/referenceHarness.js";

async function runAll(checks: readonly { name: string; run(): Promise<void> }[]): Promise<void> {
  for (const check of checks) {
    await check.run();
  }
}

describe("seamConformance — the reference harness", () => {
  it("returns exactly six checks, in DESIGN §9.1's order", () => {
    const checks = seamConformance(makeReferenceHarness());
    expect(checks.map((c) => c.name)).toEqual([
      "keys enumerated, all inert",
      "nothing callable, nothing reaching",
      "a loud proposal moves nothing",
      "the other principal's private act is absent, and demonstrably would have shown",
      "the wire sends tools: [], stream: false, no credential; every failure is null",
      "state changes only through the audited path",
    ]);
  });

  it("passes all six checks", async () => {
    const checks = seamConformance(makeReferenceHarness());
    await expect(runAll(checks)).resolves.toBeUndefined();
  });

  it("is idempotent — running the whole suite twice produces the same result", async () => {
    await expect(runAll(seamConformance(makeReferenceHarness()))).resolves.toBeUndefined();
    await expect(runAll(seamConformance(makeReferenceHarness()))).resolves.toBeUndefined();
  });

  it("each check individually is idempotent, run standalone", async () => {
    for (const name of [
      "keys enumerated, all inert",
      "nothing callable, nothing reaching",
      "a loud proposal moves nothing",
      "the other principal's private act is absent, and demonstrably would have shown",
      "the wire sends tools: [], stream: false, no credential; every failure is null",
      "state changes only through the audited path",
    ]) {
      const find = (): { name: string; run(): Promise<void> } => {
        const checks = seamConformance(makeReferenceHarness());
        const found = checks.find((c) => c.name === name);
        if (!found) throw new Error(`missing check: ${name}`);
        return found;
      };
      await expect(find().run()).resolves.toBeUndefined();
      await expect(find().run()).resolves.toBeUndefined();
    }
  });
});

describe("seamConformance — planted violation: a context built with a getter", () => {
  it("fails check 2, naming the offending path", async () => {
    const checks = seamConformance(makeGetterViolation());
    const check2 = checks.find((c) => c.name === "nothing callable, nothing reaching")!;
    await expect(check2.run()).rejects.toThrow(/briefing/);
  });

  it("also fails check 1 — DESIGN §9.1 states check 1 runs assertInert too", async () => {
    const checks = seamConformance(makeGetterViolation());
    const check1 = checks.find((c) => c.name === "keys enumerated, all inert")!;
    // Object.keys sees the right shape (the getter is enumerable and named
    // correctly) but assertInert -- run at the end of check 1 too, per
    // DESIGN §9.1 -- still catches it. Check 2 restates the same assertion
    // deliberately ("stated separately because it is the property").
    await expect(check1.run()).rejects.toThrow(/briefing/);
  });
});

describe("seamConformance — planted violation: pass acts on loudProposal's prose", () => {
  it("fails check 3 — a loud proposal moves state", async () => {
    const checks = seamConformance(makeActsOnProseViolation());
    const check3 = checks.find((c) => c.name === "a loud proposal moves nothing")!;
    await expect(check3.run()).rejects.toThrow();
  });

  it("fails check 6 — state changed with zero recorded resolutions", async () => {
    const checks = seamConformance(makeActsOnProseViolation());
    const check6 = checks.find((c) => c.name === "state changes only through the audited path")!;
    await expect(check6.run()).rejects.toThrow();
  });
});

describe("seamConformance — planted violation: wire.create sends an Authorization header", () => {
  it("fails check 5", async () => {
    const checks = seamConformance(makeCredentialLeakViolation());
    const check5 = checks.find(
      (c) => c.name === "the wire sends tools: [], stream: false, no credential; every failure is null"
    )!;
    await expect(check5.run()).rejects.toThrow(/credential/);
  });
});

describe("seamConformance — planted violation: context never renders the planted act", () => {
  it("fails check 4 as vacuous, on the 'shown' pass", async () => {
    const checks = seamConformance(makeVacuousPrivateActViolation());
    const check4 = checks.find(
      (c) => c.name === "the other principal's private act is absent, and demonstrably would have shown"
    )!;
    await expect(check4.run()).rejects.toThrow(/vacuous/);
  });
});
