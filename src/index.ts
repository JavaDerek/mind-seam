// mind-seam — the seam's contract, its two stubs, and its wire.
//
// No context lives here (DESIGN §2.2, §11): `Mind<C, P>` and no `C`. A
// caller's field is a one-repository change with no release attached.
export type { Inert, InertRecord, Proposal, Mind } from "./types.js";
export { assertInert } from "./types.js";
export { SILENT_MIND, scriptedMind } from "./minds.js";
export type { SilenceReason, SilenceDetail } from "./wire/localMind.js";
export { createLocalMind, coerceProposal, firstJsonObject } from "./wire/localMind.js";

// The wires beneath the seam, and which one a role is bound to (roles.ts's own
// header for why): a role's backend is configuration, so that moving a
// misbehaving role onto a stronger backend separates "the model was too weak"
// from "the logic is wrong".
export type { Provider, ProviderAnswer, AskOptions, ResponseFormat } from "./wire/provider.js";
export { createHttpProvider } from "./wire/httpProvider.js";
export type { CreateHttpProviderOptions } from "./wire/httpProvider.js";
export { createCliProvider } from "./wire/cliProvider.js";
export type { CreateCliProviderOptions, SpawnLike } from "./wire/cliProvider.js";
export { PROVIDER_KINDS, parseBinding, resolveRole, firstAvailable, routeBy } from "./roles.js";
export type { ProviderKind, RoleBinding, ResolveRoleOptions } from "./roles.js";
