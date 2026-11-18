# A-ERP: learning to build an ERP with agentic coding

A-ERP is a **learning project**: an exploration of how far you can get building an ERP (Enterprise Resource
Planning) system by **directing an AI coding agent** instead of writing every line by hand. The author
describes each step in plain language, and the agent ([Claude Code](https://claude.com/claude-code))
does the work: it plans, writes the code, runs it, checks the result in a browser, and reports back.
The author reviews each step and decides the next one.

The goal is to learn the *workflow*, not to ship a production ERP:
- how to break a large system into steps an agent can carry out,
- how to give it context (data, design rules, constraints),
- how to verify what it produces,
- and where a human still has to make the call.

> ⚠️ **Prototype with synthetic data.** All companies, people and figures are fictional. Not for real
> accounting or business use.

## What the project contains

A working ERP prototype for a fictional Thai distributor, **A-Pro Distribution Co., Ltd.**, which sells
hardware and building materials from 3 warehouses (Bangkok, Chiang Mai, Khon Kaen) to retail shops,
contractors and wholesalers:

1. **Synthetic dataset** (`src/erp_synth/`): a day-by-day business simulation, not random rows. Stock-outs
   trigger purchase orders, deliveries draw down stock at moving-average cost, and every financial event
   posts a balanced journal entry. Sub-ledgers reconcile to the general ledger.
2. **API** (`src/erp_api/`): a read-only FastAPI JSON API over the SQLite data.
3. **Web app** (`web/`): a React app with dashboard, sales, customers, receivables, inventory, purchasing
   and accounting pages.
4. **Sign-in**: local accounts in SQLite (scrypt-hashed passwords, HttpOnly session cookies).

## How it was built: the agentic-coding journey

Each step started as a short instruction to the agent. The agent then did the work end to end and the
author reviewed the result.

| # | Instruction (paraphrased) | What the agent did | What it taught |
|---|---|---|---|
| 1 | *"Initial project: start from a synthetic dataset"* | Chose sensible defaults (Thai distributor, THB, 7% VAT), wrote a day-by-day simulation with GL postings, ran it, noticed unrealistic results (90% of revenue from one segment, negative cash, 1-line POs), and re-tuned until every integrity check passed | Ask for **self-checks**: the agent's own validations caught bad data that looked fine at a glance |
| 2 | *"Run server"* | No app existed yet, so it served the database with an off-the-shelf data browser (Datasette) as a stopgap | A vague instruction gets a reasonable interpretation, so say which outcome you actually want |
| 3 | *"Change frontend to React; install the ui-ux-pro-max skill"* | Read the third-party skill before installing it, kept only the safe core part, generated a design system with it, built the API and React app, then checked every page in a real browser (desktop, mobile, light and dark) and fixed what it saw | **Verify visually.** Screenshots caught clipped columns, an overflowing table and a runtime error that type checks missed |
| 4 | *"Add login using Supabase (see .env.local)"* | Read the config without printing secrets, queried the project's auth settings, verified sign-in tokens on the API (not just in the UI), and wrote tests | Secure the **server**, not only the screen. A login page alone protects nothing |
| 5 | *"Give a testing account"* | Explained that email confirmation blocked it, and listed the options instead of working around it | A good agent **stops and explains a real blocker** instead of faking success |
| 6 | *"Change to SQLite"* | Replaced Supabase with local accounts (hashed passwords, cookie sessions, rate limiting), added a user-admin CLI, created a test account, and tested sign-in and sign-out end to end | Changing direction is cheap when each step is small and tested |
| 7 | *"Commit generated CSVs; publish to GitHub"* | Fixed a `.gitignore` rule that silently didn't work, scanned for secrets, kept the database files with password hashes out of the repo | Review **what becomes public** before every push |

### Lessons for agentic coding

- **Small, outcome-focused steps** beat one giant spec. Each step above was one or two sentences.
- **Let the agent verify its own work**: integrity checks, unit tests, type checks, and real-browser screenshots.
- **Give it tools and context**: current library docs, a design-system skill, and the browser it can drive.
- **Keep the human on decisions**: scope, trade-offs, what goes public, and when something is "good enough".
- **Watch secrets and side effects**: the agent masked keys, kept password hashes out of git, and
  asked before outward-facing actions.

## Quick start

```bash
uv run python -m erp_synth generate            # → data/erp.sqlite (+ data/csv/*.csv, data/ground_truth/*.csv)
uv run python -m erp_synth validate            # re-run integrity checks + summary
uv run python -m unittest discover -s tests    # smoke tests (integrity + determinism)

# options
uv run python -m erp_synth generate --seed 7 --start 2024-01-01 --end 2026-10-31 --customers 600 --orders-per-day 30
```

The generator uses only the Python standard library (3.11+). The same seed always gives byte-identical output.
The CSV export (`data/csv/`) is committed so you can explore the data without running anything. The SQLite
database and ground-truth files are generated locally.

## Run the app (React frontend + API)

```bash
uv run python -m erp_synth generate                                  # once: build data/erp.sqlite
uv run uvicorn erp_api.app:app --reload --reload-dir src --port 8010  # terminal 1: JSON API
cd web && npm install && npm run dev                                 # terminal 2: React dev server (port 5180)
# → http://127.0.0.1:5180   (Vite proxies /api to :8010; override with ERP_API=http://host:port)
```

Single-port mode: `cd web && npm run build` creates `web/dist`. The API then serves the app at
http://127.0.0.1:8010 (restart uvicorn after the first build). Ports 8000 and 5173 are avoided
because they're often taken by OrbStack/Docker.

### Sign-in (local accounts in SQLite)

Accounts and sessions are stored in `data/auth.sqlite`, separate from `erp.sqlite`, so regenerating
the dataset keeps them. Nothing external is needed.

```bash
uv run python -m erp_api.users create --email you@company.com --name "Your Name"   # prints a generated password
uv run python -m erp_api.users create --email boss@company.com --admin --password 'Choose-A-Good-One'
uv run python -m erp_api.users list
uv run python -m erp_api.users set-password --email you@company.com   # also signs that user out everywhere
uv run python -m erp_api.users disable --email you@company.com
```

- **Passwords:** hashed with scrypt (Python standard library, random salt per user). Minimum length is 8.
- **Sessions:** a random token in an `HttpOnly`, `SameSite=Lax` cookie, valid for 7 days. The database
  stores only a SHA-256 hash of the token. Signing out deletes the session on the server.
  Set `ERP_COOKIE_SECURE=1` when serving over HTTPS.
- **Brute-force protection:** 5 failed sign-ins per email and IP within 15 minutes → `429`.
- **API:** every `/api/*` route needs a session except `/api/health`, `/api/auth/login` and
  `/api/auth/logout`. Set `ERP_AUTH_DISABLED=1` to turn auth off for local experiments.
- **No self sign-up or password-reset email** (there is no mail service); admins create accounts with the CLI above.

The app treats the dataset's last posting date (**31 Oct 2026**) as "today", so ageing, YTD and DSO
figures are meaningful. The API is **read-only** for now, and every data endpoint requires sign-in.

| Page | What it shows |
|---|---|
| Dashboard | YTD KPIs, monthly revenue / gross margin, AR ageing, revenue by segment and category, top customers |
| Sales Orders | Filterable list → detail with document flow (order → delivery → invoice → payment), lines, GL postings |
| Customers | List with YTD revenue / open AR → detail with payment behaviour, credit utilisation, open invoices |
| Receivables | Ageing buckets (click to filter) and open invoices by days overdue |
| Inventory | Stock by item × warehouse vs. reorder point → product detail with price history and stock movements |
| Purchasing | PO list → detail with receipt vs ordered, supplier invoice, payment, GL postings |
| Accounting | Trial balance, monthly income statement (THB '000), account ledger with running balance |

Stack: React 19, TypeScript, Vite, Tailwind CSS v4, React Router, TanStack Query, Recharts, Lucide icons.
Filters, sorting and paging live in the URL, so every view can be linked and survives Back.
The design follows the `ui-ux-pro-max` skill (`.claude/skills/ui-ux-pro-max`). Its "Minimalism & Swiss"
system uses navy and slate with a blue accent, and is defined as semantic tokens in `web/src/index.css`.
Light and dark modes follow the OS.

## What you get (default seed 42, 2025-01-01 → 2026-10-31)

| Area | Tables (rows ≈) |
|---|---|
| Org | `company`, `departments` (7), `employees` (61) |
| Master | `warehouses` (3), `product_categories` (7), `products` (220), `product_prices` (price/cost history), `inventory_policies` (660 item×warehouse), `customers` (400), `suppliers` (28), `chart_of_accounts` (16) |
| Order-to-cash | `sales_orders` (14k), `sales_order_lines` (58k), `deliveries`, `sales_invoices`, `customer_payments` |
| Procure-to-pay | `purchase_orders` (5.6k), `purchase_order_lines`, `goods_receipts`, `goods_receipt_lines`, `supplier_invoices`, `supplier_payments` |
| Inventory | `inventory_transactions` (65k — OPENING / RECEIPT / SHIPMENT / ADJUSTMENT, signed qty & cost) |
| GL | `journal_entries` (57k), `journal_lines` (134k) |

Headline P&L: about 170M THB revenue in 2025, about 27% gross margin, 6–11% EBIT. The full DDL is in
[`src/erp_synth/schema.sql`](src/erp_synth/schema.sql).

## Business flows simulated

```
Sales order ──(stock available at customer's warehouse)──▶ Delivery ─▶ Sales invoice ─▶ Customer payment(s)
     │  not available → backorder; cancelled after 30 days                                (behaviour-driven delay)
     ▼
Stock position (on hand + on order − backlog) < reorder point
     ──(supplier's weekly review day)──▶ Purchase order ─▶ Goods receipt (8% short-shipped) ─▶ Supplier invoice ─▶ Payment
```

Realism built in:
- **Demand:** 12% yearly growth; Thai seasonality (April Songkran dip, rainy-season slowdown, dry-season peak); half-day Saturdays; closed on Sundays and public holidays; Pareto-distributed customer volumes; new customers acquired and others churned during the period.
- **Pricing:** list price and cost both rise on 2026-01-01 (`product_prices`); segment discounts (contractor 4%, wholesale 8%) plus occasional 5% promotions; PO costs vary ±3% around standard cost.
- **Products:** some launched mid-period, some discontinued.
- **Inventory:** moving-average costing; monthly cycle-count adjustments (mostly shrinkage).
- **AR:** payment behaviour varies by customer (prompt, normal, slow, late, defaulter); some invoices are paid in 2 instalments; cash customers pay on the invoice date.
- **People:** employees are hired and terminated over time; payroll includes 5% employer social security, capped at 750 THB.

## GL posting rules

| Event | Debit | Credit |
|---|---|---|
| Opening balances | 1000 Cash, 1200 Inventory | 3000 Share Capital, 3100 Retained Earnings |
| Delivery (COGS) | 5000 COGS | 1200 Inventory |
| Sales invoice | 1100 AR | 4000 Revenue, 2100 Output VAT |
| Customer payment | 1000 Cash | 1100 AR |
| Goods receipt | 1200 Inventory | 2150 GRNI |
| Supplier invoice | 2150 GRNI, 1150 Input VAT | 2000 AP |
| Supplier payment | 2000 AP | 1000 Cash |
| Cycle count | 5100 Shrinkage / 1200 | 1200 / 5100 |
| Payroll, rent, utilities (month end) | 6000/6010/6100/6200 | 1000 Cash |
| VAT return PP.30 (15th of next month) | 2100 Output VAT | 1150 Input VAT, 1000 Cash (net) |

`journal_entries.source_type` + `source_id` link each entry back to its source document.

## Integrity checks (run on every generate)

These checks run on every `generate`: foreign keys; every journal entry balances; the trial balance nets to
zero; order and PO headers equal the sum of their lines; each invoiced order has exactly one delivery and one
invoice; document dates are in sequence; no invoice is overpaid; stock is never negative; and the inventory,
AR and AP sub-ledgers each equal their GL control account.

## Ground truth (not part of the ERP)

`data/ground_truth/` (generated, not committed) holds the hidden drivers of the simulation, as labels for analytics and ML work:
- `customer_behaviour.csv`: volume weight, payment behaviour, default start date, churn date
- `product_demand.csv`: popularity and quantity factor

Use them to test credit-risk, churn or demand-forecast models against the true answer.

## Known simplifications

- One delivery and one invoice per order (no partial shipments).
- One goods receipt and one supplier invoice per PO (short receipts close the PO).
- No opening AR/AP, fixed assets or tax withholding.
- No credit-limit enforcement or returns/credit notes.
- All amounts are in THB.

## Layout

```
src/erp_synth/
  config.py      # all tunable knobs (dates, sizes, demand, finance)
  reference.py   # static reference data: provinces, names, catalog, CoA, seasonality, holidays
  master.py      # master-data generation + inventory policies
  simulate.py    # day-by-day simulation engine + GL postings
  schema.sql     # SQLite DDL (source of truth for columns)
  export.py      # SQLite + CSV writers
  validate.py    # integrity checks + summary metrics
src/erp_api/app.py   # read-only FastAPI JSON API (+ serves web/dist when built)
src/erp_api/auth.py  # local auth: scrypt passwords, cookie sessions (data/auth.sqlite)
src/erp_api/users.py # account admin CLI
web/                 # React frontend (pages/, components/, lib/)
.claude/skills/ui-ux-pro-max/  # UI/UX design-intelligence skill (MIT, nextlevelbuilder)
tests/               # smoke tests
```

## Credits

- Built with [Claude Code](https://claude.com/claude-code).
- UI guidance: [ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) (MIT), vendored in `.claude/skills/`.

All company and person names are fictional.
