"""Static reference data. All organisations and people are fictional."""

COMPANY = {
    "company_id": 1,
    "name": "A-Pro Distribution Co., Ltd.",
    "tax_id": "0105558012347",
    "address": "88 Moo 4, Bang Na-Trat Rd, Bang Phli, Samut Prakan 10540",
    "fiscal_year_start_month": 1,
}

# (province, region, weight)
PROVINCES = [
    ("Bangkok", "Central", 30), ("Nonthaburi", "Central", 6), ("Pathum Thani", "Central", 5),
    ("Samut Prakan", "Central", 6), ("Nakhon Pathom", "Central", 3), ("Phra Nakhon Si Ayutthaya", "Central", 3),
    ("Chonburi", "East", 7), ("Rayong", "East", 4), ("Chachoengsao", "East", 2),
    ("Chiang Mai", "North", 6), ("Chiang Rai", "North", 2), ("Lampang", "North", 1),
    ("Phitsanulok", "North", 2), ("Nakhon Sawan", "North", 1),
    ("Khon Kaen", "Northeast", 5), ("Nakhon Ratchasima", "Northeast", 5),
    ("Udon Thani", "Northeast", 3), ("Ubon Ratchathani", "Northeast", 2),
    ("Surat Thani", "South", 2), ("Songkhla", "South", 3), ("Phuket", "South", 3),
    ("Ratchaburi", "West", 2), ("Kanchanaburi", "West", 1),
]

WAREHOUSES = [
    {"warehouse_id": 1, "code": "WH-BKK", "name": "Bangkok Distribution Center", "province": "Samut Prakan", "region": "Central"},
    {"warehouse_id": 2, "code": "WH-CNX", "name": "Chiang Mai Branch Warehouse", "province": "Chiang Mai", "region": "North"},
    {"warehouse_id": 3, "code": "WH-KKN", "name": "Khon Kaen Branch Warehouse", "province": "Khon Kaen", "region": "Northeast"},
]
REGION_WAREHOUSE = {"Central": 1, "East": 1, "West": 1, "South": 1, "North": 2, "Northeast": 3}

FIRST_NAMES = [
    "Somchai", "Somsak", "Anan", "Prasert", "Wichai", "Kittipong", "Narong", "Thanakorn", "Chaiwat",
    "Sompong", "Nattapong", "Pichai", "Arthit", "Ekkachai", "Surasak", "Thanawat", "Phongsakorn",
    "Somying", "Malee", "Siriporn", "Kanokwan", "Nattaya", "Pimchanok", "Ratchanee", "Wanida",
    "Supaporn", "Sasithorn", "Jiraporn", "Kanya", "Orawan", "Pornthip", "Duangjai", "Chutima", "Benjawan",
]
LAST_NAMES = [
    "Saetang", "Srisuk", "Wongsawat", "Chaiyaporn", "Rattanakorn", "Thongdee", "Bunmee", "Kaewkla",
    "Suksawat", "Phromma", "Jaidee", "Sombat", "Charoenrat", "Inthasorn", "Pongpanit", "Siriwat",
    "Nakprasit", "Chaisri", "Boonyarat", "Kongkaew", "Limpaiboon", "Wattanasin", "Prasertsuk",
    "Thammasak", "Yodmanee", "Srisawat", "Kittisak", "Chantarasorn",
]

NAME_PREFIX = [
    "Siam", "Rattana", "Chaiyo", "Thanakit", "Sinsap", "Charoen", "Mongkol", "Sukjai", "Thai Pattana",
    "Rungrueang", "Saeng Thong", "Kittikun", "Phatthana", "Pornchai", "Udom", "Wattana", "Sombat",
    "Boonmee", "Thawee", "Suwan", "Prosper", "Golden", "Royal", "United", "Eastern", "Northern",
    "Lanna", "Isan", "Andaman", "Metro", "Chokdee", "Sahamit", "Ruamjai", "Thongchai", "Nakhon",
]
SEGMENT_CORE = {
    "Retail": ["Hardware", "Home Mart", "Home Center", "Hardware Shop", "Construction Shop"],
    "Contractor": ["Construction", "Builders", "Engineering", "Contractor", "Development", "Interior", "Technic"],
    "Wholesale": ["Trading", "Supply", "Materials", "Distribution", "Industrial Supply", "Hardware Trading"],
}
COMPANY_SUFFIX = [("Co., Ltd.", 70), ("Limited Partnership", 22), ("Public Co., Ltd.", 2)]

