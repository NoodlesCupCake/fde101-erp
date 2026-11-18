"""Master data generation: org, people, partners, products, inventory policies."""
import math
import random
import re
from datetime import date, timedelta

from . import reference as ref
from .config import Config


def iso(d):
    return d.isoformat() if d else None


def rand_date(rng: random.Random, a: date, b: date) -> date:
    return a + timedelta(days=rng.randint(0, max(0, (b - a).days)))  # tolerate short simulation windows


def thai_tax_id(rng: random.Random, prefix: str) -> str:
    """13-digit Thai tax ID with a valid mod-11 check digit."""
    body = prefix + "".join(str(rng.randint(0, 9)) for _ in range(12 - len(prefix)))
    s = sum(int(c) * (13 - i) for i, c in enumerate(body))
    return body + str((11 - s % 11) % 10)


def phone(rng, province):
    if province in ("Bangkok", "Nonthaburi", "Pathum Thani", "Samut Prakan"):
        return f"02-{rng.randint(100, 999)}-{rng.randint(1000, 9999)}"
    if rng.random() < 0.4:
        return f"08{rng.randint(0, 9)}-{rng.randint(100, 999)}-{rng.randint(1000, 9999)}"
    return f"0{rng.randint(32, 77)}-{rng.randint(100, 999)}-{rng.randint(100, 999)}"


def slug_email(name, used, local="sales"):
    words = re.sub(r"[^a-z ]", "", name.lower()).split()
    stop = {"co", "ltd", "limited", "partnership", "public", "shop"}
    base = "".join(w for w in words if w not in stop)[:18] or "company"
    domain, n = base, 1
    while domain in used:
        n += 1
        domain = f"{base}{n}"
    used.add(domain)
    return f"{local}@{domain}.co.th"


def weighted(rng, pairs):
    items, weights = zip(*pairs)
    return rng.choices(items, weights=weights)[0]


def round_price(x):
    if x >= 100:
        return float(round(x / 5) * 5)
    if x >= 20:
        return float(round(x))
    return round(x * 4) / 4


