// The property, stated once and executed in every caller (DESIGN §9).
//
// Six checks any caller runs against its own context builder and its own
// mind. Assertions use node:assert/strict, so this suite carries no
// test-framework dependency of its own -- a caller wraps each check in its
// own `it()`.
import assert from "node:assert/strict";
import { assertInert, type Inert, type InertRecord, type Mind, type Proposal } from "../types.js";

export interface PassReport {
  /** Every consequential value, snapshotted before the pass -- the caller says which. */
  before: Inert;
  /** The same values after. */
  after: Inert;
  /** Audited write-path events the pass produced (the caller counts them). */
  resolutions: number;
  /** When privateAct was requested: the token the planted act carried. */
  privateMarker?: string;
}

export interface SeamHarness<C extends InertRecord, P extends Proposal> {
  /** The declared context fields. */
  fields: readonly string[];
  /** Prose instructions to move state; nothing the loop acts on. */
  loudProposal: P;
  /** A proposal the loop DOES act on through its write path; omit if none. */
  actionableProposal?: P;
  /** A caller must say, with a reason, if it cannot plant a private act. */
  privateAct: "supported" | { unsupported: string };
  pass(mind: Mind<C, P>, options?: { privateAct?: "shown" | "withheld" }): Promise<PassReport>;
  /** How this caller constructs its real mind. */
  wire?: {
    create(o: { baseUrl: string; model: string; fetchFn: typeof fetch }): Mind<C, P>;
    context: C;
  };
}

export interface SeamCheck {
  name: string;
  run(): Promise<void>;
}

function capturingMind<C extends InertRecord, P extends Proposal>(
  onCapture: (context: C) => void,
  answer: P | null = null
): Mind<C, P> {
  return {
    async consider(context: C): Promise<P | null> {
      onCapture(context);
      return answer;
    },
  };
}

/** A literal search for our own token in an object we built -- never a scan
 * of prose for meaning (root CLAUDE.md hard rule 4). */
function containsStringLeaf(value: Inert, marker: string): boolean {
  if (typeof value === "string") return value.includes(marker);
  if (Array.isArray(value)) return value.some((item) => containsStringLeaf(item, marker));
  if (value !== null && typeof value === "object") {
    return Object.values(value).some((item) => containsStringLeaf(item as Inert, marker));
  }
  return false;
}

/** A check the harness declared it cannot support is not a failure -- it is
 * printed and skipped, the same way a missing `wire` skips check 5. */