# Customer segment config: share of customers, lines per order, base qty, discount %, credit limit, terms
SEGMENTS = {
    "Retail":     {"share": 0.45, "lines": (1, 5), "qty": (1, 10),  "disc": 0.0, "credit": (50_000, 300_000),     "terms": [0, 0, 15, 30], "volume": 1.6},
    "Contractor": {"share": 0.35, "lines": (2, 8), "qty": (4, 36),  "disc": 4.0, "credit": (200_000, 2_000_000),  "terms": [30, 45, 60],   "volume": 1.3},
    "Wholesale":  {"share": 0.20, "lines": (3, 10), "qty": (12, 64),  "disc": 8.0, "credit": (1_000_000, 6_000_000), "terms": [30, 45, 60, 90], "volume": 1.1},
}

# Hidden payment behaviour: (name, weight, delay range in days relative to due date)
PAYMENT_BEHAVIOURS = [
    ("prompt", 45, (-7, 2)),
    ("normal", 30, (0, 15)),
    ("slow", 15, (10, 45)),
    ("late", 8, (30, 120)),
    ("defaulter", 2, (0, 20)),  # pays like 'normal' until default_from, then stops paying
]

# Product catalog. (item, variants, uom, (cost_lo, cost_hi))
CATEGORIES = [
    ("ELEC", "Electrical", "Electric", ["Volta", "Lumina", "Siam Electric"], [
        ("LED Bulb", ["9W", "13W", "18W"], "PCS", (28, 60)),
        ("THW Electrical Wire 100m", ["1.5 sq.mm", "2.5 sq.mm", "4 sq.mm"], "ROLL", (650, 1400)),
        ("Circuit Breaker", ["16A", "32A", "63A"], "PCS", (120, 380)),
        ("Power Outlet", ["Single", "Double", "with USB"], "PCS", (35, 90)),
        ("PVC Conduit 2.9m", ['1/2"', '3/4"', '1"'], "LEN", (22, 55)),
        ("LED Panel Light", ["12W", "18W", "24W"], "PCS", (140, 320)),
    ]),
    ("PLMB", "Plumbing", "Pipe", ["AquaFlow", "Thai Pipe", "HydroMax"], [
        ("PVC Pipe Class 8.5 4m", ['1/2"', '3/4"', '1"', '2"'], "LEN", (45, 120)),
        ("PVC Elbow 90", ['1/2"', '3/4"', '1"'], "PCS", (4, 12)),
        ("Brass Ball Valve", ['1/2"', '3/4"', '1"'], "PCS", (95, 260)),
        ("Kitchen Faucet", ["Standard", "Swivel", "Pull-out"], "PCS", (320, 900)),
        ("Automatic Water Pump", ["150W", "250W", "350W"], "UNIT", (2400, 4800)),
    ]),
    ("TOOL", "Hand & Power Tools", "Tools", ["Ironclad", "ProLine", "Kinetic"], [
        ("Claw Hammer", ["16oz", "20oz"], "PCS", (120, 260)),
        ("Screwdriver Set", ["6pc", "12pc"], "SET", (150, 420)),
        ("Cordless Drill 18V", ["1 Battery", "2 Battery"], "UNIT", (1600, 3200)),
        ("Angle Grinder", ['4"', '5"'], "UNIT", (900, 1700)),
        ("Measuring Tape", ["5m", "8m"], "PCS", (60, 140)),
    ]),
    ("FAST", "Fasteners", "Fastener", ["SureGrip", "BoltPro"], [
        ("Wood Screw Box 100pc", ["#6", "#8", "#10"], "BOX", (35, 80)),
        ("Anchor Bolt", ["M6", "M8", "M10", "M12"], "PCS", (3, 12)),
        ("Hex Bolt & Nut", ["M8", "M10", "M12"], "PCS", (2, 8)),
        ("Steel Nail 1kg", ['1"', '2"', '3"'], "KG", (38, 55)),
        ("Blind Rivet Box 500pc", ["3.2mm", "4mm"], "BOX", (95, 180)),
    ]),
    ("PAINT", "Paint & Coatings", "Paint", ["ColorMax", "Siam Paint", "Duracoat"], [
        ("Interior Emulsion Paint", ["1 Gallon", "5 Gallon"], "CAN", (380, 1900)),
        ("Exterior Acrylic Paint", ["1 Gallon", "5 Gallon"], "CAN", (520, 2600)),
        ("Primer", ["1 Gallon", "5 Gallon"], "CAN", (300, 1400)),
        ("Paint Roller", ['4"', '10"'], "PCS", (45, 120)),
        ("Paint Thinner", ["1L", "5L"], "CAN", (55, 240)),
    ]),
    ("SAFE", "Safety Equipment", "Safety", ["SafeGuard", "WorkSafe"], [
        ("Safety Helmet", ["White", "Yellow", "Blue"], "PCS", (75, 160)),
        ("Work Gloves (12 pairs)", ["Cotton", "Nitrile Coated"], "PACK", (90, 260)),
        ("Safety Glasses", ["Clear", "Tinted"], "PCS", (35, 90)),
        ("Reflective Vest", ["M", "L", "XL"], "PCS", (55, 120)),
        ("Safety Shoes", ["39", "41", "43"], "PAIR", (450, 950)),
    ]),
    ("BLDG", "Building Materials", "Building Materials", ["BuildPro", "Thai Cement", "StrongWall"], [
        ("Portland Cement 50kg", ["Type 1", "Mortar"], "BAG", (125, 165)),
        ("Tile Adhesive 20kg", ["Standard", "Premium"], "BAG", (110, 260)),
        ("Gypsum Board 120x240", ["9mm", "12mm"], "SHEET", (130, 210)),
        ("Silicone Sealant", ["Clear", "White"], "TUBE", (65, 130)),
        ("Waterproofing Membrane 4kg", ["Grey", "White"], "CAN", (420, 780)),
    ]),
]

