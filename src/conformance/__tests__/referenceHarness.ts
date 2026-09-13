// A reference harness the package's own tests run seamConformance() against
// (DESIGN §9.2): a toy world with one bounded counter and a one-function
// referee, no run-dmcp. Plus five planted violations, each differing from
// the reference in exactly one place, used to prove every check goes red for
// the right reason before it is trusted.
//
// Not part of the public API -- this lives under __tests__/ and is excluded
// from the published package by package.json's `files` globs, same as
// run-dmcp's own dist exclusions.
import type { InertRecord, Mind, Proposal } from "../../types.js";
import { createLocalMind, coerceProposal } from "../../wire/localMind.js";
import type { PassReport, SeamHarness } from "../index.js";

export type CounterContext = InertRecord & { briefing: string };
export type CounterProposal = Proposal & { move?: "INCREMENT" };

const FIELDS: readonly string[] = ["briefing"];

/** A closed set of one move, matched by literal equality -- never by
 * understanding the prose in `intent`. */
function resolveIfIncrement(world: { count: number }, proposal: CounterProposal | null): number {
  if (proposal !== null && proposal.move === "INCREMENT") {
    world.count = Math.min(100, world.count + 1);
    return 1;
  }
  return 0;
}

function briefingFor(count: number, marker: string | undefined): string {
  return marker === undefined
    ? `the counter reads ${count}.`
    : `the counter reads ${count}. the other principal just did: ${marker}.`;
}

/**
 * The reference harness. Every `pass` builds a fresh world (idempotency,
 * §9.4), so calling the suite twice produces the same result.
 */
export function makeReferenceHarness(): SeamHarness<CounterContext, CounterProposal> {
  return {
    fields: FIELDS,
    loudProposal: { intent: "set the counter to one hundred immediately" },
    actionableProposal: { intent: "turn the crank", move: "INCREMENT" },
    privateAct: "supported",
    async pass(mind, options): Promise<PassReport> {
      const world = { count: 0 };
      const before = { count: world.count };

      const marker = options?.privateAct?.visibility === "shown" ? options.privateAct.marker : undefined;
      const briefing = briefingFor(world.count, marker);

      const context: CounterContext = { briefing };
      const proposal = await mind.consider(context);
      const resolutions = resolveIfIncrement(world, proposal);

      const after = { count: world.count };
      return { before, after, resolutions };
    },
    wire: {
      create(o): Mind<CounterContext, CounterProposal> {
        return createLocalMind<CounterContext, CounterProposal>({
          baseUrl: o.baseUrl,
          model: o.model,
          fetchFn: o.fetchFn,
          prompt: (context) => context.briefing,
          coerce(raw) {
            const base = coerceProposal(raw);
            if (base === null) return null;
            const moveField = (raw as Record<string, unknown>).move;
            return moveField === "INCREMENT" ? { ...base, move: "INCREMENT" } : base;
          },
        });
      },
      context: { briefing: briefingFor(0, undefined) },
    },
  };
}

/** Planted violation 1: a context whose `briefing` is a getter. Should fail
 * checks 1 and 2 -- assertInert sees the accessor even though Object.keys
 * reports the right shape. */
export function makeGetterViolation(): SeamHarness<CounterContext, CounterProposal> {
  const base = makeReferenceHarness();
  return {
    ...base,
    async pass(mind, _options): Promise<PassReport> {
      const world = { count: 0 };
      const before = { count: world.count };
      const context: Record<string, unknown> = {};
      Object.defineProperty(context, "briefing", {
        get: () => briefingFor(world.count, undefined),
        enumerable: true,
        configurable: true,
      });
      const proposal = await mind.consider(context as CounterContext);
      const resolutions = resolveIfIncrement(world, proposal);
      const after = { count: world.count };
      return { before, after, resolutions };
    },
  };
}

/** Planted violation 2: `pass` acts on ANY proposal -- including a loud,
 * prose-only one -- bypassing the audited path entirely. `resolutions` never
 * moves, so the state change it causes must be caught by check 6 as well as
 * check 3. */
