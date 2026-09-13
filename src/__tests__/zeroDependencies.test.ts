// Zero runtime dependencies is structural, not aspirational (DESIGN §2.2):
// nothing in mind-seam can import a database, so a mind the package builds
// cannot write state by import any more than by capability. In particular,
// no run-dmcp dependency -- that would hand every mind a path to storage.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PACKAGE_JSON_PATH = resolve(__dirname, "..", "..", "package.json");

describe("mind-seam has zero runtime dependencies", () => {
  it("declares dependencies as {} in package.json", () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(pkg.dependencies).toEqual({});
  });

  it("in particular, does not depend on run-dmcp", () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {})).not.toContain("run-dmcp");
    expect(Object.keys(pkg.devDependencies ?? {})).not.toContain("run-dmcp");
  });
});
