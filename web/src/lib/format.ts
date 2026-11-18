const money2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const compactFmt = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export const money = (v: number | null | undefined) => (v == null ? "—" : money2.format(v));
export const baht = (v: number | null | undefined) => (v == null ? "—" : `฿${money2.format(v)}`);
export const compact = (v: number | null | undefined) => (v == null ? "—" : compactFmt.format(v));
export const bahtCompact = (v: number | null | undefined) => (v == null ? "—" : `฿${compactFmt.format(v)}`);
export const num = (v: number | null | undefined) => (v == null ? "—" : int.format(v));
/** Accounting style in THB thousands: 1,234 / (1,234) for negatives */
export const thousands = (v: number | null | undefined) =>
  v == null ? "—" : v < 0 ? `(${int.format(Math.round(-v / 1000))})` : int.format(Math.round(v / 1000));
export const pct = (v: number | null | undefined, digits = 1) => (v == null ? "—" : `${v.toFixed(digits)}%`);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-31" → "31 Oct 2026" (no timezone drift: parsed as parts, not Date) */
export function date(s: string | null | undefined) {
  if (!s) return "—";
  const [y, m, d] = s.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

/** "2026-03" → "Mar 26" */
export function monthLabel(s: string) {
  const [y, m] = s.split("-");
  return `${MONTHS[Number(m) - 1]} ${y.slice(2)}`;
}

export const monthName = (mm: string) => MONTHS[Number(mm) - 1];

export const titleCase = (s: string) =>
  s.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
