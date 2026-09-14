// mind-seam — the seam's contract, its two stubs, and its wire.
//
// No context lives here (DESIGN §2.2, §11): `Mind<C, P>` and no `C`. A
// caller's field is a one-repository change with no release attached.
export type { Inert, InertRecord, Proposal, Mind } from "./types.js";
export { assertInert } from "./types.js";
export { SILENT_MIND, scriptedMind } from "./minds.js";
export type { SilenceReason, SilenceDetail } from "./wire/localMind.js";
export { createLocalMind, coerceProposal, firstJsonObject } from "./wire/localMind.js";
