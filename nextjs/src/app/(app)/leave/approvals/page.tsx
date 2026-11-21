import { redirect } from "next/navigation";
import { getCurrentEmployee } from "@/lib/dal";
import { date } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { decideLeave } from "../actions";
import { dates, Flash, LEAVE_SELECT, StatusBadge, type LeaveRow } from "../shared";

const APPROVE_PERMS = ["leave.approve_team", "leave.approve_any", "leave.approve_own_if_top"] as const;

/**
 * Pending requests the database lets this user see: their direct reports' (approve_team) or everyone's (approve_any, HR).
 * Buttons appear only where can_decide_leave() says yes, but decide_leave() checks again, so the API gives the same answer.
 */
export default async function Approvals({ searchParams }: PageProps<"/leave/approvals">) {
  const me = await getCurrentEmployee();
  if (!APPROVE_PERMS.some((p) => me.permissions.includes(p))) redirect("/leave?error=You+don't+approve+leave");
  const sp = await searchParams;
  const supabase = await createClient();

  const [pending, recent] = await Promise.all([
    supabase.from("leave_requests").select(LEAVE_SELECT).eq("status", "PENDING").order("start_date").limit(100).returns<LeaveRow[]>(),
    supabase.from("leave_requests").select(LEAVE_SELECT).in("status", ["APPROVED", "REJECTED"]).eq("decided_by", me.employee_id)
      .order("decided_at", { ascending: false }).limit(10).returns<LeaveRow[]>(),
  ]);
  const rows = pending.data ?? [];
  const can = await Promise.all(rows.map((r) => supabase.rpc("can_decide_leave", { p_request_id: r.request_id }).then((x) => x.data === true)));
  const isHR = me.permissions.includes("leave.approve_any");

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Leave approvals</h1>
        <p className="text-sm text-muted">{isHR ? "You approve for everyone (HR), except your own requests." : "Pending requests from your direct reports."}</p>
      </div>
      <Flash sp={sp} />

      <section className="rounded-xl border border-line bg-surface">
        <h2 className="border-b border-line px-5 py-3 font-semibold">Pending ({rows.length})</h2>
        <ul className="divide-y divide-line">
          {rows.map((r, i) => (
            <li key={r.request_id} className="grid gap-3 px-5 py-3 md:grid-cols-[1fr_auto]">
              <div className="text-sm">
                <div className="font-medium">
                  {r.employee?.first_name} {r.employee?.last_name} <span className="font-mono text-xs text-muted">{r.employee?.employee_code}</span>
                  {r.employee_id === me.employee_id && <span className="ml-1 text-xs text-brand">(you)</span>}
                </div>
                <div>{r.leave_type} · {dates(r)} · <b>{Number(r.days)}</b> day(s) <StatusBadge status={r.status} /></div>
                <div className="text-muted">“{r.reason}” · submitted {date(r.created_at.slice(0, 10))}</div>
              </div>
              {can[i] ? (
                <form action={decideLeave} className="flex flex-wrap items-start gap-2">
                  <input type="hidden" name="request_id" value={r.request_id} />
                  <input name="comment" placeholder="Comment (required to reject)" maxLength={500}
                    className="h-9 w-56 rounded-md border border-line bg-surface px-3 text-sm" />
                  <button name="decision" value="approve" className="h-9 rounded-md bg-ok px-3 text-sm font-medium text-white hover:opacity-90">Approve</button>
                  <button name="decision" value="reject" className="h-9 rounded-md border border-danger/40 px-3 text-sm text-danger hover:bg-danger/5">Reject</button>
                </form>
              ) : (
                <span className="self-center text-xs text-muted">
                  {r.employee_id === me.employee_id ? "Your own request: someone else approves it" : "Not yours to decide"}
                </span>
              )}
            </li>
          ))}
          {rows.length === 0 && <li className="px-5 py-6 text-center text-sm text-muted">Nothing waiting. 🎉</li>}
        </ul>
      </section>

      <section className="rounded-xl border border-line bg-surface">
        <h2 className="border-b border-line px-5 py-3 font-semibold">My recent decisions</h2>
        <ul className="divide-y divide-line text-sm">
          {(recent.data ?? []).map((r) => (
            <li key={r.request_id} className="flex flex-wrap justify-between gap-2 px-5 py-2">
              <span>{r.employee?.first_name} {r.employee?.last_name} · {r.leave_type} · {dates(r)}</span>
              <span><StatusBadge status={r.status} /> {r.decision_comment && <span className="text-muted">“{r.decision_comment}”</span>}</span>
            </li>
          ))}
          {(recent.data ?? []).length === 0 && <li className="px-5 py-4 text-center text-muted">None yet.</li>}
        </ul>
      </section>
    </div>
  );
}
