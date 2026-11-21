import { date } from "@/lib/format";

export type LeaveRow = {
  request_id: number;
  employee_id: number;
  leave_type: string;
  start_date: string;
  end_date: string;
  half_day: "AM" | "PM" | null;
  days: number;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  decided_at: string | null;
  decision_comment: string | null;
  created_at: string;
  employee?: { employee_code: string; first_name: string; last_name: string; job_title: string } | null;
  decider?: { employee_code: string; first_name: string; last_name: string } | null;
};

export const LEAVE_SELECT =
  "request_id, employee_id, leave_type, start_date, end_date, half_day, days, reason, status, decided_at, decision_comment, created_at, " +
  "employee:employees!leave_requests_employee_id_fkey(employee_code, first_name, last_name, job_title), " +
  "decider:employees!leave_requests_decided_by_fkey(employee_code, first_name, last_name)";

const STATUS_STYLE: Record<LeaveRow["status"], string> = {
  PENDING: "bg-brand/15 text-brand",
  APPROVED: "bg-ok/15 text-ok",
  REJECTED: "bg-danger/15 text-danger",
  CANCELLED: "bg-muted/15 text-muted",
};

export function StatusBadge({ status }: { status: LeaveRow["status"] }) {
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}>{status.toLowerCase()}</span>;
}

export function dates(r: Pick<LeaveRow, "start_date" | "end_date" | "half_day">) {
  if (r.half_day) return `${date(r.start_date)} (${r.half_day} half)`;
  return r.start_date === r.end_date ? date(r.start_date) : `${date(r.start_date)} – ${date(r.end_date)}`;
}

export function Flash({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  if (typeof sp.ok === "string") return <p role="status" className="rounded-md border border-ok/30 bg-ok/5 px-3 py-2 text-sm text-ok">{sp.ok}</p>;
  if (typeof sp.error === "string") return <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{sp.error}</p>;
  return null;
}