def generate_master(cfg: Config, rng: random.Random):
    t = {}
    hidden = {"customers": {}, "products": {}}

    t["company"] = [{**ref.COMPANY, "currency": cfg.currency, "vat_rate": cfg.vat_rate}]

    # ---------------- Departments & employees ----------------
    t["departments"] = [{"department_id": i, "code": c, "name": n} for i, (c, n, *_) in enumerate(ref.DEPARTMENTS, 1)]
    employees, used_emails = [], set()
    md_id = None
    for dept_id, (code, _, share, head_title, head_salary, staff_titles) in enumerate(ref.DEPARTMENTS, 1):
        count = max(2, round(share * cfg.n_employees))
        head_id = None
        for i in range(count):
            fn, ln = rng.choice(ref.FIRST_NAMES), rng.choice(ref.LAST_NAMES)
            email = f"{fn.lower()}.{ln[0].lower()}"
            k = 1
            while email in used_emails:
                k += 1
                email = f"{fn.lower()}.{ln[:k].lower()}"
            used_emails.add(email)
            emp_id = len(employees) + 1
            if i == 0:
                title, salary = head_title, head_salary * rng.uniform(0.9, 1.1)
                hire = rand_date(rng, date(2012, 1, 1), date(2020, 12, 31))
                manager = None if code == "MGT" else md_id
                head_id = emp_id
                if code == "MGT":
                    md_id = emp_id
            else:
                title, lo, hi = rng.choice(staff_titles)
                salary = rng.uniform(lo, hi)
                manager = head_id
                hire = (rand_date(rng, cfg.start, cfg.end - timedelta(days=60)) if rng.random() < 0.10
                        else rand_date(rng, date(2016, 1, 1), date(2024, 10, 31)))
            term = None
            if i > 0 and code != "SAL" and hire < cfg.start and rng.random() < 0.10:
                term = rand_date(rng, cfg.start + timedelta(days=30), cfg.end - timedelta(days=15))
            employees.append({
                "employee_id": emp_id, "employee_code": f"E{emp_id:04d}", "first_name": fn, "last_name": ln,
                "email": f"{email}@apro.co.th", "department_id": dept_id, "job_title": title,
                "manager_id": manager, "hire_date": iso(hire), "termination_date": iso(term),
                "monthly_salary": float(round(salary / 500) * 500), "is_active": int(term is None),
            })
    t["employees"] = employees
    dept_of = {d["code"]: d["department_id"] for d in t["departments"]}
    sales_reps = [e for e in employees if e["department_id"] == dept_of["SAL"] and e["manager_id"] is not None]
    hidden["buyers"] = [e["employee_id"] for e in employees if e["department_id"] == dept_of["PUR"]]
    hidden["warehouse_staff"] = [e["employee_id"] for e in employees if e["department_id"] == dept_of["WHS"]]

    t["warehouses"] = [dict(w) for w in ref.WAREHOUSES]
    t["product_categories"] = [{"category_id": i, "code": c[0], "name": c[1]} for i, c in enumerate(ref.CATEGORIES, 1)]
    cat_id = {c["code"]: c["category_id"] for c in t["product_categories"]}
    prov_pairs = [(p[0], p[2]) for p in ref.PROVINCES]
    region_of = {p[0]: p[1] for p in ref.PROVINCES}

    # ---------------- Suppliers ----------------
    suppliers, used_names, used_domains = [], set(), set()
    cat_codes = [c[0] for c in ref.CATEGORIES]
    supplier_cats = {}
    for i in range(1, cfg.n_suppliers + 1):
        cats = [cat_codes[(i - 1) % len(cat_codes)]]
        if rng.random() < 0.3:
            cats.append(rng.choice([c for c in cat_codes if c not in cats]))
        word = next(c[2] for c in ref.CATEGORIES if c[0] == cats[0])
        while True:
            name = f"{rng.choice(ref.NAME_PREFIX)} {word} {rng.choice(ref.SUPPLIER_CORE)} {weighted(rng, ref.COMPANY_SUFFIX[:2])}"
            if name not in used_names:
                used_names.add(name)
                break
        importer = rng.random() < 0.15
        prov = weighted(rng, [("Bangkok", 10), ("Samut Prakan", 6), ("Chonburi", 4), ("Rayong", 2),
                              ("Pathum Thani", 4), ("Samut Sakhon", 3), ("Nonthaburi", 2)])
        suppliers.append({
            "supplier_id": i, "supplier_code": f"V{i:04d}", "name": name,
            "tax_id": thai_tax_id(rng, "0105"), "province": prov, "phone": phone(rng, prov),
            "email": slug_email(name, used_domains), "payment_terms_days": rng.choice([30, 30, 45, 60]),
            "lead_time_days": rng.randint(15, 30) if importer else rng.randint(3, 12),
            "order_weekday": (i - 1) % 6,  # Mon..Sat
            "created_date": iso(rand_date(rng, date(2014, 1, 1), date(2022, 12, 31))), "is_active": 1,
        })
        supplier_cats[i] = cats
    t["suppliers"] = suppliers

    # ---------------- Products & prices ----------------
    candidates = []
    for code, _, _, brands, items in ref.CATEGORIES:
        for item, variants, uom, (lo, hi) in items:
            base_cost = rng.uniform(lo, hi)
            for vi, var in enumerate(variants):
                for brand in brands:
                    candidates.append((code, brand, item, var, uom, base_cost * (1 + 0.3 * vi) * rng.uniform(0.9, 1.1)))
    picks = rng.sample(candidates, min(cfg.n_products, len(candidates)))
    picks.sort(key=lambda c: (c[0], c[2], c[3], c[1]))
    products, prices = [], []
    seq = {}
    price_change = date(cfg.start.year + 1, 1, 1)
    for pid, (code, brand, item, var, uom, cost_now) in enumerate(picks, 1):
        seq[code] = seq.get(code, 0) + 1
        created = (rand_date(rng, cfg.start + timedelta(days=30), cfg.end - timedelta(days=120)) if rng.random() < 0.10
                   else rand_date(rng, date(2018, 1, 1), date(2024, 6, 30)))
        disc = None
        if created < cfg.start and rng.random() < 0.05:
            disc = rand_date(rng, cfg.start + timedelta(days=90), cfg.end - timedelta(days=30))
        markup = rng.uniform(1.28, 1.70)
        cost_now = round(cost_now, 2)
        price_now = round_price(cost_now * markup)
        cost_old = round(cost_now / rng.uniform(1.02, 1.05), 2)
        price_old = round_price(price_now / rng.uniform(1.03, 1.06))
        candidates_sup = [s for s, cs in supplier_cats.items() if code in cs]
        products.append({
            "product_id": pid, "sku": f"{code}-{seq[code]:04d}", "name": f"{brand} {item} {var}", "brand": brand,
            "category_id": cat_id[code], "uom": uom, "standard_cost": cost_now, "list_price": price_now,
            "primary_supplier_id": rng.choice(candidates_sup), "created_date": iso(created),
            "discontinued_date": iso(disc), "is_active": int(disc is None),
        })
        if created < price_change:
            prices.append({"product_id": pid, "valid_from": iso(min(created, date(2024, 1, 1))),
                           "valid_to": iso(price_change - timedelta(days=1)), "list_price": price_old, "standard_cost": cost_old})
        prices.append({"product_id": pid, "valid_from": iso(max(created, price_change)),
                       "valid_to": None, "list_price": price_now, "standard_cost": cost_now})
        hidden["products"][pid] = {
            "popularity": rng.lognormvariate(0, 1.0),
            "qty_factor": min(3.0, max(0.2, (150 / cost_now) ** 0.5)),
        }
    for i, p in enumerate(prices, 1):
        p["product_price_id"] = i
    t["products"], t["product_prices"] = products, prices

    # ---------------- Customers ----------------
    customers, used_names, used_domains = [], set(), set()
    seg_pairs = [(s, v["share"]) for s, v in ref.SEGMENTS.items()]
    for i in range(1, cfg.n_customers + 1):
        seg = weighted(rng, seg_pairs)
        sc = ref.SEGMENTS[seg]
        while True:
            core = rng.choice(ref.SEGMENT_CORE[seg])
            if seg == "Retail" and rng.random() < 0.5:
                name = f"{rng.choice(ref.FIRST_NAMES)} {core}"
                sole = True
            else:
                name = f"{rng.choice(ref.NAME_PREFIX)} {core} {weighted(rng, ref.COMPANY_SUFFIX)}"
                sole = False
            if name not in used_names:
                used_names.add(name)
                break
        prov = weighted(rng, prov_pairs)
        region = region_of[prov]
        created = (rand_date(rng, cfg.start, cfg.end - timedelta(days=60)) if rng.random() < 0.20
                   else rand_date(rng, date(2017, 1, 1), date(2024, 12, 15)))
        credit = round(rng.uniform(*sc["credit"]) / 10_000) * 10_000
        customers.append({
            "customer_id": i, "customer_code": f"C{i:05d}", "name": name,
            "tax_id": thai_tax_id(rng, str(rng.randint(1, 3))) if sole else thai_tax_id(rng, "0105" if prov == "Bangkok" else f"0{rng.randint(10, 99)}"),
            "segment": seg, "province": prov, "region": region, "phone": phone(rng, prov),
            "email": slug_email(name, used_domains, rng.choice(["sales", "purchase", "info", "account"])),
            "credit_limit": float(credit), "payment_terms_days": rng.choice(sc["terms"]),
            "sales_rep_id": rng.choice(sales_reps)["employee_id"], "default_warehouse_id": ref.REGION_WAREHOUSE[region],
            "created_date": iso(created), "is_active": 1,
        })
        beh = weighted(rng, [(b[0], b[1]) for b in ref.PAYMENT_BEHAVIOURS])
        hidden["customers"][i] = {
            "volume_weight": rng.paretovariate(1.3) * sc["volume"],
            "payment_behaviour": beh,
            "default_from": iso(rand_date(rng, date(cfg.start.year + 1, 1, 1), cfg.end - timedelta(days=60))) if beh == "defaulter" else None,
            "churn_date": iso(rand_date(rng, cfg.start + timedelta(days=120), cfg.end - timedelta(days=30))) if rng.random() < 0.08 else None,
        }
    t["customers"] = customers

    # ---------------- Inventory policies ----------------
    # Rough expected daily units per product/warehouse → reorder point / qty.
    cw = hidden["customers"]
    seg_w = {s: sum(cw[c["customer_id"]]["volume_weight"] for c in customers if c["segment"] == s) for s in ref.SEGMENTS}
    tot_w = sum(seg_w.values())
    units_per_order_line = sum(seg_w[s] / tot_w * ((sc["lines"][0] + sc["lines"][1]) / 2) * ((sc["qty"][0] + sc["qty"][1]) / 2)
                               for s, sc in ref.SEGMENTS.items())
    wh_share = {w["warehouse_id"]: 0.0 for w in t["warehouses"]}
    for c in customers:
        wh_share[c["default_warehouse_id"]] += cw[c["customer_id"]]["volume_weight"] / tot_w
    orders_per_day = cfg.base_orders_per_day * (1 + cfg.annual_growth) ** 0.9 * 0.93
    tot_pop = sum(h["popularity"] for h in hidden["products"].values())
    lead = {s["supplier_id"]: s["lead_time_days"] for s in suppliers}
    policies = []
    for p in products:
        hp = hidden["products"][p["product_id"]]
        for wid, share in wh_share.items():
            units = orders_per_day * share * units_per_order_line * hp["qty_factor"] * hp["popularity"] / tot_pop
            lt = lead[p["primary_supplier_id"]]
            policies.append({
                "inventory_policy_id": len(policies) + 1, "product_id": p["product_id"], "warehouse_id": wid,
                "reorder_point": max(2, math.ceil(units * (lt + cfg.safety_days + cfg.review_period_days))),
                "reorder_qty": max(5, math.ceil(units * cfg.order_cover_days)),
            })
    t["inventory_policies"] = policies

    t["chart_of_accounts"] = [
        {"account_code": c, "name": n, "account_type": ty,
         "normal_balance": "DEBIT" if ty in ("ASSET", "EXPENSE") else "CREDIT"}
        for c, n, ty in ref.CHART_OF_ACCOUNTS
    ]
    return t, hidden
