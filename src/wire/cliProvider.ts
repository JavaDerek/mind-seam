// A backend that is a command, not a POST.
//
// The package's first wire was a `fetch`, and its own CLAUDE.md said so. This
// is the second kind, added because a role's backend has to be swappable for
// the swap to be evidence: one caller's strongest available backend is a
// keyless subscription command, and welding that into one repository means no
// other caller can put a misbehaving role behind it to find out whether the
// role's logic or the model was at fault.
//
// TWO THINGS THIS FILE DELIBERATELY DOES NOT DO, because the guards in this
// tree make them impossible rather than merely discouraged:
//
//   1. It never reads an ambient environment. `env` is a required argument,
//      handed to the spawn untouched. No read of the ambient process
//      environment appears anywhere in this package, asserted by two guards of
//      its own, so there is no path by which a credential present in a parent
//      process reaches a child spawned here. That matters because the documented failure it prevents
//      is a real one: a non-interactive run silently prefers a metered
//      credential over subscription OAuth, with no prompt.
//
//   2. It holds no list of which variable names are credentials. It cannot --
//      this tree's own guard forbids that spelling outright. The caller that
//      knows which names are dangerous asserts their absence and passes the
//      environment it vouches for; this file only promises not to add to it.
//
// What IS generic, and is here: the spawn discipline. One answer per ask, a
// timeout that kills rather than hangs, stderr kept as the detail of a
// failure, and every outcome a `ProviderAnswer` instead of a throw.
import type { Provider, ProviderAnswer } from "./provider.js";

/** The shape of `node:child_process`'s `spawn` this file actually uses.
 *  Declared structurally so a test can inject one and nothing here imports a
 *  process-spawning module at all. */
export type SpawnLike = (
  command: string,
  args: readonly string[],
  options: { env: Readonly<Record<string, string | undefined>>; stdio?: unknown }
) => {
  stdout: { on(event: "data", listener: (chunk: unknown) => void): unknown } | null;
  stderr: { on(event: "data", listener: (chunk: unknown) => void): unknown } | null;
  on(event: "close", listener: (code: number | null) => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  kill(signal?: string): boolean;
};

/** The flag that would quietly make a subscription unusable: it skips OAuth
 *  and the keychain entirely. A caller that builds it is a bug, caught before
 *  a run rather than after one. */
const DISABLES_SUBSCRIPTION_AUTH = "--bare";

const DEFAULT_TIMEOUT_MS = 20_000;

export interface CreateCliProviderOptions {
  /** The command to run. Required and never defaulted: which command, like
   *  which host, is configuration and this package knows nobody's machine. */
  command: string;
  model: string;
  /**
   * The environment the child gets, in full. Required. Passed through
   * untouched -- see this file's header for why that is the entire security
   * property and why the denylist lives with the caller instead.
   */
  env: Readonly<Record<string, string | undefined>>;
  /** The caller's: flag shapes are the command's business, not the seam's. */
  buildArgs: (prompt: string, model: string) => string[];
  /** Pull the answer out of stdout. Default: trimmed stdout, and `null` for
   *  nothing at all, which becomes `unparseable`. A command that wraps its
   *  reply in an envelope unwraps it here. */
  parse?: (stdout: string) => string | null;
  timeoutMs?: number;
  spawnFn?: SpawnLike;
}

/** Node's own spawn, resolved lazily so importing this module costs nothing
 *  and a test that injects `spawnFn` never loads it. */
async function nodeSpawn(): Promise<SpawnLike> {
  const { spawn } = await import("node:child_process");
  return spawn as unknown as SpawnLike;
}

export function createCliProvider(options: CreateCliProviderOptions): Provider {
  const { command, model, env, buildArgs, parse, timeoutMs = DEFAULT_TIMEOUT_MS, spawnFn } = options;

  if (env === undefined || env === null) {
    throw new Error(
      "createCliProvider: env is required -- pass the environment the child should get, " +
        "in full. There is no ambient default on purpose."
    );
  }

  // Construction-time, like `assertInert` on a schema: a caller whose flags
  // would disable subscription auth finds out when it builds the provider,
  // not on the turn that needed an answer.
  const sample = buildArgs("", model);
  if (sample.includes(DISABLES_SUBSCRIPTION_AUTH)) {
    throw new Error(
      `createCliProvider: buildArgs produced ${DISABLES_SUBSCRIPTION_AUTH}, which skips OAuth and ` +
        `the keychain entirely and cannot use a subscription at all. Remove it.`
    );
  }

  return {
    kind: "cli",
    model,

    async ask(prompt: string): Promise<ProviderAnswer> {
      const spawn = spawnFn ?? (await nodeSpawn());
      const args = buildArgs(prompt, model);

      return await new Promise<ProviderAnswer>((resolve) => {
        let settled = false;
        // One answer per ask. A timeout that has already resolved must not be
        // overwritten by the close event that its own kill provokes.
        const settle = (answer: ProviderAnswer) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(answer);
        };

        let child: ReturnType<SpawnLike>;
        try {
          child = spawn(command, args, { env, stdio: ["ignore", "pipe", "pipe"] });
        } catch {
          settle({ ok: false, reason: "unreachable" });
          return;
        }

        const timer = setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            // A child that is already gone is exactly the outcome wanted.
          }
          settle({ ok: false, reason: "timeout" });
        }, timeoutMs);

        let out = "";
        let err = "";
        child.stdout?.on("data", (chunk) => {
          out += String(chunk);
        });
        child.stderr?.on("data", (chunk) => {
          err += String(chunk);
        });

        child.on("error", () => settle({ ok: false, reason: "unreachable" }));

        child.on("close", (code) => {
          if (code !== 0) {
            settle({ ok: false, reason: "status", detail: { text: err.trim() } });
            return;
          }
          const text = (parse ?? ((raw: string) => (raw.trim() === "" ? null : raw.trim())))(out);
          if (text === null || text === "") {
            settle({ ok: false, reason: "unparseable", detail: { text: out.trim() } });
            return;
          }
          settle({ ok: true, text });
        });
      });
    },
  };
}