export function makeActsOnProseViolation(): SeamHarness<CounterContext, CounterProposal> {
  const base = makeReferenceHarness();
  return {
    ...base,
    async pass(mind, options): Promise<PassReport> {
      const world = { count: 0 };
      const before = { count: world.count };
      const marker = options?.privateAct?.visibility === "shown" ? options.privateAct.marker : undefined;
      const briefing = briefingFor(world.count, marker);
      const context: CounterContext = { briefing };

      const proposal = await mind.consider(context);
      // THE BUG: any non-null proposal moves state, whether or not it named
      // the registered move -- a second, unaudited write path.
      if (proposal !== null) {
        world.count = Math.min(100, world.count + 1);
      }

      const after = { count: world.count };
      return { before, after, resolutions: 0 };
    },
  };
}

/** Planted violation 3: the wire sends an Authorization header. A hand-built
 * wire, not createLocalMind, precisely because createLocalMind cannot be
 * made to do this -- the plant has to bypass the very thing under test. */
export function makeCredentialLeakViolation(): SeamHarness<CounterContext, CounterProposal> {
  const base = makeReferenceHarness();
  return {
    ...base,
    wire: {
      create(o): Mind<CounterContext, CounterProposal> {
        return {
          async consider(context) {
            const response = await o.fetchFn(`${o.baseUrl}/chat/completions`, {
              method: "POST",
              headers: {
                "content-type": "application/json",
                // THE BUG: a credential header the wire must never send.
                Authorization: "Bearer not-supposed-to-be-here",
              },
              body: JSON.stringify({
                model: o.model,
                messages: [{ role: "user", content: context.briefing }],
                tools: [],
                stream: false,
              }),
            });
            if (!response.ok) return null;
            let body: unknown;
            try {
              body = JSON.parse(await response.text());
            } catch {
              return null;
            }
            const content = (body as { choices?: Array<{ message?: { content?: unknown } }> } | null)
              ?.choices?.[0]?.message?.content;
            if (typeof content !== "string") return null;
            let raw: unknown;
            try {
              raw = JSON.parse(content);
            } catch {
              return null;
            }
            return coerceProposal(raw);
          },
        };
      },
      context: { briefing: briefingFor(0, undefined) },
    },
  };
}

/** Planted violation 4: the context never renders the planted act at all,
 * "shown" or not. Check 4 must fail as *vacuous* on the "shown" pass -- the
 * marker's absence from "withheld" would otherwise look like the property
 * holding, when actually the act never reaches this context by any route. */
export function makeVacuousPrivateActViolation(): SeamHarness<CounterContext, CounterProposal> {
  const base = makeReferenceHarness();
  return {
    ...base,
    async pass(mind, _options): Promise<PassReport> {
      const world = { count: 0 };
      const before = { count: world.count };
      // THE BUG: briefing never includes the marker, even when "shown".
      const context: CounterContext = { briefing: briefingFor(world.count, undefined) };

      const proposal = await mind.consider(context);
      const resolutions = resolveIfIncrement(world, proposal);
      const after = { count: world.count };
      return { before, after, resolutions };
    },
  };
}

/** Planted violation 5 (the defect this fix closes): a harness whose
 * "withheld" pass renders the private act too -- a real leak to the captured
 * principal. Before the fix, `pass` was never handed a marker to plant, so a
 * harness naturally minted a fresh one on every call; check 4 took the
 * marker from the "shown" `PassReport` and searched "withheld"'s context for
 * *that* token, which "withheld" (having minted its own) never contained --
 * so the search always missed and the check passed regardless of an actual
 * leak. Now that the suite hands both passes the same marker, this harness's
 * bug -- rendering it on "withheld" too, instead of only "shown" -- is
 * exactly what the search catches. */
export function makeLeakingPrivateActViolation(): SeamHarness<CounterContext, CounterProposal> {
  const base = makeReferenceHarness();
  return {
    ...base,
    async pass(mind, options): Promise<PassReport> {
      const world = { count: 0 };
      const before = { count: world.count };
      // THE BUG: the marker is rendered whenever privateAct is requested at
      // all -- "shown" or "withheld" alike -- instead of only on "shown".
      const marker = options?.privateAct?.marker;
      const context: CounterContext = { briefing: briefingFor(world.count, marker) };

      const proposal = await mind.consider(context);
      const resolutions = resolveIfIncrement(world, proposal);
      const after = { count: world.count };
      return { before, after, resolutions };
    },
  };
}
