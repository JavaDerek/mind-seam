# mind-seam — Claude Context

## What this is

A mind is handed inert data assembled from its own principal's view, returns inert data, and has no
path to storage, whatever backs it. This package is that sentence as types, one wire, and one
executable suite that any caller runs to prove it holds there.

`~/rpg/the-prisoner/docs/DESIGN.md` is the authority this package was extracted from; section numbers
in comments here refer to it.

## Two consumers, and it belongs to neither

A turn-based game whose proposals are material for a narrator (brink); a two-principal game whose
proposals are moves for a referee (The Prisoner). Their words — seat, rival, archetype, prestige,
DEFCON, flashpoint, accord; warden, prisoner, custody, spoon — are forbidden in this tree by a test
modelled on `run-dmcp`'s `engineVocabulary.test.ts` (`src/__tests__/vocabulary.test.ts`), tracked and
untracked files both. Principal, context, proposal, intent, line, mind, briefing are this package's
words and are not forbidden.

**One correction to how that list is drawn.** `file`, `bar` and `cell` are not forbidden, on purpose:
they are ordinary English — `package.json` has a `files` field, a comment says "this file" — and root
`CLAUDE.md` is explicit that a guard which forbids ordinary words cries wolf and gets deleted. The
forbidden list stays to the distinctive tokens above, which carry the same evidence without that cost.

## Zero runtime dependencies, by test

`dependencies` is `{}`, asserted by `src/__tests__/zeroDependencies.test.ts`. Never `run-dmcp`: that
would hand every mind a path to storage by import. Never a vendor SDK: the wire is a `fetch`.

## No context lives here

`Mind<C, P>` and no `C`. If you are adding a field, you are in the wrong repository; a caller's field
needs no release here, and that is the whole economy of the package.

## No network code outside `src/wire/`

Enforced the way `run-dmcp/src/reader/` enforces the opposite direction:
`src/__tests__/noNetworkOutsideWire.test.ts` scans every file *outside* `src/wire/` for `fetch(`,
`https?://`, `baseUrl`, `process.env`, `Authorization`, `api-key`. Inside `src/wire/`: `tools: []`,
`stream: false`, no credential header, no `process.env`, asserted by tests with an injected `fetch`.
No default base URL — a hostname is configuration.

## Failure is silence with a reason

Every wire failure returns `null` after calling `onSilence(reason, context, detail?)` with a member
of the closed `SilenceReason` set. `detail` (`{ text?: string; parsed?: Inert }`) is present only for
`"unparseable"` and `"rejected"` — the other three reasons pass no third argument at all, so an
existing two-argument callback keeps working. `parsed` is always `Inert` (it comes straight out of
`JSON.parse`). What repeated silence *means* is the caller's; do not add a counter or a threshold
here.

## Schema enforcement narrows the model, it does not replace `coerce`

`createLocalMind`'s `responseFormat` is opt-in: `"json"` sends `{ type: "json_object" }`;
`{ jsonSchema, name? }` sends `{ type: "json_schema", json_schema: { name, strict: true, schema:
jsonSchema } }`. Against Ollama 0.30.10, `strict: true` with a schema held a model to the schema's
exact keys and enum values even when the prompt asked for different ones; plain `json_object` still
let it invent keys. `jsonSchema` is asserted `Inert` when the mind is constructed, the same as a
non-inert context throws from `consider()`. This is a request to the server, not a guarantee from
it — `coerce` still runs on every answer no matter which `responseFormat` was asked for. Do not treat
a schema as a reason to weaken a caller's own `coerce`.

## The conformance suite is the product

`mind-seam/conformance` asserts with `node:assert/strict` and depends on no test framework. Every
check must have been seen red against a planted violation in this repository's own tests before it
ships.

## TDD is mandatory

Same sentence as the neighbours: write the failing test first, confirm it fails for the right
reason, then implement. A guard is validated by planting a violation and watching it go red before
it is trusted.

## Publishing

Tag-triggered, npm trusted publisher, no token anywhere — `run-dmcp`'s `release.yml` is the template.
Consumers pin exactly; a release is two downstream commits that name this one. Semver 0.x: a change
to the wire's observable behaviour or the suite's checks is a minor; a new optional export is a
patch.

## Never link

No `npm link`, no `file:` in any consumer. The published package is the only evidence the published
package works.
