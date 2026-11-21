// Shared helpers for the A-ERP test suite (Node's built-in test runner, no extra packages).
//
//   npm test                 read-only checks against production (https://a-erp-xi.vercel.app)
//   npm run test:writes      also the checks that create rows (orders, requisitions, leave) in the real database
//   BASE_URL=http://localhost:3000 npm test     run the page checks against a local `next start`
//
// Two kinds of checks:
//   api.*      straight to Supabase with the publishable key + a user's own login (what anyone could do with curl)
//   Browser    the real pages: cookies, redirects, and Server Action forms, like a browser
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const envFile = fileURLToPath(new URL("../.env.local", import.meta.url));
const env = Object.fromEntries(
  readFileSync(envFile, "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]),
);
export const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const PUB = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const PASSWORD = env.DEMO_PASSWORD;
export const BASE_URL = (process.env.BASE_URL ?? "https://a-erp-xi.vercel.app").replace(/\/$/, "");
export const WRITES = process.env.TEST_WRITES === "1";
/** Pass as the test's options: skipped unless TEST_WRITES=1. */
export const writes = { skip: WRITES ? false : "creates rows in the real database (npm run test:writes)" };

// ------------------------------------------------------------------ Supabase API
/** Call PostgREST / Auth. Returns { status, data } (data = parsed JSON, or the error message). */
export async function api(path, { body, token, method, headers = {} } = {}) {
  const res = await fetch(SUPABASE_URL + path, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: { apikey: PUB, "Content-Type": "application/json", Prefer: "return=representation",
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok && data && typeof data === "object") data = data.message ?? data.msg ?? data;
  return { status: res.status, data, headers: res.headers };
}
export const rpc = (fn, args, token) => api(`/rest/v1/rpc/${fn}`, { body: args ?? {}, token });
export const select = (path, token) => api(`/rest/v1/${path}`, { token });
/** Exact row count visible to this user (RLS applies). */
export async function count(table, token, filter = "") {
  const r = await api(`/rest/v1/${table}?select=*${filter}`, { token, headers: { Prefer: "count=exact", Range: "0-0" } });
  return Number((r.headers.get("content-range") ?? "*/0").split("/")[1]);
}

// Supabase Auth rate-limits sign-ins per IP (429), and every test file runs in its own process. So tokens and
// browser sessions are cached in a temp file (outside the repo) for 50 minutes; access tokens last an hour.
const CACHE = join(tmpdir(), `a-erp-test-sessions-${new URL(BASE_URL).host.replace(/[^a-z0-9]/gi, "_")}.json`);
const TTL = 50 * 60 * 1000;
function readCache() {
  try { const c = JSON.parse(readFileSync(CACHE, "utf8")); return Date.now() - c.at < TTL ? c : { at: Date.now(), tokens: {}, cookies: {} }; }
  catch { return { at: Date.now(), tokens: {}, cookies: {} }; }
}
function saveCache(patch) {
  const c = existsSync(CACHE) ? readCache() : { at: Date.now(), tokens: {}, cookies: {} };
  writeFileSync(CACHE, JSON.stringify({ ...c, tokens: { ...c.tokens, ...patch.tokens }, cookies: { ...c.cookies, ...patch.cookies } }));
}
const tokens = new Map(Object.entries(readCache().tokens));
/** Sign in as an employee code (demo password from .env.local) and return the access token. Cached per code. */
export async function login(code) {
  if (!tokens.has(code)) {
    const { data: email } = await rpc("login_email_for", { p_username: code });
    if (!email) throw new Error(`${code} is not an active employee`);
    const r = await api("/auth/v1/token?grant_type=password", { body: { email, password: PASSWORD } });
    if (r.status !== 200) throw new Error(`${code} can't sign in (${r.status}): does it have a login?`);
    tokens.set(code, r.data.access_token);
    saveCache({ tokens: { [code]: r.data.access_token } });
  }
  return tokens.get(code);
}

// ------------------------------------------------------------------ pages
export class Browser {
  cookies = new Map();
  #cookieHeader() { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "); }
  #store(res) {
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(";"); const i = kv.indexOf("=");
      const k = kv.slice(0, i), v = kv.slice(i + 1);
      if (/max-age=0|expires=thu, 01 jan 1970/i.test(c) || v === "") this.cookies.delete(k); else this.cookies.set(k, v);
    }
  }
  /** GET, following redirects. Returns { url (path), status, html }. */
  async get(path) {
    let url = BASE_URL + path;
    for (let hop = 0; hop < 10; hop++) {
      const res = await fetch(url, { redirect: "manual", headers: { cookie: this.#cookieHeader() } });
      this.#store(res);
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) { url = new URL(loc, url).toString(); continue; }
      return { url: url.replace(BASE_URL, ""), status: res.status, html: await res.text() };
    }
    throw new Error("too many redirects");
  }
  /** POST a form (multipart, like a Server Action form). Does not follow the redirect: returns { status, location, html }. */
  async post(path, fields) {
    const fd = new FormData();
    for (const [k, v] of fields) fd.append(k, v);
    const res = await fetch(BASE_URL + path, { method: "POST", body: fd, redirect: "manual",
      headers: { cookie: this.#cookieHeader(), Origin: BASE_URL } });
    this.#store(res);
    return { status: res.status, location: res.headers.get("location") ?? "", html: await res.text() };
  }
}

const unescape = (s) => s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
/** Every <form> on a page with its hidden inputs (incl. the Server Action ids React renders). */
export function forms(html) {
  return [...html.matchAll(/<form\b[\s\S]*?<\/form>/g)].map(([f]) => ({
    html: f,
    hidden: [...f.matchAll(/<input[^>]*type="hidden"[^>]*>/g)].map(([i]) => {
      const name = /name="([^"]*)"/.exec(i)?.[1]; const value = /value="([^"]*)"/.exec(i)?.[1] ?? "";
      return name ? [unescape(name), unescape(value)] : null;
    }).filter(Boolean),
  }));
}
/** Visible text of a page (tags stripped, React's <!-- --> separators removed). */
export const text = (html) => unescape(html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").replace(/\(\s+/g, "(");

/**
 * One-click demo sign-in through the real login page. Returns a signed-in Browser.
 * The session is reused across test files (see CACHE) unless { fresh: true }, e.g. for a test that signs out.
 */
export async function demoLogin(code, { fresh = false } = {}) {
  const saved = fresh ? null : readCache().cookies[code];
  if (saved) {
    const b = new Browser();
    for (const [k, v] of saved) b.cookies.set(k, v);
    if (!(await b.get("/profile")).url.startsWith("/login")) return b;
  }
  const b = new Browser();
  const { html } = await b.get("/login");
  const form = forms(html).find((f) => f.html.includes('name="code"'));
  if (!form) throw new Error("no demo buttons on /login (DEMO_PASSWORD not set on the server?)");
  const r = await b.post("/login", [...form.hidden, ["code", code]]);
  if (!(r.status === 303 || r.status === 200)) throw new Error(`demo login ${code}: HTTP ${r.status}`);
  if (!fresh) saveCache({ cookies: { [code]: [...b.cookies] } });
  return b;
}
/** A protected page answered with a redirect (HTTP redirect, or the in-stream NEXT_REDIRECT when loading.tsx streams). */
export const redirectedTo = (page, target) => page.url.startsWith(target) || (page.html.includes("NEXT_REDIRECT") && page.html.includes(target));
export const notFoundPage = (page) => page.status === 404 || page.html.includes("NEXT_HTTP_ERROR_FALLBACK;404");

/** Money as exact cents (avoids float drift when comparing with a hand calculation). */
export const cents = (n) => Math.round(Number(n) * 100);
/** round(x, 2) the way Postgres does for numeric (half away from zero), on cents. */
export const round2 = (x) => Math.sign(x) * Math.round(Math.abs(x) * 100 + 1e-9) / 100;