SUPPLIER_CORE = ["Industries", "Manufacturing", "Products", "Import", "Factory", "Corporation", "Trading"]

# Departments: code, name, share of headcount, head title, head salary, [(staff title, sal_lo, sal_hi)]
DEPARTMENTS = [
    ("MGT", "Management", 0.05, "Managing Director", 220_000, [("Executive Assistant", 30_000, 42_000)]),
    ("SAL", "Sales", 0.30, "Sales Manager", 95_000, [("Sales Representative", 22_000, 45_000), ("Key Account Executive", 40_000, 62_000)]),
    ("PUR", "Purchasing", 0.08, "Purchasing Manager", 85_000, [("Buyer", 25_000, 42_000)]),
    ("WHS", "Warehouse & Logistics", 0.33, "Warehouse Manager", 75_000, [("Warehouse Staff", 12_000, 18_000), ("Forklift Operator", 13_000, 18_000), ("Delivery Driver", 14_000, 20_000), ("Inventory Controller", 20_000, 30_000)]),
    ("FIN", "Finance & Accounting", 0.10, "Finance Manager", 100_000, [("Accountant", 22_000, 40_000), ("AR/AP Officer", 18_000, 28_000)]),
    ("ITS", "IT", 0.06, "IT Manager", 90_000, [("IT Support", 20_000, 34_000)]),
    ("HRA", "HR & Admin", 0.08, "HR & Admin Manager", 75_000, [("HR Officer", 20_000, 32_000), ("Admin Officer", 16_000, 25_000)]),
]

