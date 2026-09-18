// Roles: which provider and which model answer for a named role. Generic
// with two real callers, the way root CLAUDE.md's admission test asks:
// a turn-based game whose proposals are material for a narrator, whose roles
// are a reader and a game-master; a two-principal game whose proposals are
// moves for a referee, whose roles are wits, voice, referee and narrator.
//
// Pure by necessity, not by taste: `noNetworkOutsideWire.test.ts` forbids any
// read of the ambient process environment, a URL, and an endpoint-address field
// in this file, so a caller reads its own configuration and hands the result in
// as data. That is the same economy as "no context lives here" -- a caller's
// variable names need no release here.
import { describe, it, expect, vi } from "vitest";
import { parseBinding, resolveRole, firstAvailable, routeBy, type RoleBinding } from "./roles.js";

const HTTP_27B: RoleBinding = { provider: "http", model: "qwen3.5:27b" };
const CLI_SONNET: RoleBinding = { provider: "cli", model: "sonnet" };

describe("parseBinding", () => {
  it("reads an explicit provider prefix", () => {
    expect(parseBinding("cli:sonnet")).toEqual(CLI_SONNET);
    expect(parseBinding("http:ancient-awakening:12b")).toEqual({
      provider: "http",
      model: "ancient-awakening:12b",
    });
  });

  // The one that would silently ruin a run: a model name carries colons of
  // its own, so only a FIRST segment that is a known provider kind may be
  // taken as one. `qwen3.5:27b` is a model, not provider "qwen3.5".
  it("does not mistake a model's own colon for a provider prefix", () => {
    expect(parseBinding("qwen3.5:27b")).toEqual(HTTP_27B);
    expect(parseBinding("ancient-awakening:12b")).toEqual({
      provider: "http",
      model: "ancient-awakening:12b",
    });
  });

  it("rejects an empty or provider-only value rather than guessing", () => {
    expect(() => parseBinding("")).toThrow(/empty/i);
    expect(() => parseBinding("cli:")).toThrow(/no model/i);
    expect(() => parseBinding("   ")).toThrow(/empty/i);
  });
});

describe("resolveRole", () => {
  it("uses the fallback when nothing is requested", () => {
    expect(resolveRole({ fallback: HTTP_27B })).toEqual(HTTP_27B);
    expect(resolveRole({ requested: "", fallback: HTTP_27B })).toEqual(HTTP_27B);
  });

  it("lets a request move a role onto another provider without touching its logic", () => {
    expect(resolveRole({ requested: "cli:sonnet", fallback: HTTP_27B })).toEqual(CLI_SONNET);
  });

  // A configuration mistake is never guessed past: any unrecognised value
  // throws rather than quietly selecting something that runs.
  it("throws on an unknown provider instead of falling back", () => {
    expect(() => resolveRole({ requested: "bedrock:sonnet", fallback: HTTP_27B })).toThrow(
      /bedrock/
    );
  });
});

describe("firstAvailable", () => {
  it("returns the first candidate whose probe says yes", async () => {
    const probe = vi.fn(async (b: RoleBinding) => b.provider === "cli");
    await expect(firstAvailable([HTTP_27B, CLI_SONNET], probe)).resolves.toEqual(CLI_SONNET);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("is null when nothing answers, and never throws for a probe that does", async () => {
    const probe = vi.fn(async () => {
      throw new Error("box is off");
    });
    await expect(firstAvailable([HTTP_27B, CLI_SONNET], probe)).resolves.toBeNull();
  });

  it("stops probing once one answers", async () => {
    const probe = vi.fn(async () => true);
    await expect(firstAvailable([HTTP_27B, CLI_SONNET], probe)).resolves.toEqual(HTTP_27B);
    expect(probe).toHaveBeenCalledTimes(1);
  });
});

describe("routeBy", () => {
  // The generic shape of a split by stakes: the PREDICATE stays the caller's
  // -- what makes a turn consequential is that game's domain, and its words
  // for it are forbidden here -- while the routing itself is not.
  it("sends a request to whichever binding the caller's predicate picks", () => {
    const route = routeBy((n: number) => n > 5, CLI_SONNET, HTTP_27B);
    expect(route(9)).toEqual(CLI_SONNET);
    expect(route(1)).toEqual(HTTP_27B);
  });
});
