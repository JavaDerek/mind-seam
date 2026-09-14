# mind-seam

A mind is handed inert data assembled from its own principal's view, returns inert data, and has no
path to storage, whatever backs it. This package is that sentence as types, one wire, and one
executable conformance suite that any caller runs to prove it holds there.

```ts
import type { Mind, Proposal, InertRecord } from "mind-seam";

type MyContext = InertRecord & { briefing: string };
type MyMind = Mind<MyContext, Proposal>;
```

## What it is generic over

`Mind<C, P>` takes no opinion about a caller's fields. Each caller declares its own context as a
`type` alias over `InertRecord` (not an `interface` — see `assertInert`'s doc comment) and its own
proposal shape over `Proposal`. Adding a field to a caller's context is a one-repository change with
no release attached to this package.

## The wire

`createLocalMind()` dials a local OpenAI-compatible `/chat/completions` endpoint with `tools: []`,
`stream: false`, and no credential of any kind. Every failure — unreachable, timeout, a non-200
status, an unparseable body, a `coerce` that returns `null` — returns `null` after calling
`onSilence(reason, context, detail?)` with one of a closed set of reasons. A hostname is
configuration: the endpoint's location is a required parameter, never a default this package
assumes.

`responseFormat` is opt-in. `"json"` adds `response_format: { type: "json_object" }` to the request
body, for an endpoint that supports constraining generation to a JSON object. `{ jsonSchema, name? }`
goes further — `response_format: { type: "json_schema", json_schema: { name: name ?? "proposal",
strict: true, schema: jsonSchema } }` — and against Ollama 0.30.10 held a model to a schema's exact
keys and enum values even when the prompt asked for different ones, where `"json"` alone still let it
invent keys. `jsonSchema` is asserted `Inert` when `createLocalMind` is called, the same way a
non-inert context throws; this is a request to the server, not a guarantee, so `coerce` still runs on
every answer regardless of which `responseFormat` was asked for — schema enforcement is defense in
depth, not a replacement for it. Left unset, the body is byte-for-byte what it always was — this is
additive, not a default change.

`onSilence`'s third argument, `detail?: { text?: string; parsed?: Inert }`, carries what there is to
say for `"unparseable"` and `"rejected"`: `text` is the closest thing to the model's raw answer at the
point of failure (the extracted message content once that much parsed, the raw HTTP body if not), and
`parsed` is the JSON value pulled out of it, present only when parsing succeeded and `coerce` is what
rejected it. `"unreachable"`, `"timeout"`, and `"status"` pass no third argument at all, so an
existing two-argument `onSilence` keeps working unchanged.

## The property, and how it is enforced

Every value a mind sees or returns is `Inert`: a primitive, or an array or plain object built only of
those. `assertInert()` closes the two holes `tsc` cannot: a cast, and a getter that type-checks as a
plain field but reads live state. It runs before a prompt is built, and again wherever a caller's own
context is captured by a test.

## The conformance suite

`mind-seam/conformance` exports `seamConformance(harness)`, six checks a caller runs against its own
context builder and its own mind: every context key is enumerated and inert; nothing in it is
callable; a proposal that only asks moves nothing; the other principal's private act is absent from
this principal's context (and demonstrably would have shown, so the check cannot pass vacuously); the
wire's shape and its failure modes; and that state changes only through the caller's own audited
write path. Assertions use `node:assert/strict`, so the suite carries no test-framework dependency of
its own.

## Never link

This package is meant to be consumed at an exact published version — no `npm link`, no `file:`
dependency in any consumer. See `CLAUDE.md` for the rest of this repository's own rules.