function skip(reason: string): void {
  // eslint-disable-next-line no-console
  console.info(`[mind-seam/conformance] skipped: ${reason}`);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type WireFactory<C extends InertRecord, P extends Proposal> = (o: {
  baseUrl: string;
  model: string;
  fetchFn: typeof fetch;
}) => Mind<C, P>;

async function assertWireShape<C extends InertRecord, P extends Proposal>(
  create: WireFactory<C, P>,
  context: C
): Promise<void> {
  let capturedInit: RequestInit | undefined;
  const fetchFn = (async (_url: unknown, init?: RequestInit) => {
    capturedInit = init;
    return jsonResponse({
      choices: [{ message: { content: JSON.stringify({ intent: "seam conformance probe" }) } }],
    });
  }) as unknown as typeof fetch;

  const mind = create({ baseUrl: "http://conformance.invalid", model: "conformance-model", fetchFn });
  await mind.consider(context);

  assert.ok(capturedInit, "the wire never made a request");
  const init = capturedInit as RequestInit;
  const body = JSON.parse((init.body as string) ?? "{}") as Record<string, unknown>;
  assert.deepStrictEqual(body.tools, [], "the wire must send tools: []");
  assert.strictEqual(body.stream, false, "the wire must send stream: false");

  const headers = (init.headers ?? {}) as Record<string, string>;
  for (const name of Object.keys(headers)) {
    assert.notStrictEqual(
      name.toLowerCase(),
      "authorization",
      "the wire must send no credential of any kind"
    );
    assert.ok(
      !name.toLowerCase().includes("api-key"),
      "the wire must send no credential of any kind"
    );
  }
}

type WireFailureMode = "unreachable" | "timeout" | "status" | "unparseable" | "no-intent";

function wireFailureFetch(mode: WireFailureMode): typeof fetch {
  switch (mode) {
    case "unreachable":
      return (async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch;
    case "timeout":
      return (async () => {
        throw new DOMException("timed out", "TimeoutError");
      }) as unknown as typeof fetch;
    case "status":
      return (async () => new Response("nope", { status: 503 })) as unknown as typeof fetch;
    case "unparseable":
      return (async () => new Response("not json at all", { status: 200 })) as unknown as typeof fetch;
    case "no-intent":
      return (async () =>
        jsonResponse({ choices: [{ message: { content: JSON.stringify({}) } }] })) as unknown as typeof fetch;
  }
}

async function assertWireFailure<C extends InertRecord, P extends Proposal>(
  create: WireFactory<C, P>,
  context: C,
  mode: WireFailureMode
): Promise<void> {
  const mind = create({
    baseUrl: "http://conformance.invalid",
    model: "conformance-model",
    fetchFn: wireFailureFetch(mode),
  });
  const result = await mind.consider(context);
  assert.strictEqual(result, null, `the wire must answer null on ${mode}`);
}

/**
 * The property, executed. Returns six checks in the order DESIGN §9.1 lists
 * them. Every check that calls `harness.pass` records its report, so check 6
 * ("state changes only through the audited path") can be validated against
 * every pass the suite ran, not only its own.
 */
export function seamConformance<C extends InertRecord, P extends Proposal>(
  harness: SeamHarness<C, P>
): readonly SeamCheck[] {
  const recorded: PassReport[] = [];

  async function runPass(
    mind: Mind<C, P>,
    options?: { privateAct?: "shown" | "withheld" }
  ): Promise<PassReport> {
    const report = await harness.pass(mind, options);
    recorded.push(report);
    return report;
  }

  return [
    {
      name: "keys enumerated, all inert",
      async run() {
        let captured: C | undefined;
        await runPass(capturingMind<C, P>((ctx) => (captured = ctx)));
        assert.ok(captured, "the mind was never asked -- pass() must call consider()");
        assert.deepStrictEqual(
          Object.keys(captured as C).sort(),
          [...harness.fields].sort(),
          "the context's own keys must equal the harness's declared fields"
        );
        assertInert(captured, "context");
      },
    },
    {
      name: "nothing callable, nothing reaching",
      async run() {
        let captured: C | undefined;
        await runPass(capturingMind<C, P>((ctx) => (captured = ctx)));
        assertInert(captured, "context");
      },
    },
    {
      name: "a loud proposal moves nothing",
      async run() {
        const report = await runPass(capturingMind<C, P>(() => {}, harness.loudProposal));
        assert.strictEqual(report.resolutions, 0, "a loud proposal must not resolve anything");
        assert.deepStrictEqual(
          report.before,
          report.after,
          "a loud proposal must not change state"
        );
      },
    },
    {
      name: "the other principal's private act is absent, and demonstrably would have shown",
      async run() {
        if (harness.privateAct !== "supported") {
          skip(harness.privateAct.unsupported);
          return;
        }

        let shownContext: C | undefined;
        const shownReport = await runPass(
          capturingMind<C, P>((ctx) => (shownContext = ctx)),
          { privateAct: "shown" }
        );
        assert.ok(
          shownReport.privateMarker,
          "a harness declaring privateAct: 'supported' must return a privateMarker on the 'shown' pass"
        );
        const marker = shownReport.privateMarker as string;
        assert.ok(
          containsStringLeaf(shownContext as Inert, marker),
          "vacuous: the planted act never reached this caller's context by any route on the 'shown' " +
            "pass, so its absence on 'withheld' would prove nothing"
        );

        let withheldContext: C | undefined;
        await runPass(capturingMind<C, P>((ctx) => (withheldContext = ctx)), {
          privateAct: "withheld",
        });
        assert.ok(
          !containsStringLeaf(withheldContext as Inert, marker),
          "the other principal's private act leaked into this context"
        );
      },
    },
    {
      name: "the wire sends tools: [], stream: false, no credential; every failure is null",
      async run() {
        if (harness.wire === undefined) {
          skip("no wire supplied");
          return;
        }
        const { create, context } = harness.wire;

        await assertWireShape(create, context);
        await assertWireFailure(create, context, "unreachable");
        await assertWireFailure(create, context, "timeout");
        await assertWireFailure(create, context, "status");
        await assertWireFailure(create, context, "unparseable");
        await assertWireFailure(create, context, "no-intent");
      },
    },
    {
      name: "state changes only through the audited path",
      async run() {
        // Exercised again here (not only relying on check 3's own call) so
        // this check alone still catches a `pass` that acts on prose even
        // when run standalone, before checking every report the suite has
        // recorded so far.
        await runPass(capturingMind<C, P>(() => {}, harness.loudProposal));

        for (const report of recorded) {
          if (report.resolutions === 0) {
            assert.deepStrictEqual(
              report.before,
              report.after,
              "state changed while resolutions stayed at 0 -- a second, unaudited write path"
            );
          }
        }

        if (harness.actionableProposal !== undefined) {
          const acted = await runPass(capturingMind<C, P>(() => {}, harness.actionableProposal));
          assert.strictEqual(
            acted.resolutions,
            1,
            "an actionable proposal must resolve exactly once through the audited path"
          );
        }
      },
    },
  ];
}
