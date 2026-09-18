// The second wire: a command, not a POST. Tests run with an injected spawn,
// so nothing here starts a process.
import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { createCliProvider, type SpawnLike } from "./cliProvider.js";

/** A child process that is entirely under the test's control. */
function fakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: (signal?: string) => boolean;
    killed: boolean;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = vi.fn(() => {
    child.killed = true;
    return true;
  });
  return child;
}

const ARGS = (prompt: string, model: string) => ["-p", prompt, "--model", model];

function provider(overrides: Partial<Parameters<typeof createCliProvider>[0]> = {}) {
  const child = fakeChild();
  const spawnFn = vi.fn((() => child) as unknown as SpawnLike);
  const p = createCliProvider({
    command: "claude",
    model: "sonnet",
    env: { PATH: "/usr/bin" },
    buildArgs: ARGS,
    spawnFn,
    ...overrides,
  });
  return { p, child, spawnFn };
}

describe("the environment is handed through, never inherited", () => {
  // The whole reason this provider can live outside the repository whose
  // credential-hygiene tests scan for a leaked key: there is no code path
  // that reads an ambient environment, because `env` is a required argument
  // and is passed straight through. Inheritance is not defended against, it
  // is unrepresentable.
  it("spawns with exactly the env it was given", async () => {
    const { p, child, spawnFn } = provider({ env: { PATH: "/usr/bin", TERM: "dumb" } });
    const answer = p.ask("hello");
    child.stdout.emit("data", "hi there");
    child.emit("close", 0);
    await answer;

    const options = spawnFn.mock.calls[0][2] as { env: Record<string, string> };
    expect(options.env).toEqual({ PATH: "/usr/bin", TERM: "dumb" });
  });

  it("requires env, so there is no defaulted ambient path to fall into", () => {
    // A missing env is a programming error caught at construction, never a
    // silent read of whatever the parent process happened to be holding.
    expect(() =>
      createCliProvider({
        command: "claude",
        model: "sonnet",
        buildArgs: ARGS,
        // @ts-expect-error env is required on purpose -- this is the test
        env: undefined,
      })
    ).toThrow(/env is required/i);
  });
});

describe("the flag that would silently disable the subscription", () => {
  // `--bare` skips OAuth and the keychain entirely, so a spawn carrying it
  // cannot use a subscription at all. A caller that builds it is caught at
  // construction rather than after a run has quietly cost money elsewhere.
  it("refuses to build a provider whose args carry --bare", () => {
    expect(() =>
      createCliProvider({
        command: "claude",
        model: "sonnet",
        env: {},
        buildArgs: () => ["-p", "x", "--bare"],
      })
    ).toThrow(/--bare/);
  });
});

describe("an answer, or silence with a reason", () => {
  it("returns stdout on a clean exit", async () => {
    const { p, child } = provider();
    const answer = p.ask("question");
    child.stdout.emit("data", "  an answer  ");
    child.emit("close", 0);
    await expect(answer).resolves.toEqual({ ok: true, text: "an answer" });
  });

  it("is silent with `status` on a non-zero exit, keeping stderr as detail", async () => {
    const { p, child } = provider();
    const answer = p.ask("question");
    child.stderr.emit("data", "not logged in");
    child.emit("close", 1);
    await expect(answer).resolves.toEqual({
      ok: false,
      reason: "status",
      detail: { text: "not logged in" },
    });
  });

  it("is silent with `unparseable` when a clean exit printed nothing", async () => {
    const { p, child } = provider();
    const answer = p.ask("question");
    child.emit("close", 0);
    await expect(answer).resolves.toEqual({ ok: false, reason: "unparseable", detail: { text: "" } });
  });

  it("is silent with `unreachable` when the command cannot be run at all", async () => {
    const { p, child } = provider();
    const answer = p.ask("question");
    child.emit("error", new Error("ENOENT"));
    await expect(answer).resolves.toEqual({ ok: false, reason: "unreachable" });
  });

  it("is silent with `timeout` and kills the child rather than hanging a turn", async () => {
    vi.useFakeTimers();
    const { p, child } = provider({ timeoutMs: 1000 });
    const answer = p.ask("question");
    vi.advanceTimersByTime(1001);
    await expect(answer).resolves.toEqual({ ok: false, reason: "timeout" });
    expect(child.kill).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("answers once, even if a late close follows a timeout", async () => {
    vi.useFakeTimers();
    const { p, child } = provider({ timeoutMs: 1000 });
    const answer = p.ask("question");
    vi.advanceTimersByTime(1001);
    child.stdout.emit("data", "too late");
    child.emit("close", 0);
    await expect(answer).resolves.toEqual({ ok: false, reason: "timeout" });
    vi.useRealTimers();
  });
});

describe("what the caller decides", () => {
  it("passes the prompt and model through the caller's own buildArgs", async () => {
    const { p, child, spawnFn } = provider();
    const answer = p.ask("the question");
    child.stdout.emit("data", "ok");
    child.emit("close", 0);
    await answer;
    expect(spawnFn.mock.calls[0][0]).toBe("claude");
    expect(spawnFn.mock.calls[0][1]).toEqual(["-p", "the question", "--model", "sonnet"]);
  });

  it("reports the model it is bound to", () => {
    expect(provider().p.model).toBe("sonnet");
  });
});
