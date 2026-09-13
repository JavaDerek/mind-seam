// Two stubs every caller needs and neither should write twice (DESIGN §2.2).
import { assertInert, type InertRecord, type Mind, type Proposal } from "./types.js";

/** The default state of every principal: asked, and says nothing. Assignable
 * to any `Mind<C, P>` because it never reads `C` and never produces a `P`. */
export const SILENT_MIND: Mind<InertRecord, never> = {
  async consider() {
    return null;
  },
};

/**
 * A mind whose answer is scripted, for a test.
 *
 * A fixed `P | null` is handed back every time, unconsumed. A function script
 * is called with the context it was asked about -- and that context is run
 * through `assertInert` first, because a scripted stand-in for a mind is
 * still a place this property must hold: a non-inert context reaching a mind
 * is a defect, not a quiet script.
 */
export function scriptedMind<C extends InertRecord, P extends Proposal>(
  script: P | null | ((context: C) => P | null)
): Mind<C, P> {
  return {
    async consider(context: C): Promise<P | null> {
      if (typeof script === "function") {
        assertInert(context, "context");
        return (script as (context: C) => P | null)(context);
      }
      return script;
    },
  };
}
