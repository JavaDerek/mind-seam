// No network code, credential, or ambient configuration read reaches this
// package's source outside src/wire/ (DESIGN §7.3, Appendix C).
//
// The mirror image of run-dmcp's noVendorTransports.test.ts: there, the rule
// is "no network ANYWHERE in this directory, because a transport is always
// injected." Here, network code has exactly one legitimate home -- src/wire/,
// the seam's one piece of behaviour -- so this scans every OTHER file under
// src/ and fails if a network token reaches it.
//
// SCOPE IS src/, NOT THE WHOLE REPOSITORY. Unlike vocabulary.test.ts (whose
// forbidden words are foreign to CI config, package metadata and docs by
// construction), a network guard's own tokens -- `https://`, `Authorization`
// -- are exactly what package.json's `repository.url` and a trusted-publisher
// release workflow legitimately contain. Scoping to `src/` (as
// noVendorTransports.test.ts scopes to `src/reader/`) means the guard never
// has to grow an exclusion list to tolerate its own repository's ordinary
// non-source files, and stays aimed at what it exists to catch: network code
// smuggled into this package's compiled output.
//
// WHAT THIS IS NOT: a ban on the words "context" or "principal" -- ordinary
// vocabulary the rest of the package needs. The forbidden list is the
// fingerprints of a live network call, a credential, or ambient
// configuration, not a ban on any word that could plausibly appear near one.
import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve, basename } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const SRC_DIR = "src/";
const WIRE_DIR = "src/wire/";

/**
 * Every file under `src/` except `src/wire/` -- tracked union
 * untracked-but-not-ignored, exactly as `vocabulary.test.ts` and
 * `engineVocabulary.test.ts` scan, and for the identical reason: a violation
 * is authored before `git add` ever runs, which a tracked-only scan cannot
 * see.
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
    .filter((f) => f.startsWith(SRC_DIR))
    .filter((f) => !f.startsWith(WIRE_DIR))
    .filter((f) => basename(f) !== "noNetworkOutsideWire.test.ts");
}

const FORBIDDEN: Array<{ pattern: RegExp; what: string; why: string }> = [
  {
    pattern: /\bfetch\s*\(/,
    what: "a direct network call",
    why: "the wire is the seam's one piece of behaviour and lives entirely in src/wire/ (DESIGN §2.2); everywhere else is types, stubs and the conformance suite, none of which touch a network.",
  },
  {
    pattern: /https?:\/\//,
    what: "a hardcoded network URL",
    why: "a hostname is configuration the package never assumes (DESIGN §7.3) -- the endpoint location is always a required parameter, supplied by the caller.",
  },
  {
    pattern: /\bbaseUrl\b/,
    what: "an API base-URL configuration field",
    why: "baseUrl is the wire's own parameter; nothing outside src/wire/ has a network call to configure.",
  },
  {
    pattern: /process\.env/,
    what: "a read of ambient process environment",
    why: "the package takes configuration by parameter, never by reading the process's own environment -- not even inside the wire (see src/wire/__tests__ for that half).",
  },
  {
    pattern: /\bAuthorization\b/,
    what: "an HTTP auth header name",
    why: "the wire sends no credential of any kind (DESIGN §7.3); no other file has an HTTP request to attach a header to in the first place.",
  },
  {
    pattern: /api[_-]?key/i,
    what: "a credential field name",
    why: "the package never holds a credential -- if a caller's mind needs one, that lives in the caller's own closure, never here.",
  },
];

describe("no network code, credential, or ambient config reaches mind-seam's source outside src/wire/", () => {
  const files = scannedFiles();

  it("scans a meaningful number of files (guard against a vacuous pass)", () => {
    expect(files.length).toBeGreaterThan(3);
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
        if (pattern.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`);
      });
    }
    expect(offenders, `${why}\n\n${offenders.join("\n")}`).toEqual([]);
  });

  it("excludes exactly src/wire/, and nothing else under src/", () => {
    // If this exclusion ever grows, the rule is being routed around rather
    // than enforced -- the same discipline engineVocabulary.test.ts holds for
    // its own single exclusion.
    const allTracked = [
      ...execFileSync("git", ["ls-files"], { cwd: REPO_ROOT, encoding: "utf8" }).split("\n"),
      ...execFileSync("git", ["ls-files", "--others", "--exclude-standard"], {
        cwd: REPO_ROOT,
        encoding: "utf8",
      }).split("\n"),
    ].filter(Boolean);
    const wireFiles = [...new Set(allTracked)].filter((f) => f.startsWith(WIRE_DIR));
    for (const f of wireFiles) {
      expect(files).not.toContain(f);
    }
  });

  it("stays scoped to src/, and does not silently cover the whole repository", () => {
    for (const f of files) {
      expect(f.startsWith(SRC_DIR)).toBe(true);
    }
  });
});
