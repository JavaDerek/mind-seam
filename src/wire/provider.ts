// What a backend is, beneath the seam.
//
// `createLocalMind` always had a backend welded into it: an OpenAI-compatible
// POST, and no way to ask anything else. A `Provider` is that call generalised
// to "hand a prompt to something, get text or a reason for silence" -- which
// is what lets a role move between backends without its own logic changing,
// and lets a caller whose call is NOT a mind (a classifier reading a turn, say)
// use the same wire discipline without pretending to propose anything.
import type { InertRecord } from "../types.js";
import type { SilenceReason, SilenceDetail } from "./localMind.js";

/** Text, or silence with a reason. Never a throw: the seam's failure rule
 *  (CLAUDE.md "Failure is silence with a reason") applies to every backend,
 *  not just the one that happened to be written first. */
export type ProviderAnswer =
  | { ok: true; text: string }
  | { ok: false; reason: SilenceReason; detail?: SilenceDetail };

/** What a backend may be asked to constrain its output to, when it can. Shared
 *  with `createLocalMind`'s `responseFormat` so a caller writes one shape. */
export type ResponseFormat = "json" | { jsonSchema: InertRecord; name?: string };

export interface AskOptions {
  temperature?: number;
  timeoutMs?: number;
  responseFormat?: ResponseFormat;
}

/**
 * One prompt in, text or silence out.
 *
 * `model` is readable so a caller can record in a transcript which model
 * actually answered, rather than which one it believes it configured -- the
 * two diverge exactly when a ladder has fallen through to another rung, which
 * is the moment a transcript most needs to say so.
 */
export interface Provider {
  readonly kind: "http" | "cli";
  readonly model: string;
  ask(prompt: string, options?: AskOptions): Promise<ProviderAnswer>;
}