CHART_OF_ACCOUNTS = [
    ("1000", "Cash at Bank", "ASSET"),
    ("1100", "Accounts Receivable", "ASSET"),
    ("1150", "Input VAT", "ASSET"),
    ("1200", "Inventory", "ASSET"),
    ("2000", "Accounts Payable", "LIABILITY"),
    ("2100", "Output VAT", "LIABILITY"),
    ("2150", "Goods Received Not Invoiced", "LIABILITY"),
    ("3000", "Share Capital", "EQUITY"),
    ("3100", "Retained Earnings", "EQUITY"),
    ("4000", "Sales Revenue", "REVENUE"),
    ("5000", "Cost of Goods Sold", "EXPENSE"),
    ("5100", "Inventory Shrinkage", "EXPENSE"),
    ("5200", "Purchase Price Variance", "EXPENSE"),
    ("6000", "Salaries & Wages", "EXPENSE"),
    ("6010", "Social Security (Employer)", "EXPENSE"),
    ("6100", "Rent Expense", "EXPENSE"),
    ("6200", "Utilities Expense", "EXPENSE"),
]

# Seasonality for Thai construction/hardware demand: Songkran dip in April, rainy season dip Jul-Oct.
MONTH_SEASONALITY = {1: 0.95, 2: 1.05, 3: 1.12, 4: 0.80, 5: 1.0, 6: 0.95, 7: 0.88, 8: 0.90, 9: 0.85, 10: 0.92, 11: 1.08, 12: 1.15}
WEEKDAY_FACTOR = {0: 1.10, 1: 1.05, 2: 1.0, 3: 1.0, 4: 0.95, 5: 0.45, 6: 0.0}  # closed Sundays
# Fixed-date public holidays (month, day) — closed
HOLIDAYS = {(1, 1), (4, 6), (4, 13), (4, 14), (4, 15), (5, 1), (6, 3), (7, 28), (8, 12), (10, 13), (10, 23), (12, 5), (12, 10), (12, 31)}

# ---------------- Procurement ----------------
# Hidden supplier reliability profiles (exported to ground_truth/supplier_reliability.csv)
#   on_time: P(delivery on/before promised date); late_days: delay range when late
#   short: P(final delivery short-ships a line); reject: P(a line has damaged units rejected at receipt)
#   price_err / qty_err: P(an invoice line is billed at a wrong price / for more units than accepted)
SUPPLIER_PROFILES = {
    "reliable":   {"weight": 50, "on_time": 0.95, "late_days": (1, 3),  "short": 0.03, "reject": 0.01, "price_err": 0.03, "qty_err": 0.02},
    "average":    {"weight": 35, "on_time": 0.84, "late_days": (1, 5),  "short": 0.07, "reject": 0.03, "price_err": 0.07, "qty_err": 0.04},
    "unreliable": {"weight": 15, "on_time": 0.60, "late_days": (2, 12), "short": 0.18, "reject": 0.07, "price_err": 0.14, "qty_err": 0.09},
}

# Requisition approval matrix by estimated value (THB, excl. VAT): (upper bound, level, approver, days to decide, reject prob)
APPROVAL_MATRIX = [
    (50_000, "AUTO", None, (0, 0), 0.0),
    (300_000, "PURCHASING_MANAGER", "PUR_HEAD", (1, 3), 0.04),
    (float("inf"), "MANAGING_DIRECTOR", "MD", (2, 6), 0.08),
]
REJECT_REASONS = ["Quantity exceeds forecast demand", "Budget hold this month", "Transfer stock from another warehouse instead",
                  "Duplicate of an open request", "Wait for sourcing event (RFQ) result"]

# Items of the same supplier+warehouse below this × reorder point are topped up when a PO is raised
CONSOLIDATION_FACTOR = 1.35

# Three-way match tolerance: price within 1% on every line AND total variance within THB 1,000 → auto-approve
MATCH_PRICE_TOLERANCE = 0.01
MATCH_AMOUNT_TOLERANCE = 1_000
GR_REJECT_REASONS = ["Damaged packaging", "Wrong specification", "Expired / defective", "Broken in transit"]
