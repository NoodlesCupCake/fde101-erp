import "server-only";

/**
 * Cursor (keyset) pagination for Supabase/PostgREST queries.
 * The cursor is the sort-key values of the last (or first) row on the page, base64url-encoded in ?after= / ?before=.
 * Unlike OFFSET it stays fast on deep pages and never skips/duplicates rows when new rows are inserted.
 *
 * `keys` must be a unique ordering (add the primary key as the last key as a tie-breaker).
 */
type Key = string | number;
type Search = Record<string, string | string[] | undefined>;

// Minimal shape of a PostgREST filter builder that we need.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Builder = any;

export type CursorPage<T> = { rows: T[]; next: string | null; prev: string | null };

const encode = (v: Key[]) => Buffer.from(JSON.stringify(v)).toString("base64url");
function decode(s: string | string[] | undefined, n: number): Key[] | null {
  if (typeof s !== "string") return null;
  try {
    const v = JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
    return Array.isArray(v) && v.length === n && v.every((x) => typeof x === "string" || typeof x === "number") ? v : null;
  } catch {
    return null;
  }
}

/** PostgREST `or` filter meaning "(k0, k1, …) is strictly before/after (v0, v1, …)". */
function tupleFilter(keys: string[], vals: Key[], op: "lt" | "gt") {
  const q = (v: Key) => (typeof v === "number" ? String(v) : `"${String(v).replace(/"/g, '\\"')}"`);
  const parts = keys.map((k, i) => {
    const eqs = keys.slice(0, i).map((kk, j) => `${kk}.eq.${q(vals[j])}`);
    const cond = `${k}.${op}.${q(vals[i])}`;
    return eqs.length ? `and(${[...eqs, cond].join(",")})` : cond;
  });
  return parts.join(",");
}

export async function cursorPage<T>(opts: {
  search: Search;
  size: number;
  keys: string[];
  descending: boolean;
  /** Build the base query (select + filters, no order/limit). Called once. */
  query: () => Builder;
  keyOf: (row: T) => Key[];
}): Promise<CursorPage<T>> {
  const { search, size, keys, descending, keyOf } = opts;
  const after = decode(search.after, keys.length);
  const before = after ? null : decode(search.before, keys.length);
  const backwards = !!before;
  const ascending = descending === backwards; // flip direction when paging backwards

  let q = opts.query();
  const cur = after ?? before;
  if (cur) q = q.or(tupleFilter(keys, cur, descending !== backwards ? "lt" : "gt"));
  for (const k of keys) q = q.order(k, { ascending });
  const { data, error } = await q.limit(size + 1);
  if (error) throw new Error(error.message);

  let rows = (data ?? []) as T[];
  const more = rows.length > size;
  rows = rows.slice(0, size);
  if (backwards) rows.reverse();

  const first = rows[0], last = rows[rows.length - 1];
  const hasNext = backwards ? true : more;
  const hasPrev = backwards ? more : !!after;
  return {
    rows,
    next: hasNext && last ? encode(keyOf(last)) : null,
    prev: hasPrev && first ? encode(keyOf(first)) : null,
  };
}
