"use client";

import { useActionState, useState } from "react";
import { submitLeave } from "./actions";

const input = "h-9 w-full rounded-md border border-line bg-surface px-3 text-sm";

export function LeaveForm({ types, today }: { types: { code: string; name: string }[]; today: string }) {
  const [state, action, pending] = useActionState(submitLeave, undefined);
  const [half, setHalf] = useState("");
  return (
    <form action={action} className="space-y-3">
      {state?.error && <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{state.error}</p>}
      {state?.ok && <p role="status" className="rounded-md border border-ok/30 bg-ok/5 px-3 py-2 text-sm text-ok">{state.ok}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1 text-sm"><span className="font-medium">Type</span>
          <select name="leave_type" required className={input}>
            {types.map((t) => <option key={t.code} value={t.code}>{t.name}</option>)}
          </select>
        </label>
        <label className="block space-y-1 text-sm"><span className="font-medium">Length</span>
          <select name="half_day" value={half} onChange={(e) => setHalf(e.target.value)} className={input}>
            <option value="">Full day(s)</option>
            <option value="AM">Half day: morning</option>
            <option value="PM">Half day: afternoon</option>
          </select>
        </label>
        <label className="block space-y-1 text-sm"><span className="font-medium">{half ? "Date" : "Start date"}</span>
          <input name="start_date" type="date" required defaultValue={today} className={input} />
        </label>
        {!half && (
          <label className="block space-y-1 text-sm"><span className="font-medium">End date</span>
            <input name="end_date" type="date" required defaultValue={today} className={input} />
          </label>
        )}
        <label className="block space-y-1 text-sm sm:col-span-2"><span className="font-medium">Reason</span>
          <textarea name="reason" required maxLength={500} rows={2} className={`${input} h-auto py-2`} />
        </label>
      </div>
      <p className="text-xs text-muted">Weekends and Thai public holidays aren&apos;t counted. Sick leave can start up to 30 days back; other types can&apos;t be in the past.</p>
      <button disabled={pending} className="h-9 rounded-md bg-brand px-4 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60">
        {pending ? "Submitting…" : "Submit request"}
      </button>
    </form>
  );
}
