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
        "purchase_requisitions", "purchase_requisition_lines", "rfqs", "rfq_quotes",
        "purchase_orders", "purchase_order_lines", "goods_receipts", "goods_receipt_lines",
        "supplier_invoices", "supplier_invoice_lines", "supplier_payments",
        "inventory_transactions", "journal_entries", "journal_lines",
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
        self.si_due = defaultdict(list)     # date -> [(po, gr, gr_lines)] supplier invoice arrivals
        self.req_due = defaultdict(list)    # date -> [(requisition, lines)] approval decisions
        self.hold_due = defaultdict(list)   # date -> [(supplier_invoice, po, lines)] hold resolutions
        self.rfq_due = defaultdict(list)    # date -> [(action, rfq)]
        self.on_req = defaultdict(int)      # qty on requisitions awaiting approval
        self.sup_stats = defaultdict(lambda: [0, 0])  # supplier -> [first deliveries, on time]
        self.prng = random.Random(cfg.seed * 7919 + 2)  # procurement-only randomness
        self.sp = {(r["supplier_id"], r["product_id"]): r for r in master["supplier_products"]}
        self.sp_by_product = defaultdict(list)
        for r in master["supplier_products"]:
            self.sp_by_product[r["product_id"]].append(r)
        self.cat_suppliers = defaultdict(set)
        for r in master["supplier_products"]:
            self.cat_suppliers[self.products[r["product_id"]]["category_id"]].add(r["supplier_id"])
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
            self.resolve_holds(d)
            self.process_requisitions(d)
            self.process_rfqs(d)
            if is_business_day(d):
                self.create_sales_orders(d)
                self.fulfil_orders(d)
                self.replenish(d)
                if self.prng.random() < 0.5:
                    self.launch_rfq(d)
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
    # Flow: stock position < reorder point → requisition → approval (by amount) → PO → delivery (1–2 shipments,
    # timing/shortages/rejections driven by the supplier's hidden reliability profile) → supplier invoice →
    # three-way match (PO price × accepted qty vs billed) → auto-approve or hold & resolve → payment.
    # All procurement randomness uses self.prng so customer demand stays identical across procurement changes.

    def sp_cost(self, sid: int, pid: int, d: date) -> float:
        return r2(self.sp[(sid, pid)]["cost_factor"] * self.price_row(pid, d)["standard_cost"])

    def replenish(self, d: date):
        rng, ds = self.prng, iso(d)
        groups = defaultdict(list)
        for key, pol in self.policies.items():
            pid, wid = key
            p = self.products[pid]
            if p["created_date"] > ds or (p["discontinued_date"] and p["discontinued_date"] <= ds):
                continue
            preferred = p["primary_supplier_id"]
            review_day = self.suppliers[preferred]["order_weekday"] == d.weekday()
            position = self.on_hand[key] + self.on_order[key] + self.on_req[key] - self.backlog[key]
            nothing_coming = self.on_order[key] == 0 and self.on_req[key] == 0
            if not review_day and not (position < 0 and nothing_coming):
                continue  # wait for the weekly review day unless out of stock with nothing on the way
            if position >= pol["reorder_point"] * (ref.CONSOLIDATION_FACTOR if review_day else 1):
                continue
            source, sid = "AUTO_REORDER", preferred
            if not review_day:  # emergency buy: fastest supplier on the price list
                source = "EMERGENCY"
                sid = min(self.sp_by_product[pid], key=lambda r: (r["lead_time_days"], -r["is_preferred"]))["supplier_id"]
            qty = pol["reorder_qty"] + max(0, pol["reorder_point"] - position)
            moq = self.sp[(sid, pid)]["min_order_qty"]
            qty = max(moq, int(math.ceil(qty / moq) * moq))
            groups[(sid, wid, source)].append((pid, qty, position < pol["reorder_point"]))

        for (sid, wid, source), items in sorted(groups.items()):
            if not any(due for _, _, due in items):
                continue  # only top-ups, nothing actually below reorder point: no PO this week
            lines = [{"line_no": i, "product_id": pid, "quantity": qty, "estimated_unit_cost": self.sp_cost(sid, pid, d)}
                     for i, (pid, qty, _) in enumerate(items, 1)]
            est = r2(sum(l["quantity"] * l["estimated_unit_cost"] for l in lines))
            limit, level, approver_key, (dmin, dmax), _ = next(m for m in ref.APPROVAL_MATRIX if est < m[0])
            decide = d if source == "EMERGENCY" or level == "AUTO" else next_business_day(d + timedelta(days=rng.randint(dmin, dmax)))
            req = self.add("purchase_requisitions", {
                "requisition_number": self.docno("PR", d), "source": source,
                "requested_by": rng.choice(self.h["inventory_controllers"]), "warehouse_id": wid, "supplier_id": sid,
                "request_date": ds, "estimated_amount": est, "approval_level": level, "status": "PENDING_APPROVAL",
                "approver_id": None if approver_key is None else self.h["md" if approver_key == "MD" else "pur_head"],
                "decision_date": None, "rejection_reason": None,
            }, "requisition_id")
            for l in lines:
                self.add("purchase_requisition_lines", {"requisition_id": req["requisition_id"], **l}, "requisition_line_id")
                self.on_req[(l["product_id"], wid)] += l["quantity"]
            if decide == d:
                self.decide_requisition(d, req, lines)
            else:
                self.req_due[decide].append((req, lines))

    def process_requisitions(self, d: date):
        for req, lines in self.req_due.pop(d, []):
            self.decide_requisition(d, req, lines)

    def decide_requisition(self, d: date, req: dict, lines: list):
        rng, wid = self.prng, req["warehouse_id"]
        for l in lines:
            self.on_req[(l["product_id"], wid)] -= l["quantity"]
        reject_p = next(m[4] for m in ref.APPROVAL_MATRIX if m[1] == req["approval_level"])
        req["decision_date"] = iso(d)
        if req["source"] != "EMERGENCY" and rng.random() < reject_p:
            req.update(status="REJECTED", rejection_reason=rng.choice(ref.REJECT_REASONS))
            return
        req["status"] = "CONVERTED"
        sid = req["supplier_id"]
        po_lines = [{"line_no": l["line_no"], "product_id": l["product_id"], "quantity": l["quantity"],
                     "unit_cost": self.sp_cost(sid, l["product_id"], d), "received_quantity": 0} for l in lines]
        for l in po_lines:
            l["line_amount"] = r2(l["quantity"] * l["unit_cost"])
            self.on_order[(l["product_id"], wid)] += l["quantity"]
        lead = max(self.sp[(sid, l["product_id"])]["lead_time_days"] for l in lines)
        expected = next_business_day(d + timedelta(days=lead))
        subtotal = r2(sum(l["line_amount"] for l in po_lines))
        vat = r2(subtotal * self.cfg.vat_rate)
        po = self.add("purchase_orders", {
            "po_number": self.docno("PO", d), "supplier_id": sid, "requisition_id": req["requisition_id"],
            "buyer_id": rng.choice(self.h["buyers"]), "warehouse_id": wid, "order_date": iso(d),
            "expected_date": iso(expected), "status": "OPEN",
            "subtotal": subtotal, "vat_amount": vat, "total_amount": r2(subtotal + vat),
        }, "purchase_order_id")
        for l in po_lines:
            l["purchase_order_id"] = po["purchase_order_id"]
            row = self.add("purchase_order_lines", l, "po_line_id")
            row["_delivered"] = 0
            self.po_lines[po["purchase_order_id"]].append(row)
        self.plan_deliveries(d, po, expected)

    def plan_deliveries(self, d: date, po: dict, expected: date):
        rng = self.prng
        prof = self.h["suppliers"][po["supplier_id"]]
        lines = self.po_lines[po["purchase_order_id"]]
        delay = -rng.randint(0, 2) if rng.random() < prof["on_time"] else rng.randint(*prof["late_days"])
        first = next_business_day(max(d + ONE, expected + timedelta(days=delay)))
        shipped = {l["po_line_id"]: l["quantity"] for l in lines}
        if rng.random() < prof["short"]:
            l = rng.choice(lines)
            shipped[l["po_line_id"]] = max(1, int(l["quantity"] * rng.uniform(0.5, 0.95)))
        split = rng.random() < 0.12 and (len(lines) > 1 or max(shipped.values()) >= 10)
        if split:
            part1 = {k: int(q * rng.uniform(0.4, 0.75)) for k, q in shipped.items()}
            if not any(part1.values()):
                k = max(shipped, key=shipped.get)
                part1[k] = max(1, shipped[k] // 2)
            part2 = {k: shipped[k] - part1[k] for k in shipped}
            self.arrivals[first].append((po, {k: q for k, q in part1.items() if q}, 1, False))
            self.arrivals[next_business_day(first + timedelta(days=rng.randint(3, 10)))].append((po, {k: q for k, q in part2.items() if q}, 2, True))
        else:
            self.arrivals[first].append((po, shipped, 1, True))

    def process_receipts(self, d: date):
        rng = self.prng
        for po, shipment, delivery_no, final in self.arrivals.pop(d, []):
            wid, sid = po["warehouse_id"], po["supplier_id"]
            prof = self.h["suppliers"][sid]
            gr = self.add("goods_receipts", {"gr_number": self.docno("GR", d), "purchase_order_id": po["purchase_order_id"],
                                             "delivery_no": delivery_no, "warehouse_id": wid, "receipt_date": iso(d),
                                             "received_by": rng.choice(self.h["warehouse_staff"])}, "goods_receipt_id")
            if delivery_no == 1:
                stats = self.sup_stats[sid]
                stats[0] += 1
                stats[1] += iso(d) <= po["expected_date"]
            value, gr_lines = 0.0, []
            for l in self.po_lines[po["purchase_order_id"]]:
                q = shipment.get(l["po_line_id"], 0)
                if not q:
                    continue
                rej = min(q, max(1, int(q * rng.uniform(0.05, 0.25)))) if rng.random() < prof["reject"] else 0
                acc = q - rej
                key = (l["product_id"], wid)
                self.on_order[key] -= q
                l["_delivered"] += q
                l["received_quantity"] += acc
                if acc:
                    self.receive_stock(key, acc, l["unit_cost"])
                    value += self.inv_txn(d, l["product_id"], wid, "RECEIPT", acc, l["unit_cost"], "GOODS_RECEIPT", gr["goods_receipt_id"])
                gr_lines.append(self.add("goods_receipt_lines", {
                    "goods_receipt_id": gr["goods_receipt_id"], "po_line_id": l["po_line_id"], "product_id": l["product_id"],
                    "quantity_received": q, "quantity_rejected": rej, "quantity_accepted": acc,
                    "rejection_reason": rng.choice(ref.GR_REJECT_REASONS) if rej else None, "unit_cost": l["unit_cost"],
                }, "gr_line_id"))
            if final:
                for l in self.po_lines[po["purchase_order_id"]]:  # nothing more is coming: release the rest of on-order
                    self.on_order[(l["product_id"], wid)] -= l["quantity"] - l["_delivered"]
                complete = all(l["received_quantity"] == l["quantity"] for l in self.po_lines[po["purchase_order_id"]])
                po["status"] = "RECEIVED" if complete else "CLOSED_SHORT"
            else:
                po["status"] = "PARTIALLY_RECEIVED"
            gr["_value"] = value = r2(value)
            if value:
                self.post(d, "GOODS_RECEIPT", gr["goods_receipt_id"], f"GR {gr['gr_number']} / {po['po_number']}",
                          [("1200", value, 0), ("2150", 0, value)])
            self.si_due[next_business_day(d + timedelta(days=rng.randint(0, 5)))].append((po, gr, gr_lines))

    def process_supplier_invoices(self, d: date):
        rng = self.prng
        for po, gr, gr_lines in self.si_due.pop(d, []):
            sup = self.suppliers[po["supplier_id"]]
            prof = self.h["suppliers"][sup["supplier_id"]]
            lines, any_qty, any_price, big_price = [], False, False, False
            for i, g in enumerate(gr_lines, 1):
                cost, acc = g["unit_cost"], g["quantity_accepted"]
                billed_q, billed_p = acc, cost
                if g["quantity_rejected"] and rng.random() < 0.6:
                    billed_q = g["quantity_received"]  # supplier bills the rejected units too
                elif acc and rng.random() < prof["qty_err"]:
                    billed_q = acc + rng.randint(1, max(1, math.ceil(acc * 0.1)))
                if rng.random() < prof["price_err"]:
                    billed_p = r2(cost * (rng.uniform(1.002, 1.009) if rng.random() < 0.4 else rng.uniform(1.015, 1.09)))
                q_diff, p_diff = billed_q != acc, billed_p != cost
                any_qty |= q_diff
                any_price |= p_diff
                big_price |= p_diff and (billed_p - cost) / cost > ref.MATCH_PRICE_TOLERANCE
                lines.append({"line_no": i, "gr_line_id": g["gr_line_id"], "po_line_id": g["po_line_id"],
                              "product_id": g["product_id"], "quantity_billed": billed_q, "unit_price_billed": billed_p,
                              "line_amount_billed": r2(billed_q * billed_p), "quantity_accepted": acc, "po_unit_cost": cost,
                              "match_result": "PRICE_AND_QUANTITY" if q_diff and p_diff else "QUANTITY" if q_diff else "PRICE" if p_diff else "OK"})
            if not lines:
                continue
            billed = r2(sum(l["line_amount_billed"] for l in lines))
            billed_vat = r2(billed * self.cfg.vat_rate)
            receipt_value = gr["_value"]
            exception = any_qty or big_price or abs(billed - receipt_value) > ref.MATCH_AMOUNT_TOLERANCE
            match = "EXCEPTION" if exception else "WITHIN_TOLERANCE" if any_price else "MATCHED"
            ex_type = None
            hold = None
            if exception:
                ex_type = "PRICE_AND_QUANTITY" if any_qty and any_price else "QUANTITY" if any_qty else "PRICE"
                parts = []
                if any_qty:
                    over = sum(l["quantity_billed"] - l["quantity_accepted"] for l in lines)
                    parts.append(f"billed {over} more unit(s) than accepted")
                if any_price:
                    worst = max((l["unit_price_billed"] - l["po_unit_cost"]) / l["po_unit_cost"] for l in lines)
                    parts.append(f"price up to {worst * 100:.1f}% above PO")
                hold = "; ".join(parts)
                hold = hold[0].upper() + hold[1:]
            si = self.add("supplier_invoices", {
                "document_number": self.docno("AP", d), "supplier_invoice_ref": f"INV{d:%y%m}{rng.randint(1000, 99999)}",
                "supplier_id": sup["supplier_id"], "purchase_order_id": po["purchase_order_id"],
                "goods_receipt_id": gr["goods_receipt_id"], "invoice_date": iso(d),
                "due_date": iso(d + timedelta(days=sup["payment_terms_days"])),
                "billed_subtotal": billed, "billed_vat_amount": billed_vat, "billed_total_amount": r2(billed + billed_vat),
                "receipt_value": receipt_value, "match_status": match, "exception_type": ex_type, "hold_reason": hold,
                "resolution": None, "approved_date": None, "approved_by": None,
                "subtotal": None, "vat_amount": None, "total_amount": None, "price_variance": None,
                "status": "ON_HOLD" if exception else "OPEN",
            }, "supplier_invoice_id")
            for l in lines:
                self.add("supplier_invoice_lines", {"supplier_invoice_id": si["supplier_invoice_id"], **l}, "supplier_invoice_line_id")
            if exception:
                self.hold_due[next_business_day(d + timedelta(days=rng.randint(3, 20)))].append((si, po, lines))
            else:
                self.approve_supplier_invoice(d, si, billed, "AUTO_APPROVED", None)

    def resolve_holds(self, d: date):
        rng = self.prng
        for si, po, lines in self.hold_due.pop(d, []):
            # Quantity disputes: supplier credits units not accepted. Price disputes: buyer accepts or supplier corrects.
            accept_price = si["exception_type"] in ("PRICE", "PRICE_AND_QUANTITY") and rng.random() < 0.45
            payable = r2(sum(r2(l["quantity_accepted"] * (l["unit_price_billed"] if accept_price else l["po_unit_cost"])) for l in lines))
            self.approve_supplier_invoice(d, si, payable, "VARIANCE_ACCEPTED" if accept_price else "SUPPLIER_CORRECTED", po["buyer_id"])

    def approve_supplier_invoice(self, d: date, si: dict, subtotal: float, resolution: str, approver):
        vat = r2(subtotal * self.cfg.vat_rate)
        total = r2(subtotal + vat)
        variance = r2(subtotal - si["receipt_value"])
        si.update(subtotal=subtotal, vat_amount=vat, total_amount=total, price_variance=variance, resolution=resolution,
                  approved_date=iso(d), approved_by=approver, status="OPEN")
        self.vat_in[(d.year, d.month)] += vat
        lines = [("2150", si["receipt_value"], 0), ("1150", vat, 0), ("2000", 0, total)]
        if variance:
            lines.append(("5200", variance, 0) if variance > 0 else ("5200", 0, -variance))
        self.post(d, "SUPPLIER_INVOICE", si["supplier_invoice_id"],
                  f"AP {si['document_number']} {self.suppliers[si['supplier_id']]['name']}", lines)
        due = date.fromisoformat(si["due_date"])
        if total > 0:
            self.supp_pay_due[next_business_day(max(d, due + timedelta(days=self.prng.randint(-3, 5))))].append(si)

    def process_supplier_payments(self, d: date):
        for si in self.supp_pay_due.pop(d, []):
            pay = self.add("supplier_payments", {
                "payment_number": self.docno("PV", d), "supplier_invoice_id": si["supplier_invoice_id"],
                "supplier_id": si["supplier_id"], "payment_date": iso(d), "amount": si["total_amount"],
                "method": self.prng.choices(["TRANSFER", "CHEQUE"], weights=[85, 15])[0],
            }, "supplier_payment_id")
            si["status"] = "PAID"
            self.post(d, "SUPPLIER_PAYMENT", pay["supplier_payment_id"], f"Payment {pay['payment_number']} for {si['document_number']}",
                      [("2000", si["total_amount"], 0), ("1000", 0, si["total_amount"])])

    # ---------------- strategic sourcing (RFQs) ----------------
    def on_time_rate(self, sid: int) -> float:
        n, ok = self.sup_stats[sid]
        return ok / n if n >= 5 else 0.85

    def launch_rfq(self, d: date):
        rng, ds = self.prng, iso(d)
        open_pids = {r["product_id"] for r in self.t["rfqs"] if r["status"] == "OPEN"}
        cands = [p for p in self.prod_active if p["product_id"] not in open_pids]
        if not cands:
            return
        weights = [self.h["products"][p["product_id"]]["popularity"] * p["standard_cost"] ** 0.5 for p in cands]
        p = rng.choices(cands, weights=weights)[0]
        pid = p["product_id"]
        cat = p["category_id"]
        invited = [r["supplier_id"] for r in self.sp_by_product[pid]]
        newcomers = [s for s in self.cat_suppliers[cat] if s not in invited]
        if newcomers and rng.random() < 0.35:
            invited.append(rng.choice(newcomers))
        due = next_business_day(d + timedelta(days=rng.randint(7, 14)))
        annual = sum(pol["reorder_qty"] for (pp, _), pol in self.policies.items() if pp == pid) * 365 // self.cfg.order_cover_days
        rfq = self.add("rfqs", {
            "rfq_number": self.docno("RFQ", d), "product_id": pid, "buyer_id": rng.choice(self.h["buyers"]),
            "annual_quantity": max(10, int(round(annual, -1))), "issue_date": ds, "response_due_date": iso(due),
            "suppliers_invited": len(invited), "status": "OPEN", "awarded_supplier_id": None, "award_date": None,
            "previous_unit_cost": self.sp_cost(p["primary_supplier_id"], pid, d), "awarded_unit_cost": None, "cancel_reason": None,
        }, "rfq_id")
        std = self.price_row(pid, d)["standard_cost"]
        quotes = []
        for sid in invited:
            if rng.random() > 0.85:
                continue  # no response
            qd = d + timedelta(days=rng.randint(1, max(1, (due - d).days)))
            if qd > self.cfg.end:
                continue
            row = self.sp.get((sid, pid))
            factor = row["cost_factor"] * rng.uniform(0.95, 1.05) if row else rng.uniform(0.94, 1.10)
            lead = row["lead_time_days"] if row else max(2, self.suppliers[sid]["lead_time_days"] + rng.randint(-1, 2))
            moq = row["min_order_qty"] if row else rng.choice([1, 5, 10, 20])
            quotes.append(self.add("rfq_quotes", {
                "rfq_id": rfq["rfq_id"], "supplier_id": sid, "quote_date": iso(qd), "unit_price": r2(std * factor),
                "lead_time_days": lead, "min_order_qty": moq, "valid_until": iso(due + timedelta(days=90)),
                "score": None, "status": "SUBMITTED",
            }, "quote_id"))
        rfq["_quotes"] = quotes
        if rng.random() < 0.05:
            self.rfq_due[next_business_day(d + timedelta(days=rng.randint(2, max(2, (due - d).days - 1))))].append(("cancel", rfq))
        else:
            self.rfq_due[due].append(("award", rfq))

    def process_rfqs(self, d: date):
        for action, rfq in self.rfq_due.pop(d, []):
            if action == "cancel":
                rfq.update(status="CANCELLED", cancel_reason="Demand forecast changed", award_date=None)
                continue
            quotes = [q for q in rfq["_quotes"] if q["quote_date"] <= iso(d)]
            if not quotes:
                rfq.update(status="CANCELLED", cancel_reason="No supplier responded")
                continue
            for q in quotes:
                q["score"] = r2(q["unit_price"] * (1 + 0.004 * q["lead_time_days"]) * (1 + 0.5 * (1 - self.on_time_rate(q["supplier_id"]))))
            win = min(quotes, key=lambda q: q["score"])
            for q in quotes:
                q["status"] = "AWARDED" if q is win else "LOST"
            pid, sid = rfq["product_id"], win["supplier_id"]
            rfq.update(status="AWARDED", awarded_supplier_id=sid, award_date=iso(d), awarded_unit_cost=win["unit_price"])
            row = self.sp.get((sid, pid))
            if row is None:  # new supplier wins: add to the price list
                row = {"supplier_product_id": len(self.m["supplier_products"]) + 1, "supplier_id": sid, "product_id": pid,
                       "supplier_sku": f"{self.suppliers[sid]['supplier_code']}-{self.prng.randint(10000, 99999)}",
                       "is_preferred": 0}
                self.m["supplier_products"].append(row)
                self.sp[(sid, pid)] = row
                self.sp_by_product[pid].append(row)
            row.update(cost_factor=win["unit_price"] / self.price_row(pid, d)["standard_cost"],
                       lead_time_days=win["lead_time_days"], min_order_qty=win["min_order_qty"], valid_from=iso(d))
            for r in self.sp_by_product[pid]:
                r["is_preferred"] = int(r is row)
            self.products[pid]["primary_supplier_id"] = sid

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
        for r in self.m["supplier_products"]:  # export the price in force at the end date
            r["unit_cost"] = r2(r["cost_factor"] * self.price_row(r["product_id"], self.cfg.end)["standard_cost"])
        for inv in self.t["sales_invoices"]:
            paid = self.invoice_paid.get(inv["invoice_id"], 0.0)
            inv["status"] = "PAID" if paid >= inv["total_amount"] - 0.005 else "PARTIALLY_PAID" if paid > 0 else "OPEN"
