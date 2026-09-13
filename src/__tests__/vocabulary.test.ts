// No consumer's vocabulary reaches the seam.
//
// mind-seam belongs to neither of its two callers -- brink (a turn-based
// game whose proposals are material for a narrator) and The Prisoner (a
// two-principal game whose proposals are moves for a referee). Modeled
// directly on `run-dmcp/src/__tests__/engineVocabulary.test.ts`: same shape,
// same "each entry carries why" discipline, same tracked+untracked scan (a
// violation is authored into a file before `git add` ever runs, which is
// exactly the window a tracked-only scan cannot see).
//
// ONE CORRECTION TO DESIGN Appendix C, made in root CLAUDE.md's own terms:
// Appendix C's own prose lists "file", "bar" and "cell" among the forbidden
// words. They are not forbidden here. They are ordinary English --
// package.json has a `files` field, a comment says "this file", a unit test
// is a "bar" of coverage or a memory "cell" in nobody's vocabulary but this
// sentence -- and root CLAUDE.md is explicit that "a guard that forbids
// ordinary words cries wolf and gets deleted." The distinctive tokens below
// (warden, prisoner, custody, spoon; seat, rival, archetype, prestige,
// DEFCON, flashpoint) carry the same evidentiary weight without that cost.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, basename } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");

/**
 * `CLAUDE.md`'s job is to explain where this guard's line falls, and it
 * cannot do that without naming the consumers on either side of it —
 * identical reasoning to `engineVocabulary.test.ts` excluding
 * `docs/DESIGN.md`. Excluding the explanation of a rule is not a hole in the
 * rule; excluding anything else would be.
 */
const EXCLUDED_PATHS = new Set(["CLAUDE.md"]);

/**
 * Tracked files union untracked-but-not-ignored files, exactly as
 * `engineVocabulary.test.ts` does and for the identical reason: a violation
 * is authored before `git add`, and `--exclude-standard` keeps
 * `node_modules`/`dist`/scratch files out while catching everything that
 * would actually reach a commit.
 */
function scannedFiles(): string[] {
  const tracked = execFileSync("git", ["ls-files"], { cwd: REPO_ROOT, encoding: "utf8" }).split(
    "\n"
  );
  const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).split("\n");

  return [...new Set([...tracked, ...untracked])]
    .filter(Boolean)
    .filter((f) => basename(f) !== "vocabulary.test.ts")
    .filter((f) => !EXCLUDED_PATHS.has(f))
    .filter((f) => !/package-lock\.json$/.test(f))
    .filter((f) => !/\.(png|jpe?g|gif|webp|ico|svg|woff2?|ttf|otf)$/i.test(f));
}

/**
 * Both consumers' words, symmetrically. Each entry carries why, same
 * discipline as the engine's own list -- a bare list of forbidden tokens is
 * exactly the thing a future contributor deletes when it gets in their way.
 */
const FORBIDDEN: Array<{ pattern: RegExp; what: string; why: string }> = [
  {
    pattern: /\bseats?\b/i,
    what: "brink's player positions",
    why: "the seam has a caller-declared context; how one game partitions its players into seats is that game's.",
  },
  {
    pattern: /\brivals?\b/i,
    what: "brink's opposing agents",
    why: "the seam has a Mind; what it stands in for in a given game is that game's fiction.",
  },
  {
    pattern: /\barchetypes?\b/i,
    what: "brink's rival personality content",
    why: "content belongs to the caller that authored it, not to the seam that carries any string.",
  },
  {
    pattern: /\bprestige\b/i,
    what: "brink's conserved resource",
    why: "the seam has no resources at all, conserved or otherwise -- that is the referee's, not the mind's.",
  },
  {
    pattern: /\bDEFCON\b/i,
    what: "brink's escalation ladder",
    why: "one game's bounded resource; the seam does not know what a mind's proposal is used for.",
  },
  {
    pattern: /\bflashpoints?\b/i,
    what: "brink's contested location",
    why: "a geopolitical reading of a place. The seam's context has whatever fields its caller declares.",
  },
  {
    pattern: /\baccords?\b/i,
    what: "brink's negotiated agreement",
    why: "one game's word for a bundle of obligations; the seam carries a Proposal, not a treaty.",
  },
  {
    pattern: /\bwardens?\b/i,
    what: "The Prisoner's second principal",
    why: "the seam is generic over which principal is asking -- naming one game's pair here would make it that game's.",
  },
  {
    pattern: /\bprisoners?\b/i,
    what: "The Prisoner's own name and first principal",
    why: "a consumer's proper name and role in one; the seam serves a principal, structurally described, not this one.",
  },
  {
    pattern: /\bcustody\b/i,
    what: "The Prisoner's item-ownership mechanic",
    why: "a specific game's resolve-protocol mechanic; the seam has no mechanics, only a Mind and a wire.",
  },
  {
    pattern: /\bspoons?\b/i,
    what: "The Prisoner's escape-tool content",
    why: "content authored for one scenario, not a shape the seam has any business knowing about.",
  },
  {
    pattern: /\bthe[- ]prisoner\b/i,
    what: "a consumer's proper name",
    why:
      "every entry above catches a consumer's DOMAIN VOCABULARY. A consumer's own NAME in the seam " +
      "is the more direct form of the same disease: there is no more unambiguous way to write 'this " +
      "package belongs to one client' than to write that client's name. Describe consumers " +
      "structurally instead, the way DESIGN.md itself does: 'a turn-based game whose proposals are " +
      "material for a narrator; a two-principal game whose proposals are moves for a referee.'",
  },
];

/**
 * Explicitly not forbidden. These are the seam's own vocabulary -- principal,
 * context, proposal, intent, line, mind, briefing -- and belong in this tree
 * freely. Listed as a positive assertion, not a comment, so a future
 * contributor who "tightens" the guard sees the tests break rather than
 * silently narrowing what this package can say about itself.
 */
const NOT_FORBIDDEN = ["principal", "context", "proposal", "intent", "line", "mind", "briefing"];

describe("no consumer's vocabulary reaches the seam", () => {
  const files = scannedFiles();

  it("scans a meaningful number of files (guard against a vacuous pass)", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(FORBIDDEN)("contains no $what", ({ pattern, why }) => {
    const offenders: string[] = [];
    for (const file of files) {
      let contents: string;
      try {
        contents = readFileSync(resolve(REPO_ROOT, file), "utf8");
      } catch {
        continue;
      }
      contents.split("\n").forEach((line, i) => {
        if (pattern.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim().slice(0, 100)}`);
      });
    }
    expect(offenders, `${why}\n\n${offenders.join("\n")}`).toEqual([]);
  });

  it("keeps the exclusion list to exactly CLAUDE.md", () => {
    expect([...EXCLUDED_PATHS]).toEqual(["CLAUDE.md"]);
  });

  it("does not forbid the seam's own ordinary words", () => {
    for (const word of NOT_FORBIDDEN) {
      expect(FORBIDDEN.some(({ pattern }) => pattern.test(word))).toBe(false);
    }
  });
});
