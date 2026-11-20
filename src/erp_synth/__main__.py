"""CLI: python -m erp_synth [generate|validate] ..."""
import argparse
import random
import sqlite3
import sys
import time
from dataclasses import replace
from datetime import date
from pathlib import Path

from .config import Config
from .export import write_csv, write_rows_csv, write_sqlite
from .master import generate_master
from .simulate import Simulator
from .validate import print_summary, run_checks


def generate(cfg: Config, out: Path) -> bool:
    t0 = time.time()
    rng = random.Random(cfg.seed)
    master, hidden = generate_master(cfg, rng)
    tables = {**master, **Simulator(cfg, rng, master, hidden).run()}
    out.mkdir(parents=True, exist_ok=True)
    con = write_sqlite(tables, out / "erp.sqlite")
    write_csv(con, out / "csv")
    write_rows_csv([{"customer_id": k, **v} for k, v in hidden["customers"].items()], out / "ground_truth" / "customer_behaviour.csv")
    write_rows_csv([{"product_id": k, **v} for k, v in hidden["products"].items()], out / "ground_truth" / "product_demand.csv")
    write_rows_csv([{"supplier_id": k, "profile": v["profile"], "on_time_prob": v["on_time"],
                     "late_days_min": v["late_days"][0], "late_days_max": v["late_days"][1], "short_ship_prob": v["short"],
                     "reject_prob": v["reject"], "price_error_prob": v["price_err"], "qty_error_prob": v["qty_err"]}
                    for k, v in hidden["suppliers"].items()], out / "ground_truth" / "supplier_reliability.csv")
    print(f"Generated {cfg.start} → {cfg.end} (seed={cfg.seed}) into {out}/ in {time.time() - t0:.1f}s")
    print_summary(con)
    ok = run_checks(con)
    con.close()
    return ok


def main(argv=None):
    ap = argparse.ArgumentParser(prog="erp_synth", description="A-ERP synthetic dataset generator")
    sub = ap.add_subparsers(dest="cmd")
    g = sub.add_parser("generate", help="generate the dataset (default)")
    g.add_argument("--out", type=Path, default=Path("data"))
    g.add_argument("--seed", type=int, default=Config.seed)
    g.add_argument("--start", type=date.fromisoformat, default=Config.start)
    g.add_argument("--end", type=date.fromisoformat, default=Config.end)
    g.add_argument("--customers", type=int, default=Config.n_customers)
    g.add_argument("--orders-per-day", type=float, default=Config.base_orders_per_day)
    v = sub.add_parser("validate", help="re-run integrity checks on an existing database")
    v.add_argument("--db", type=Path, default=Path("data/erp.sqlite"))
    args = ap.parse_args(argv)

    if args.cmd == "validate":
        con = sqlite3.connect(args.db)
        print_summary(con)
        sys.exit(0 if run_checks(con) else 1)

    if args.cmd is None:
        args = g.parse_args([])
    cfg = replace(Config(), seed=args.seed, start=args.start, end=args.end,
                  n_customers=args.customers, base_orders_per_day=args.orders_per_day)
    sys.exit(0 if generate(cfg, args.out) else 1)


if __name__ == "__main__":
    main()
