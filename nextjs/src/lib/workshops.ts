/**
 * Grading guide: which workshop each feature belongs to, how to check it, and where it's enforced.
 * Edit here to renumber or reword; the /workshops page renders this.
 */
const REPO = "https://github.com/NoodlesCupCake/fde101-erp";
export const commit = (sha: string) => `${REPO}/commit/${sha}`;

export type Check = { req: string; how: string; link?: string; demo?: string; enforced?: string };
export type Workshop = { id: string; title: string; summary: string; checks: Check[]; evidence: string[]; commits: string[] };

export const WORKSHOPS: Workshop[] = [
  {
    id: "1.1",
    title: "Tools, data on Supabase, deploy",
    summary: "gh, git, supabase and vercel installed and signed in. ERP CSVs loaded into Supabase as Postgres tables. App on Vercel, code on GitHub.",
    checks: [
      { req: "31 ERP tables with all CSV rows (~450k) in Supabase", how: "Data pages (Sales orders, Employees) read straight from Supabase", link: "/sales-orders", enforced: "supabase/migrations/20261121000000_erp_schema.sql" },
      { req: "RLS on every table; anonymous visitors read nothing", how: "Sign out, then any page redirects to /login; the API with only the public key returns no rows", enforced: "RLS policies on all 31 tables" },
      { req: "Deployed on Vercel, auto-deploys on every push to main", how: "https://a-erp-xi.vercel.app (functions in Tokyo, next to the database)" },
    ],
    evidence: ["Row counts match the CSVs; general ledger debit − credit = 0.00"],
    commits: ["9cdff25"],
  },
  {
    id: "1.2",
    title: "Login with Supabase Auth",
    summary: "Accounts map to exactly one row in employees (by email). Session checked on the server and in the database. Inactive or terminated employees are blocked.",
    checks: [
      { req: "A signed-out visitor sees only the login page", how: "Open any page in a private window: it redirects to /login", enforced: "src/proxy.ts + DAL (src/lib/dal.ts)" },
      { req: "Sign in with the employee code + password; sign out", how: "Use a demo button, then Sign out in the header", demo: "Employee" },
      { req: "Only active employees can register or sign in", how: "Register with E0026 (terminated): refused", link: "/login?mode=register", enforced: "auth.users trigger only_active_employees_sign_up; current_employee_id()" },
      { req: "Deactivated after sign-in = out on the next request", how: "Admin → terminate an employee: their next page load lands on /login?error=inactive", enforced: "DAL + RLS call current_employee_id() every request" },
    ],
    evidence: ["Sign-up API with a terminated or outside email: rejected; auth.users unchanged"],
    commits: ["9cdff25", "7b17168"],
  },
  {
    id: "1.3",
    title: "User types: Employee, Manager, HR, Admin",
    summary: "Employee and Manager are derived from the data (manager_id); HR and Admin are stored in employee_roles. Types stack (E0057 is Manager + HR).",
    checks: [
      { req: "Everyone sees their own profile with type(s) and reporting manager", how: "Any demo button → My profile", link: "/profile", demo: "Employee" },
      { req: "Managers see their team (subordinates)", how: "Manager → My profile → My team", link: "/profile", demo: "Manager" },
      { req: "An admin can change a user's type", how: "Admin → Admin → + HR / − HR on someone, then check their badges", link: "/admin/users", demo: "Admin", enforced: "RLS on employee_roles (types.manage)" },
      { req: "The Managing Director (E0001) has no manager", how: "Employees list: E0001 reports to –", link: "/employees?q=E0001" },
    ],
    evidence: ["5 demo accounts: types, manager, team and admin access all as expected"],
    commits: ["3d9cb69", "a9dc672"],
  },
  {
    id: "1.4",
    title: "Permissions: role × action matrix",
    summary: "Salary privacy and user CRUD enforced in the database. The matrix itself is editable and stored in role_permissions.",
    checks: [
      { req: "Role × action matrix written down (and editable)", how: "Permissions page; Admin can click a cell to flip it", link: "/permissions", demo: "Admin", enforced: "role_permissions + has_permission()" },
      { req: "Employees and Managers see only their own salary", how: "Employee → Employees: no Salary column; My profile shows own salary", link: "/employees", demo: "Employee", enforced: "no column privilege on employees.monthly_salary; visible_salaries()" },
      { req: "HR sees every salary", how: "HR → Employees: Salary column", link: "/employees", demo: "HR" },
      { req: "Admin can create, read, update, delete users", how: "Admin → Admin → + New employee / edit / Terminate / logins", link: "/admin/users", demo: "Admin", enforced: "admin_*_employee() check users.manage" },
      { req: "Calling the API directly as an employee can't read another salary", how: "Direct REST call returns HTTP 403 permission denied", enforced: "column privileges" },
    ],
    evidence: ["Matrix test straight against the Supabase API, one account per role: 37/37", "Editable permissions test: 13/13 (incl. Admin can't lock itself out)"],
    commits: ["3c4c83e", "1a48053", "1aa3721"],
  },
  {
    id: "1.5",
    title: "Leave requests",
    summary: "Submit, approve/reject with a comment, cancel while pending, computed balances. Every write goes through a database function.",
    checks: [
      { req: "Employee submits: type, start, end (or half day), reason", how: "Employee → Leave → New request", link: "/leave", demo: "Employee", enforced: "submit_leave()" },
      { req: "Approver approves or rejects with a comment (1.4 rules)", how: "Manager → Approvals (team) · HR → Approvals (everyone)", link: "/leave/approvals", demo: "Manager", enforced: "decide_leave() → can_decide_leave()" },
      { req: "Employee sees status + remaining balance, can cancel while pending", how: "Employee → Leave: balance cards, status, Cancel", link: "/leave", demo: "Employee" },
      { req: "Manager sees team's pending requests; HR sees all", how: "Approvals page for each", link: "/leave/approvals", enforced: "RLS on leave_requests" },
      { req: "Nobody approves their own request (UI or API)", how: "Your own request shows “someone else approves it”; the API says “You can't approve your own request”", enforced: "can_decide_leave(); no write privileges on the table" },
      { req: "Rules: past dates, overlaps, half days, weekends, Thai holidays", how: "Try them in the form; each gets a clear error", enforced: "submit_leave(); see README table" },
    ],
    evidence: ["API test: 28/28 (incl. self-approval, direct table writes → 403)", "UI end to end on production: Employee → Manager approve → HR reject with comment"],
    commits: ["6c45b84"],
  },
];
