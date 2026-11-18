"""Write tables to SQLite (with FK constraints) and CSV."""
import csv
import sqlite3
from importlib import resources
from pathlib import Path

TABLE_ORDER = [
    "company", "departments", "employees", "warehouses", "product_categories", "suppliers", "products",
    "product_prices", "inventory_policies", "customers", "chart_of_accounts",
    "sales_orders", "sales_order_lines", "deliveries", "sales_invoices", "customer_payments",
    "purchase_orders", "purchase_order_lines", "goods_receipts", "goods_receipt_lines",
    "supplier_invoices", "supplier_payments", "inventory_transactions", "journal_entries", "journal_lines",
]


def schema_sql() -> str:
    return resources.files("erp_synth").joinpath("schema.sql").read_text()


def write_sqlite(tables: dict, path: Path) -> sqlite3.Connection:
    path.unlink(missing_ok=True)
    con = sqlite3.connect(path)
    con.execute("PRAGMA foreign_keys = ON")
    con.executescript(schema_sql())
    for name in TABLE_ORDER:
        cols = [r[1] for r in con.execute(f"PRAGMA table_info({name})")]
        rows = tables[name]
        missing = set(cols) - set(rows[0]) if rows else set()
        assert not missing, f"{name}: rows missing columns {missing}"
        con.executemany(f"INSERT INTO {name} ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
                        [tuple(r[c] for c in cols) for r in rows])
    con.commit()
    return con


def write_csv(con: sqlite3.Connection, out_dir: Path):
    out_dir.mkdir(parents=True, exist_ok=True)
    for name in TABLE_ORDER:
        cur = con.execute(f"SELECT * FROM {name} ORDER BY 1")
        with open(out_dir / f"{name}.csv", "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow([c[0] for c in cur.description])
            w.writerows(cur)


def write_rows_csv(rows: list[dict], path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader()
        w.writerows(rows)
