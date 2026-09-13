// The seam's contract (DESIGN §3.1). One shape, generic over the caller's
// context and proposal, and one runtime assertion that catches the two holes
// no type system can (§3.2): a cast, and a getter.

/** Data and nothing else. No function, no symbol, no class instance, no getter. */
export type Inert =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly Inert[]
  | InertRecord;

export type InertRecord = { readonly [field: string]: Inert };

/** The least a proposal is. A caller may add fields; whatever it adds is Inert. */
export type Proposal = InertRecord & { readonly intent: string; readonly line?: string };

/** The seam. One method, by design: a mind is asked; it never polls (§3.4). */
export interface Mind<C extends InertRecord, P extends Proposal = Proposal> {
  consider(context: C): Promise<P | null>;
}

/**
 * Throws unless `value` is Inert at runtime, naming the offending path.
 *
 * What the type system cannot keep (§3.2): a value cast past `C extends
 * InertRecord`, or a getter that type-checks as a plain field, reads as a
 * string with `typeof`, and is a live path to storage. This walks the value
 * and requires, at every level: a primitive from the `Inert` set, or an array
 * whose prototype is `Array.prototype`, or an object whose prototype is
 * `Object.prototype` or `null` -- and for every own property (string keys
 * only; a symbol key is itself a violation), a **data** descriptor (`get` and
 * `set` both `undefined`).
 */
export function assertInert(value: unknown, path = "value"): asserts value is Inert {
  walk(value, path);
}

function walk(value: unknown, path: string): void {
  if (value === null || value === undefined) return;

  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") return;

  if (t === "function") {
    throw new TypeError(`${path} is not inert: a function is not data`);
  }
  if (t === "symbol") {
    throw new TypeError(`${path} is not inert: a symbol is not data`);
  }
  if (t !== "object") {
    throw new TypeError(`${path} is not inert: a ${t} is not data`);
  }

  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      throw new TypeError(`${path} is not inert: an array subclass is not plain data`);
    }
    value.forEach((item, i) => walk(item, `${path}[${i}]`));
    return;
  }

  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new TypeError(
      `${path} is not inert: a class instance (or other non-plain object) is not data`
    );
  }

  const symbolKeys = Object.getOwnPropertySymbols(value);
  if (symbolKeys.length > 0) {
    throw new TypeError(`${path} is not inert: a symbol-keyed property is not data`);
  }

  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) continue;
    if (descriptor.get !== undefined || descriptor.set !== undefined) {
      throw new TypeError(`${path}.${key} is not inert: an accessor property has no path but code`);
    }
    walk(descriptor.value, `${path}.${key}`);
  }
}
