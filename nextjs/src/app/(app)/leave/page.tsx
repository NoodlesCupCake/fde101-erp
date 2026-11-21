import { getCurrentEmployee } from "@/lib/dal";
import { date } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { cancelLeave } from "./actions";
import { LeaveForm } from "./leave-form";
import { dates, Flash, LEAVE_SELECT, StatusBadge, type LeaveRow } from "./shared";

type Balance = { leave_type: string; name: string; entitled: number; used: number; pending: number; remaining: number };

export default async function MyLeave({ searchParams }: PageProps<"/leave">) {
  const me = await getCurrentEmployee();
  const sp = await searchParams;
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);
  const [balances, types, mine, holidays] = await Promise.all([
    supabase.rpc("my_leave_balances"),
    supabase.from("leave_types").select("code, name").order("code"),
    supabase.from("leave_requests").select(LEAVE_SELECT).eq("employee_id", me.employee_id)
      .order("created_at", { ascending: false }).limit(50).returns<LeaveRow[]>(),
    supabase.from("public_holidays").select("holiday_date, name").gte("holiday_date", today).order("holiday_date").limit(5),
  ]);
  const canRequest = me.permissions.includes("leave.request");
  await supabase.rpc("mark_seen", { p_feed: "my_leave" }); // clears the "new decisions" badge

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">My leave</h1>
        <p className="text-sm text-muted">
          Approver: {me.manager_name ? `${me.manager_name} (${me.manager_code}), or HR` : "you have no superior, so HR or you (top of the organization)"}
        </p>
      </div>
      <Flash sp={sp} />

      <section className="grid gap-3 sm:grid-cols-3">
        {((balances.data ?? []) as Balance[]).map((b) => (
          <div key={b.leave_type} className="rounded-xl border border-line bg-surface p-4">
            <div className="text-sm text-muted">{b.name} · {new Date().getFullYear()}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{Number(b.remaining)} <span className="text-sm font-normal text-muted">of {Number(b.entitled)} days left</span></div>
            <div className="mt-1 text-xs text-muted">{Number(b.used)} used · {Number(b.pending)} pending (reserved)</div>
          </div>
        ))}
      </section>

      {canRequest ? (
        <section className="rounded-xl border border-line bg-surface p-5">
          <h2 className="mb-3 font-semibold">New request</h2>
          <LeaveForm types={types.data ?? []} today={today} />
        </section>
      ) : (
        <p className="text-sm text-muted">Your types don&apos;t have leave.request.</p>
      )}

      <section className="rounded-xl border border-line bg-surface">
        <h2 className="border-b border-line px-5 py-3 font-semibold">My requests</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted">
              <tr><th className="px-4 py-2 font-medium">#</th><th className="px-4 py-2 font-medium">Type</th><th className="px-4 py-2 font-medium">Dates</th>
                <th className="px-4 py-2 text-right font-medium">Days</th><th className="px-4 py-2 font-medium">Status</th><th className="px-4 py-2 font-medium">Decision</th><th /></tr>
            </thead>
            <tbody>
              {(mine.data ?? []).map((r) => (
                <tr key={r.request_id} className="border-t border-line align-top">
                  <td className="px-4 py-2 font-mono text-xs">{r.request_id}</td>
                  <td className="px-4 py-2">{r.leave_type}<div className="text-xs text-muted">{r.reason}</div></td>
                  <td className="whitespace-nowrap px-4 py-2">{dates(r)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{Number(r.days)}</td>
                  <td className="px-4 py-2"><StatusBadge status={r.status} /></td>
                  <td className="px-4 py-2 text-xs text-muted">
                    {r.decider ? <>{r.decider.first_name} {r.decider.last_name} · {date(r.decided_at?.slice(0, 10) ?? null)}{r.decision_comment && <div className="text-foreground">“{r.decision_comment}”</div>}</> : "–"}
                  </td>
                  <td className="px-4 py-2 text-right">
                    {r.status === "PENDING" && (
                      <form action={cancelLeave}><input type="hidden" name="request_id" value={r.request_id} />
                        <button className="h-8 rounded-md border border-line px-2.5 text-xs hover:bg-background">Cancel</button></form>
                    )}
                  </td>
                </tr>
              ))}
              {(mine.data ?? []).length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-muted">No requests yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-xs text-muted">
        Next public holidays: {(holidays.data ?? []).map((h) => `${date(h.holiday_date)} ${h.name}`).join(" · ") || "none listed"}
      </p>
    </div>
  );
}
