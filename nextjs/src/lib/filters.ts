/** Helpers for list filters that come from the URL (?q=…&status=…). Never trust them: clean before querying. */

type Search = Record<string, string | string[] | undefined>;

export const one = (sp: Search, key: string) => (typeof sp[key] === "string" ? (sp[key] as string) : "");

/** Free-text search term, safe to put inside a PostgREST `or=(…)` / ilike pattern. */
export function searchTerm(v: string) {
  return v.replace(/[,()*%\\:"'.]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}

export const isoDate = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "");
export const oneOf = <T extends string>(v: string, allowed: readonly T[]): T | "" => ((allowed as readonly string[]).includes(v) ? (v as T) : "");
export const id = (v: string) => (/^\d{1,9}$/.test(v) ? Number(v) : null);
