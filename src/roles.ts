// Which provider and which model answer for a named role.
//
// The package already had one wire and one hardcoded assumption about it: a
// mind talks to an OpenAI-compatible endpoint, full stop. Two callers now want
// the same role answered by different KINDS of backend -- one local, one a
// subscription CLI -- so that swapping the backend under a role does not touch
// the role's own logic. That swap is the whole point: when a role misbehaves,
// moving it to a stronger backend and re-running separates "the model was too
// weak" from "the logic is wrong", which is not a question a caller can answer
// while the backend is welded to the call site.
//
// Generic with two real callers, the way root CLAUDE.md's admission test asks:
// a turn-based game whose proposals are material for a narrator, whose roles
// are a reader and a game-master; a two-principal game whose proposals are
// moves for a referee, whose roles are wits, voice, referee and narrator.
//
// Pure, and not by taste: `noNetworkOutsideWire.test.ts` forbids any read of
// the ambient process environment, a URL, and an endpoint-address identifier in
// this file. A caller reads its own configuration and hands the result in as
// data, which is the same economy as "no context lives here" -- a caller's
// variable names need no release here.

/** The kinds of backend a role can be bound to. `http` is an
 *  OpenAI-compatible endpoint (`createHttpProvider`); `cli` is a keyless
 *  subscription command (`createCliProvider`). Adding a third kind is a
 *  release here; choosing between them is configuration there. */
export const PROVIDER_KINDS = ["http", "cli"] as const;

export type ProviderKind = (typeof PROVIDER_KINDS)[number];

/** A role's answer: which kind of backend, and which model on it. */
export interface RoleBinding {
  provider: ProviderKind;
  model: string;
}

function isProviderKind(value: string): value is ProviderKind {
  return (PROVIDER_KINDS as readonly string[]).includes(value);
}

/**
 * Read a binding from one configured string.
 *
 * `"cli:sonnet"` is explicit. A bare `"qwen3.5:27b"` is the `http` kind, which
 * keeps every existing caller's single-model configuration meaning exactly
 * what it meant before this module existed.
 *
 * The subtlety that would otherwise ruin a run silently: **a model name
 * carries colons of its own.** `qwen3.5:27b` and `ancient-awakening:12b` are
 * models, and a naive split on `":"` reads the first as provider `qwen3.5`.
 * So a first segment is a provider prefix only when it is a known kind, and
 * everything else is a model name in full.
 */
export function parseBinding(raw: string): RoleBinding {
  const value = raw.trim();
  if (value === "") {
    throw new Error("model binding: empty value -- name a model, or leave it unset for the default");
  }

  const colon = value.indexOf(":");
  if (colon > 0) {
    const head = value.slice(0, colon);
    if (isProviderKind(head)) {
      const model = value.slice(colon + 1).trim();
      if (model === "") {
        throw new Error(`model binding ${JSON.stringify(raw)}: no model after the ${head} prefix`);
      }
      return { provider: head, model };
    }
  }

  return { provider: "http", model: value };
}

export interface ResolveRoleOptions {
  /** What this role's own configuration said. Unset or empty means the
   *  fallback, so an unconfigured role behaves exactly as it did before. */
  requested?: string;
  /** The binding a run gets when it names none. A caller holds this, with the
   *  evidence for its value: which model is right for a role is measured
   *  where the role runs, never here. */
  fallback: RoleBinding;
}

/**
 * The binding a role should actually use.
 *
 * An unrecognised provider prefix throws rather than falling back. A run that
 * asked for a backend it did not get, and played anyway, produces a transcript
 * that says one thing and measured another -- which is worse than not starting.
 */
export function resolveRole(options: ResolveRoleOptions): RoleBinding {
  const { requested, fallback } = options;
  if (requested === undefined || requested.trim() === "") return fallback;

  const value = requested.trim();
  const colon = value.indexOf(":");
  if (colon > 0) {
    const head = value.slice(0, colon);
    // A head that looks like a prefix but names no known kind is a mistake,
    // not a model: `bedrock:sonnet` must never quietly resolve to an `http`
    // model literally named "bedrock:sonnet".
    if (!isProviderKind(head) && !head.includes(".") && !head.includes("-")) {
      throw new Error(
        `model binding ${JSON.stringify(requested)}: unknown provider ${JSON.stringify(head)} -- ` +
          `known kinds are ${PROVIDER_KINDS.join(", ")}`
      );
    }
  }

  return parseBinding(value);
}

/**
 * The first binding whose probe answers yes, or `null` when none does.
 *
 * A capability ladder, the shape a caller needs when a machine may be missing
 * a backend entirely: a box that is off, or no subscription command installed.
 * A probe that throws counts as unavailable and never propagates -- a ladder
 * whose whole job is to degrade must not itself be a way for a launch to fail.
 * Probing stops at the first yes, so the cost is one round trip, not N.
 */
export async function firstAvailable(
  candidates: readonly RoleBinding[],
  probe: (binding: RoleBinding) => Promise<boolean>
): Promise<RoleBinding | null> {
  for (const candidate of candidates) {
    let up = false;
    try {
      up = await probe(candidate);
    } catch {
      up = false;
    }
    if (up) return candidate;
  }
  return null;
}

/**
 * Route each request to whichever binding a caller's own predicate picks.
 *
 * The predicate stays the caller's, always: what makes one request worth a
 * slower and stronger backend is that game's domain, and its words for it are
 * forbidden in this tree. What is generic is only the routing -- a cheap
 * backend for what can afford to be wrong, an expensive one for what cannot.
 */
export function routeBy<T>(
  isConsequential: (request: T) => boolean,
  consequential: RoleBinding,
  ordinary: RoleBinding
): (request: T) => RoleBinding {
  return (request: T) => (isConsequential(request) ? consequential : ordinary);
}
