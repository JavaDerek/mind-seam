// The S0 guard (src/__tests__/noNetworkOutsideWire.test.ts) covers everywhere
// EXCEPT src/wire/ -- deliberately, since the wire is where a network call
// belongs. But `baseUrl` is still a required PARAMETER even inside the wire
// (DESIGN §7.3: "the package knows nobody's box"), so this is the wire's own,
// narrower guard: no read of `process.env` anywhere under src/wire/, ever --
// not even to default a value. A hostname is configuration the CALLER
// supplies, never something this package goes looking for itself.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve, join, basename } from "node:path";

const WIRE_DIR = resolve(__dirname, "..");

function scannedFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) out.push(path);
    }
  };
  walk(WIRE_DIR);
  return out.filter((path) => basename(path) !== "noAmbientEnv.test.ts");
}

describe("no read of process.env anywhere under src/wire/", () => {
  const files = scannedFiles();

  it("scans a non-zero number of files (guard against a vacuous pass)", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it("contains no process.env", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const contents = readFileSync(file, "utf8");
      contents.split("\n").forEach((line, i) => {
        if (/process\.env/.test(line)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(
      offenders,
      "the wire takes its base URL by parameter, never by reading ambient configuration"
    ).toEqual([]);
  });
});
