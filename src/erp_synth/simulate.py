"""Day-by-day business simulation producing consistent transactional data + GL postings.

Flows:
  Order-to-cash : sales order -> (stock available) delivery + invoice -> customer payment(s)
  Procure-to-pay: stock position < reorder point -> PO -> goods receipt -> supplier invoice -> payment
  Record-to-report: every financial event posts a balanced journal entry; monthly payroll,
                    rent, utilities, cycle-count adjustments and VAT returns (PP.30).
"""
import math
import random
from collections import defaultdict
from datetime import date, timedelta

from . import reference as ref
from .config import Config
from .master import iso

ONE = timedelta(days=1)


def r2(x: float) -> float:
    return round(x + 1e-9, 2)


def poisson(rng: random.Random, lam: float) -> int:
    if lam <= 0:
        return 0
    limit, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= rng.random()
        if p <= limit:
            return k
        k += 1


def is_business_day(d: date) -> bool:
    return d.weekday() != 6 and (d.month, d.day) not in ref.HOLIDAYS


def next_business_day(d: date) -> date:
    while not is_business_day(d):
        d += ONE
    return d


class Simulator:
    TABLES = [
        "sales_orders", "sales_order_lines", "deliveries", "sales_invoices", "customer_payments",
        "purchase_orders", "purchase_order_lines", "goods_receipts", "goods_receipt_lines",
        "supplier_invoices", "supplier_payments", "inventory_transactions", "journal_entries", "journal_lines",
    ]

    def __init__(self, cfg: Config, rng: random.Random, master: dict, hidden: dict):
        self.cfg, self.rng, self.m, self.h = cfg, rng, master, hidden
        self.t = {name: [] for name in self.TABLES}
        self.seq = defaultdict(int)

        self.customers = master["customers"]
        self.products = {p["product_id"]: p for p in master["products"]}
        self.suppliers = {s["supplier_id"]: s for s in master["suppliers"]}
        self.policies = {(p["product_id"], p["warehouse_id"]): p for p in master["inventory_policies"]}
        self.prices = defaultdict(list)
        for pr in master["product_prices"]:
            self.prices[pr["product_id"]].append(pr)

        self.on_hand = defaultdict(int)
        self.avg_cost = defaultdict(float)
        self.on_order = defaultdict(int)
        self.backlog = defaultdict(int)  # qty demanded by open (unshipped) orders

        self.pending_orders = []            # [(so, lines)]
        self.arrivals = defaultdict(list)   # date -> [po_id]
        self.sinv_due = defaultdict(list)   # date -> [(po, gr, subtotal)]
        self.cust_pay_due = defaultdict(list)  # date -> [(invoice, amount)]
        self.supp_pay_due = defaultdict(list)  # date -> [supplier_invoice]
        self.invoice_paid = defaultdict(float)
        self.po_lines = defaultdict(list)
        self.vat_out = defaultdict(float)
        self.vat_in = defaultdict(float)

    # ---------------- helpers ----------------
    def docno(self, prefix: str, d: date) -> str:
        self.seq[(prefix, d.year)] += 1
        return f"{prefix}{d.year % 100:02d}-{self.seq[(prefix, d.year)]:06d}"

    def add(self, table: str, row: dict, id_field: str) -> dict:
        row = {id_field: len(self.t[table]) + 1, **row}
        self.t[table].append(row)
        return row

    def post(self, d: date, source_type: str, source_id, desc: str, lines):
        lines = [(a, r2(dr), r2(cr)) for a, dr, cr in lines if r2(dr) or r2(cr)]
        dr, cr = sum(l[1] for l in lines), sum(l[2] for l in lines)
        assert abs(dr - cr) < 0.005, f"Unbalanced JE {source_type} {source_id}: {dr} vs {cr}"
        je = self.add("journal_entries", {"entry_number": self.docno("JV", d), "entry_date": iso(d),
                                          "source_type": source_type, "source_id": source_id, "description": desc},
                      "journal_entry_id")
        for i, (acct, dr, cr) in enumerate(lines, 1):
            self.add("journal_lines", {"journal_entry_id": je["journal_entry_id"], "line_no": i,
                                       "account_code": acct, "debit": dr, "credit": cr}, "journal_line_id")

    def price_row(self, pid: int, d: date) -> dict:
        ds = iso(d)
        for pr in self.prices[pid]:
            if pr["valid_from"] <= ds and (pr["valid_to"] is None or ds <= pr["valid_to"]):
                return pr
        return self.prices[pid][-1]

    def inv_txn(self, d, pid, wid, ttype, qty, unit_cost, ref_type, ref_id):
        total = r2(qty * unit_cost)
        self.add("inventory_transactions", {
            "txn_date": iso(d), "product_id": pid, "warehouse_id": wid, "txn_type": ttype, "quantity": qty,
            "unit_cost": r2(unit_cost), "total_cost": total, "reference_type": ref_type, "reference_id": ref_id,
        }, "inventory_txn_id")
        return total

    def receive_stock(self, key, qty, cost):
        oh = self.on_hand[key]
        self.avg_cost[key] = (oh * self.avg_cost[key] + qty * cost) / (oh + qty) if oh + qty else cost
        self.on_hand[key] = oh + qty

    def growth(self, d: date) -> float:
        return (1 + self.cfg.annual_growth) ** ((d - self.cfg.start).days / 365.25)

    # ---------------- main loop ----------------
    def run(self):
        cfg = self.cfg
        self.opening()
        d = cfg.start
        while d <= cfg.end:
            if d.day == 1 or d == cfg.start:
                self.refresh_active(d)
            self.process_receipts(d)
            self.process_supplier_invoices(d)
            if is_business_day(d):
                self.create_sales_orders(d)
                self.fulfil_orders(d)
                self.replenish(d)
            self.process_customer_payments(d)
            self.process_supplier_payments(d)
            if d.day == 15:
                self.settle_vat(d)
            if (d + ONE).month != d.month:
                self.month_end(d)
            d += ONE
        self.finalize()
        return self.t

    def opening(self):
        d = self.cfg.start - ONE
        value = 0.0
        for (pid, wid), pol in self.policies.items():
            p = self.products[pid]
            if p["created_date"] >= iso(self.cfg.start):
                continue
            qty = pol["reorder_point"] + pol["reorder_qty"] // 2
            cost = self.price_row(pid, d)["standard_cost"]
            self.receive_stock((pid, wid), qty, cost)
            value += self.inv_txn(d, pid, wid, "OPENING", qty, cost, "OPENING", None)
        cash, capital = self.cfg.opening_cash, self.cfg.share_capital
        re_bal = r2(cash + value - capital)
        lines = [("1000", cash, 0), ("1200", value, 0), ("3000", 0, capital)]
        lines.append(("3100", 0, re_bal) if re_bal >= 0 else ("3100", -re_bal, 0))
        self.post(d, "OPENING", None, "Opening balances", lines)

    def refresh_active(self, d: date):
        ds = iso(d)
        hc = self.h["customers"]
        self.cust_active = [c for c in self.customers
                            if c["created_date"] <= ds and (hc[c["customer_id"]]["churn_date"] or "9999") > ds]
        self.cust_w = [hc[c["customer_id"]]["volume_weight"] for c in self.cust_active]
        self.prod_active = [p for p in self.products.values()
                            if p["created_date"] <= ds and (p["discontinued_date"] or "9999") > ds]
        self.prod_w = [self.h["products"][p["product_id"]]["popularity"] for p in self.prod_active]

    # ---------------- order-to-cash ----------------
    def create_sales_orders(self, d: date):
        rng, cfg = self.rng, self.cfg
        lam = cfg.base_orders_per_day * self.growth(d) * ref.MONTH_SEASONALITY[d.month] * ref.WEEKDAY_FACTOR[d.weekday()]
        for _ in range(poisson(rng, lam)):
            c = rng.choices(self.cust_active, weights=self.cust_w)[0]
            sc = ref.SEGMENTS[c["segment"]]
            k = rng.randint(*sc["lines"])
            picks, seen = [], set()
            for p in rng.choices(self.prod_active, weights=self.prod_w, k=k * 3):
                if p["product_id"] not in seen:
                    seen.add(p["product_id"])
                    picks.append(p)
                    if len(picks) == k:
                        break
            lines = []
            for i, p in enumerate(picks, 1):
                pid = p["product_id"]
                qty = max(1, round(rng.randint(*sc["qty"]) * self.h["products"][pid]["qty_factor"]))
                if qty >= 20:
                    qty = int(math.ceil(qty / 5) * 5)
                price = self.price_row(pid, d)["list_price"]
                disc = sc["disc"] + (5.0 if rng.random() < 0.08 else 0.0)
                lines.append({"line_no": i, "product_id": pid, "quantity": qty, "unit_price": price,
                              "discount_pct": disc, "line_amount": r2(qty * price * (1 - disc / 100))})
            subtotal = r2(sum(l["line_amount"] for l in lines))
            vat = r2(subtotal * cfg.vat_rate)
            so = self.add("sales_orders", {
                "order_number": self.docno("SO", d), "customer_id": c["customer_id"], "sales_rep_id": c["sales_rep_id"],
                "warehouse_id": c["default_warehouse_id"], "order_date": iso(d),
                "requested_date": iso(next_business_day(d + timedelta(days=rng.randint(1, 5)))),
                "status": "OPEN", "cancelled_date": None, "cancel_reason": None,
                "subtotal": subtotal, "vat_amount": vat, "total_amount": r2(subtotal + vat), "currency": cfg.currency,
            }, "sales_order_id")
            for l in lines:
                l["sales_order_id"] = so["sales_order_id"]
                self.add("sales_order_lines", l, "sales_order_line_id")
            if rng.random() < cfg.cancel_rate:
                so.update(status="CANCELLED", cancelled_date=iso(d), cancel_reason="Customer request")
            else:
                self.pending_orders.append((so, lines, d))
                for l in lines:
                    self.backlog[(l["product_id"], so["warehouse_id"])] += l["quantity"]

    def fulfil_orders(self, d: date):
        still = []
        for so, lines, od in self.pending_orders:
            age = (d - od).days
            wid = so["warehouse_id"]
            if age < 1:
                still.append((so, lines, od))
            elif all(self.on_hand[(l["product_id"], wid)] >= l["quantity"] for l in lines):
                self.ship(d, so, lines)
            elif age > self.cfg.backorder_cancel_days:
                so.update(status="CANCELLED", cancelled_date=iso(d), cancel_reason="Backorder expired (out of stock)")
                for l in lines:
                    self.backlog[(l["product_id"], wid)] -= l["quantity"]
            else:
                still.append((so, lines, od))
        self.pending_orders = still

    def ship(self, d: date, so: dict, lines: list):
        rng, wid = self.rng, so["warehouse_id"]
        dl = self.add("deliveries", {"delivery_number": self.docno("DO", d), "sales_order_id": so["sales_order_id"],
                                     "warehouse_id": wid, "ship_date": iso(d)}, "delivery_id")
        cogs = 0.0
        for l in lines:
            key = (l["product_id"], wid)
            self.on_hand[key] -= l["quantity"]
            self.backlog[key] -= l["quantity"]
            cogs += -self.inv_txn(d, l["product_id"], wid, "SHIPMENT", -l["quantity"], self.avg_cost[key],
                                  "DELIVERY", dl["delivery_id"])
        self.post(d, "DELIVERY", dl["delivery_id"], f"COGS {dl['delivery_number']}", [("5000", cogs, 0), ("1200", 0, cogs)])

        cust = self.customers[so["customer_id"] - 1]
        terms = cust["payment_terms_days"]
        inv = self.add("sales_invoices", {
            "invoice_number": self.docno("IV", d), "sales_order_id": so["sales_order_id"], "delivery_id": dl["delivery_id"],
            "customer_id": so["customer_id"], "invoice_date": iso(d), "due_date": iso(d + timedelta(days=terms)),
            "subtotal": so["subtotal"], "vat_amount": so["vat_amount"], "total_amount": so["total_amount"], "status": "OPEN",
        }, "invoice_id")
        so["status"] = "INVOICED"
        self.vat_out[(d.year, d.month)] += inv["vat_amount"]
        self.post(d, "SALES_INVOICE", inv["invoice_id"], f"Sales invoice {inv['invoice_number']}",
                  [("1100", inv["total_amount"], 0), ("4000", 0, inv["subtotal"]), ("2100", 0, inv["vat_amount"])])
        self.schedule_customer_payment(d, inv, cust, terms)

    def schedule_customer_payment(self, d, inv, cust, terms):
        rng = self.rng
        hc = self.h["customers"][cust["customer_id"]]
        beh = hc["payment_behaviour"]
        if beh == "defaulter" and iso(d) >= hc["default_from"]:
            return  # never paid
        if terms == 0:
            pay = d
        else:
            lo, hi = next(b[2] for b in ref.PAYMENT_BEHAVIOURS if b[0] == beh)
            pay = max(d, d + timedelta(days=terms + rng.randint(lo, hi)))
        pay = next_business_day(pay)
        total = inv["total_amount"]
        if terms > 0 and rng.random() < 0.06:  # paid in two instalments
            first = r2(total * rng.uniform(0.4, 0.8))
            self.cust_pay_due[pay].append((inv, first))
            self.cust_pay_due[next_business_day(pay + timedelta(days=rng.randint(14, 45)))].append((inv, r2(total - first)))
        else:
            self.cust_pay_due[pay].append((inv, total))

    def process_customer_payments(self, d: date):
        for inv, amount in self.cust_pay_due.pop(d, []):
            cust = self.customers[inv["customer_id"] - 1]
            method = ("CASH" if self.rng.random() < 0.5 else "TRANSFER") if cust["payment_terms_days"] == 0 else \
                self.rng.choices(["TRANSFER", "CHEQUE"], weights=[70, 30])[0]
            pay = self.add("customer_payments", {"payment_number": self.docno("RC", d), "invoice_id": inv["invoice_id"],
                                                 "customer_id": inv["customer_id"], "payment_date": iso(d),
                                                 "amount": amount, "method": method}, "payment_id")
            self.invoice_paid[inv["invoice_id"]] += amount
            self.post(d, "CUSTOMER_PAYMENT", pay["payment_id"], f"Receipt {pay['payment_number']} for {inv['invoice_number']}",
                      [("1000", amount, 0), ("1100", 0, amount)])

    # ---------------- procure-to-pay ----------------
    def replenish(self, d: date):
        rng, ds = self.rng, iso(d)
        groups = defaultdict(list)
        for key, pol in self.policies.items():
            p = self.products[key[0]]
            if p["created_date"] > ds or (p["discontinued_date"] and p["discontinued_date"] <= ds):
                continue
            if self.suppliers[p["primary_supplier_id"]]["order_weekday"] != d.weekday() and \
                    self.on_hand[key] - self.backlog[key] > 0:
                continue  # wait for the supplier's weekly review day unless we're already stocked out
            position = self.on_hand[key] + self.on_order[key] - self.backlog[key]
            if position < pol["reorder_point"]:
                qty = pol["reorder_qty"] + (pol["reorder_point"] - position)
                qty = int(math.ceil(qty / 10) * 10) if qty >= 50 else int(math.ceil(qty / 5) * 5) if qty >= 10 else qty
                groups[(p["primary_supplier_id"], key[1])].append((key[0], qty))
        for (sid, wid), items in sorted(groups.items()):
            sup = self.suppliers[sid]
            expected = next_business_day(d + timedelta(days=sup["lead_time_days"]))
            arrival = next_business_day(d + timedelta(days=max(1, sup["lead_time_days"] + rng.randint(-2, 6))))
            lines = []
            for i, (pid, qty) in enumerate(items, 1):
                cost = r2(self.price_row(pid, d)["standard_cost"] * rng.uniform(0.97, 1.03))
                lines.append({"line_no": i, "product_id": pid, "quantity": qty, "unit_cost": cost,
                              "line_amount": r2(qty * cost), "received_quantity": 0})
                self.on_order[(pid, wid)] += qty
            subtotal = r2(sum(l["line_amount"] for l in lines))
            vat = r2(subtotal * self.cfg.vat_rate)
            po = self.add("purchase_orders", {
                "po_number": self.docno("PO", d), "supplier_id": sid, "buyer_id": rng.choice(self.h["buyers"]),
                "warehouse_id": wid, "order_date": iso(d), "expected_date": iso(expected), "status": "OPEN",
                "subtotal": subtotal, "vat_amount": vat, "total_amount": r2(subtotal + vat),
            }, "purchase_order_id")
            for l in lines:
                l["purchase_order_id"] = po["purchase_order_id"]
                self.po_lines[po["purchase_order_id"]].append(self.add("purchase_order_lines", l, "po_line_id"))
            self.arrivals[arrival].append(po)

    def process_receipts(self, d: date):
        rng = self.rng
        for po in self.arrivals.pop(d, []):
            wid = po["warehouse_id"]
            lines = self.po_lines[po["purchase_order_id"]]
            short_line = rng.randrange(len(lines)) if rng.random() < 0.08 else None
            gr = self.add("goods_receipts", {"gr_number": self.docno("GR", d), "purchase_order_id": po["purchase_order_id"],
                                             "warehouse_id": wid, "receipt_date": iso(d),
                                             "received_by": rng.choice(self.h["warehouse_staff"])}, "goods_receipt_id")
            value = 0.0
            for i, l in enumerate(lines):
                rec = l["quantity"] if i != short_line else max(1, int(l["quantity"] * rng.uniform(0.6, 0.95)))
                l["received_quantity"] = rec
                key = (l["product_id"], wid)
                self.on_order[key] -= l["quantity"]
                self.receive_stock(key, rec, l["unit_cost"])
                self.add("goods_receipt_lines", {"goods_receipt_id": gr["goods_receipt_id"], "po_line_id": l["po_line_id"],
                                                 "product_id": l["product_id"], "quantity_received": rec,
                                                 "unit_cost": l["unit_cost"]}, "gr_line_id")
                value += self.inv_txn(d, l["product_id"], wid, "RECEIPT", rec, l["unit_cost"], "GOODS_RECEIPT", gr["goods_receipt_id"])
            po["status"] = "CLOSED_SHORT" if short_line is not None else "RECEIVED"
            value = r2(value)
            self.post(d, "GOODS_RECEIPT", gr["goods_receipt_id"], f"GR {gr['gr_number']} / {po['po_number']}",
                      [("1200", value, 0), ("2150", 0, value)])
            self.sinv_due[next_business_day(d + timedelta(days=rng.randint(0, 5)))].append((po, gr, value))

    def process_supplier_invoices(self, d: date):
        rng = self.rng
        for po, gr, subtotal in self.sinv_due.pop(d, []):
            sup = self.suppliers[po["supplier_id"]]
            vat = r2(subtotal * self.cfg.vat_rate)
            total = r2(subtotal + vat)
            due = d + timedelta(days=sup["payment_terms_days"])
            si = self.add("supplier_invoices", {
                "document_number": self.docno("AP", d), "supplier_invoice_ref": f"INV{d:%y%m}{rng.randint(1000, 99999)}",
                "supplier_id": sup["supplier_id"], "purchase_order_id": po["purchase_order_id"],
                "goods_receipt_id": gr["goods_receipt_id"], "invoice_date": iso(d), "due_date": iso(due),
                "subtotal": subtotal, "vat_amount": vat, "total_amount": total, "status": "OPEN",
            }, "supplier_invoice_id")
            self.vat_in[(d.year, d.month)] += vat
            self.post(d, "SUPPLIER_INVOICE", si["supplier_invoice_id"], f"AP {si['document_number']} {sup['name']}",
                      [("2150", subtotal, 0), ("1150", vat, 0), ("2000", 0, total)])
            self.supp_pay_due[next_business_day(max(d, due + timedelta(days=rng.randint(-3, 5))))].append(si)

    def process_supplier_payments(self, d: date):
        for si in self.supp_pay_due.pop(d, []):
            pay = self.add("supplier_payments", {
                "payment_number": self.docno("PV", d), "supplier_invoice_id": si["supplier_invoice_id"],
                "supplier_id": si["supplier_id"], "payment_date": iso(d), "amount": si["total_amount"],
                "method": self.rng.choices(["TRANSFER", "CHEQUE"], weights=[85, 15])[0],
            }, "supplier_payment_id")
            si["status"] = "PAID"
            self.post(d, "SUPPLIER_PAYMENT", pay["supplier_payment_id"], f"Payment {pay['payment_number']} for {si['document_number']}",
                      [("2000", si["total_amount"], 0), ("1000", 0, si["total_amount"])])

    # ---------------- record-to-report ----------------
    def settle_vat(self, d: date):
        prev = (d.replace(day=1) - ONE)
        key = (prev.year, prev.month)
        out, inp = r2(self.vat_out.pop(key, 0.0)), r2(self.vat_in.pop(key, 0.0))
        if not out and not inp:
            return
        net = r2(out - inp)
        lines = [("2100", out, 0), ("1150", 0, inp)]
        lines.append(("1000", 0, net) if net >= 0 else ("1000", -net, 0))
        self.post(next_business_day(d), "VAT_RETURN", None, f"PP.30 VAT return {prev:%Y-%m}", lines)

    def month_end(self, d: date):
        rng = self.rng
        # Cycle count: random small shrinkage (or found stock) on ~4% of item-locations
        for key in rng.sample(sorted(self.policies), k=max(1, len(self.policies) // 25)):
            oh = self.on_hand[key]
            if oh <= 0:
                continue
            delta = -rng.randint(1, max(1, min(5, oh // 10 or 1))) if rng.random() < 0.85 else rng.randint(1, 2)
            if oh + delta < 0:
                continue
            self.on_hand[key] += delta
            val = self.inv_txn(d, key[0], key[1], "ADJUSTMENT", delta, self.avg_cost[key], "CYCLE_COUNT", None)
            self.post(d, "INVENTORY_ADJ", None, f"Cycle count adjustment {self.products[key[0]]['sku']} WH{key[1]}",
                      [("5100", -val, 0), ("1200", 0, -val)] if val < 0 else [("1200", val, 0), ("5100", 0, val)])

        pay_day = d
        while not is_business_day(pay_day):
            pay_day -= ONE
        ms, me = iso(d.replace(day=1)), iso(d)
        active = [e for e in self.m["employees"]
                  if e["hire_date"] <= me and (e["termination_date"] is None or e["termination_date"] >= ms)]
        salaries = r2(sum(e["monthly_salary"] for e in active))
        sso = r2(sum(min(e["monthly_salary"], 15_000) * 0.05 for e in active))
        self.post(pay_day, "PAYROLL", None, f"Payroll {d:%Y-%m} ({len(active)} employees)",
                  [("6000", salaries, 0), ("6010", sso, 0), ("1000", 0, salaries + sso)])
        rent = r2(self.cfg.monthly_rent * (1.05 if d.year > self.cfg.start.year else 1.0))
        self.post(pay_day, "EXPENSE", None, f"Warehouse & office rent {d:%Y-%m}", [("6100", rent, 0), ("1000", 0, rent)])
        util = r2(rng.uniform(140_000, 210_000) * (1.15 if d.month in (3, 4, 5) else 1.0))
        self.post(pay_day, "EXPENSE", None, f"Electricity & water {d:%Y-%m}", [("6200", util, 0), ("1000", 0, util)])

    def finalize(self):
        for inv in self.t["sales_invoices"]:
            paid = self.invoice_paid.get(inv["invoice_id"], 0.0)
            inv["status"] = "PAID" if paid >= inv["total_amount"] - 0.005 else "PARTIALLY_PAID" if paid > 0 else "OPEN"
