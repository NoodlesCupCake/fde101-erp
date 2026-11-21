import Link from "next/link";
import { getCurrentEmployee } from "@/lib/dal";
import { commit, WORKSHOPS } from "@/lib/workshops";

/** Grading guide: pick a workshop, see each requirement, how to check it, and where it's enforced. */
export default async function Workshops({ searchParams }: PageProps<"/workshops">) {
  await getCurrentEmployee();
  const sp = await searchParams;
  const current = WORKSHOPS.find((w) => w.id === sp.w) ?? WORKSHOPS[WORKSHOPS.length - 1];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Workshops</h1>
        <p className="text-sm text-muted">Everything is in this one app. Pick a workshop to see what it covers and how to check it.
          Demo buttons are on the sign-in page (Sign out to switch user).</p>
      </div>

      <nav className="flex flex-wrap gap-2" aria-label="Workshop">
        {WORKSHOPS.map((w) => (
          <Link key={w.id} href={`/workshops?w=${w.id}`} aria-current={w.id === current.id ? "page" : undefined}
            className={`rounded-lg border px-3 py-2 text-sm transition ${w.id === current.id ? "border-brand bg-brand/10 font-medium text-brand" : "border-line hover:bg-surface"}`}>
            <span className="font-mono">{w.id}</span> · {w.title}
          </Link>
        ))}
      </nav>

      <section className="space-y-4 rounded-xl border border-line bg-surface p-5">
        <div>
          <h2 className="text-lg font-semibold"><span className="font-mono">{current.id}</span> {current.title}</h2>
          <p className="mt-1 text-sm text-muted">{current.summary}</p>
        </div>
        <ol className="space-y-3">
          {current.checks.map((c, i) => (
            <li key={i} className="rounded-lg border border-line p-3 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="font-medium"><span className="text-ok">✓</span> {c.req}</div>
                <div className="flex gap-2 text-xs">
                  {c.demo && <span className="rounded-full bg-brand/10 px-2 py-0.5 text-brand">Demo: {c.demo}</span>}
                  {c.link && <Link href={c.link} className="text-brand hover:underline">Open →</Link>}
                </div>
              </div>
              <div className="mt-1 text-muted">How to check: {c.how}</div>
              {c.enforced && <div className="mt-1 text-xs text-muted">Enforced by: <code>{c.enforced}</code></div>}
            </li>
          ))}
        </ol>
        <div className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <div className="font-medium">Test results</div>
            <ul className="mt-1 list-disc pl-5 text-muted">{current.evidence.map((e) => <li key={e}>{e}</li>)}</ul>
          </div>
          <div>
            <div className="font-medium">Code changes</div>
            <ul className="mt-1 space-y-0.5">
              {current.commits.map((sha) => (
                <li key={sha}><a href={commit(sha)} target="_blank" rel="noreferrer" className="font-mono text-brand hover:underline">{sha}</a> on GitHub</li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </div>
  );
}
