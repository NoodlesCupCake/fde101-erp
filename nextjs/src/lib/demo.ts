/**
 * One-click demo accounts on /login (synthetic data only). The password stays on the server (DEMO_PASSWORD);
 * the browser only sends the employee code, and only codes in this list are accepted.
 * Types still come from the database, so changing a demo user's type in /admin/users is reflected here.
 * E0005 reports to E0004 and E0059 is HR, so Employee → Manager → HR can walk one leave request end to end.
 */
export const DEMO_ACCOUNTS = [
  { code: "E0005", label: "Employee", who: "Somchai Y. · Sales Rep · reports to E0004" },
  { code: "E0004", label: "Manager", who: "Sasithorn K. · Sales Manager" },
  { code: "E0059", label: "HR", who: "Pichai I. · HR Officer" },
  { code: "E0057", label: "Manager + HR", who: "Anan S. · HR & Admin Manager" },
  { code: "E0061", label: "Admin", who: "Surasak B. · Admin Officer" },
] as const;

/** Logins that admins can't delete or re-password (presets + the shared E0002 account handed out earlier). */
export const DEMO_CODES: ReadonlySet<string> = new Set([...DEMO_ACCOUNTS.map((a) => a.code), "E0002"]);
