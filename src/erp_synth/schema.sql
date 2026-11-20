-- A-ERP prototype schema (SQLite). Tables are listed in dependency order.
-- Amounts are in company currency (THB). Dates are ISO-8601 text (YYYY-MM-DD).

-- ============ Master data ============

CREATE TABLE company (
    company_id              INTEGER PRIMARY KEY,
    name                    TEXT NOT NULL,
    tax_id                  TEXT NOT NULL,
    address                 TEXT,
    currency                TEXT NOT NULL,
    vat_rate                REAL NOT NULL,
    fiscal_year_start_month INTEGER NOT NULL
);

CREATE TABLE departments (
    department_id INTEGER PRIMARY KEY,
    code          TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL
);

CREATE TABLE employees (
    employee_id      INTEGER PRIMARY KEY,
    employee_code    TEXT NOT NULL UNIQUE,
    first_name       TEXT NOT NULL,
    last_name        TEXT NOT NULL,
    email            TEXT NOT NULL UNIQUE,
    department_id    INTEGER NOT NULL REFERENCES departments(department_id),
    job_title        TEXT NOT NULL,
    manager_id       INTEGER REFERENCES employees(employee_id),
    hire_date        TEXT NOT NULL,
    termination_date TEXT,
    monthly_salary   REAL NOT NULL,
    is_active        INTEGER NOT NULL
);

CREATE TABLE warehouses (
    warehouse_id INTEGER PRIMARY KEY,
    code         TEXT NOT NULL UNIQUE,
    name         TEXT NOT NULL,
    province     TEXT NOT NULL,
    region       TEXT NOT NULL
);

CREATE TABLE product_categories (
    category_id INTEGER PRIMARY KEY,
    code        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL
);

CREATE TABLE suppliers (
    supplier_id        INTEGER PRIMARY KEY,
    supplier_code      TEXT NOT NULL UNIQUE,
    name               TEXT NOT NULL,
    tax_id             TEXT NOT NULL,
    province           TEXT NOT NULL,
    phone              TEXT,
    email              TEXT,
    payment_terms_days INTEGER NOT NULL,
    lead_time_days     INTEGER NOT NULL,
    order_weekday      INTEGER NOT NULL,  -- 0=Mon … 5=Sat: purchasing review day
    created_date       TEXT NOT NULL,
    is_active          INTEGER NOT NULL
);

CREATE TABLE products (
    product_id          INTEGER PRIMARY KEY,
    sku                 TEXT NOT NULL UNIQUE,
    name                TEXT NOT NULL,
    brand               TEXT NOT NULL,
    category_id         INTEGER NOT NULL REFERENCES product_categories(category_id),
    uom                 TEXT NOT NULL,
    standard_cost       REAL NOT NULL,  -- current standard cost
    list_price          REAL NOT NULL,  -- current list price (see product_prices for history)
    primary_supplier_id INTEGER NOT NULL REFERENCES suppliers(supplier_id),
    created_date        TEXT NOT NULL,
    discontinued_date   TEXT,
    is_active           INTEGER NOT NULL
);

CREATE TABLE product_prices (
    product_price_id INTEGER PRIMARY KEY,
    product_id       INTEGER NOT NULL REFERENCES products(product_id),
    valid_from       TEXT NOT NULL,
    valid_to         TEXT,            -- NULL = currently valid
    list_price       REAL NOT NULL,
    standard_cost    REAL NOT NULL
);

CREATE TABLE inventory_policies (
    inventory_policy_id INTEGER PRIMARY KEY,
    product_id          INTEGER NOT NULL REFERENCES products(product_id),
    warehouse_id        INTEGER NOT NULL REFERENCES warehouses(warehouse_id),
    reorder_point       INTEGER NOT NULL,
    reorder_qty         INTEGER NOT NULL,
    UNIQUE (product_id, warehouse_id)
);

CREATE TABLE supplier_products (
    supplier_product_id INTEGER PRIMARY KEY,
    supplier_id         INTEGER NOT NULL REFERENCES suppliers(supplier_id),
    product_id          INTEGER NOT NULL REFERENCES products(product_id),
    supplier_sku        TEXT NOT NULL,
    unit_cost           REAL NOT NULL,     -- current agreed price (excl. VAT); RFQ awards update it
    lead_time_days      INTEGER NOT NULL,
    min_order_qty       INTEGER NOT NULL,
    is_preferred        INTEGER NOT NULL,  -- exactly one preferred supplier per product
    valid_from          TEXT NOT NULL,     -- date the current price took effect
    UNIQUE (supplier_id, product_id)
);

CREATE TABLE customers (
    customer_id          INTEGER PRIMARY KEY,
    customer_code        TEXT NOT NULL UNIQUE,
    name                 TEXT NOT NULL,
    tax_id               TEXT NOT NULL,
    segment              TEXT NOT NULL CHECK (segment IN ('Retail', 'Contractor', 'Wholesale')),
    province             TEXT NOT NULL,
    region               TEXT NOT NULL,
    phone                TEXT,
    email                TEXT,
    credit_limit         REAL NOT NULL,
    payment_terms_days   INTEGER NOT NULL,
    sales_rep_id         INTEGER NOT NULL REFERENCES employees(employee_id),
    default_warehouse_id INTEGER NOT NULL REFERENCES warehouses(warehouse_id),
    created_date         TEXT NOT NULL,
    is_active            INTEGER NOT NULL
);

CREATE TABLE chart_of_accounts (
    account_code   TEXT PRIMARY KEY,
    name           TEXT NOT NULL,
    account_type   TEXT NOT NULL CHECK (account_type IN ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE')),
    normal_balance TEXT NOT NULL CHECK (normal_balance IN ('DEBIT', 'CREDIT'))
);

-- ============ Order-to-cash ============

CREATE TABLE sales_orders (
    sales_order_id INTEGER PRIMARY KEY,
    order_number   TEXT NOT NULL UNIQUE,
    customer_id    INTEGER NOT NULL REFERENCES customers(customer_id),
    sales_rep_id   INTEGER NOT NULL REFERENCES employees(employee_id),
    warehouse_id   INTEGER NOT NULL REFERENCES warehouses(warehouse_id),
    order_date     TEXT NOT NULL,
    requested_date TEXT NOT NULL,
    status         TEXT NOT NULL CHECK (status IN ('OPEN', 'INVOICED', 'CANCELLED')),
    cancelled_date TEXT,
    cancel_reason  TEXT,
    subtotal       REAL NOT NULL,
    vat_amount     REAL NOT NULL,
    total_amount   REAL NOT NULL,
    currency       TEXT NOT NULL
);

CREATE TABLE sales_order_lines (
    sales_order_line_id INTEGER PRIMARY KEY,
    sales_order_id      INTEGER NOT NULL REFERENCES sales_orders(sales_order_id),
    line_no             INTEGER NOT NULL,
    product_id          INTEGER NOT NULL REFERENCES products(product_id),
    quantity            INTEGER NOT NULL CHECK (quantity > 0),
    unit_price          REAL NOT NULL,
    discount_pct        REAL NOT NULL,   -- percent, e.g. 5.0 = 5%
    line_amount         REAL NOT NULL,   -- excl. VAT
    UNIQUE (sales_order_id, line_no)
);

CREATE TABLE deliveries (
    delivery_id     INTEGER PRIMARY KEY,
    delivery_number TEXT NOT NULL UNIQUE,
    sales_order_id  INTEGER NOT NULL UNIQUE REFERENCES sales_orders(sales_order_id),
    warehouse_id    INTEGER NOT NULL REFERENCES warehouses(warehouse_id),
    ship_date       TEXT NOT NULL
);

CREATE TABLE sales_invoices (
    invoice_id     INTEGER PRIMARY KEY,
    invoice_number TEXT NOT NULL UNIQUE,
    sales_order_id INTEGER NOT NULL UNIQUE REFERENCES sales_orders(sales_order_id),
    delivery_id    INTEGER NOT NULL REFERENCES deliveries(delivery_id),
    customer_id    INTEGER NOT NULL REFERENCES customers(customer_id),
    invoice_date   TEXT NOT NULL,
    due_date       TEXT NOT NULL,
    subtotal       REAL NOT NULL,
    vat_amount     REAL NOT NULL,
    total_amount   REAL NOT NULL,
    status         TEXT NOT NULL CHECK (status IN ('OPEN', 'PARTIALLY_PAID', 'PAID'))  -- as of dataset end date
);

CREATE TABLE customer_payments (
    payment_id     INTEGER PRIMARY KEY,
    payment_number TEXT NOT NULL UNIQUE,
    invoice_id     INTEGER NOT NULL REFERENCES sales_invoices(invoice_id),
    customer_id    INTEGER NOT NULL REFERENCES customers(customer_id),
    payment_date   TEXT NOT NULL,
    amount         REAL NOT NULL CHECK (amount > 0),
    method         TEXT NOT NULL CHECK (method IN ('TRANSFER', 'CHEQUE', 'CASH'))
);

-- ============ Procure-to-pay ============

CREATE TABLE purchase_requisitions (
    requisition_id     INTEGER PRIMARY KEY,
    requisition_number TEXT NOT NULL UNIQUE,
    source             TEXT NOT NULL CHECK (source IN ('AUTO_REORDER', 'EMERGENCY')),
    requested_by       INTEGER NOT NULL REFERENCES employees(employee_id),
    warehouse_id       INTEGER NOT NULL REFERENCES warehouses(warehouse_id),
    supplier_id        INTEGER NOT NULL REFERENCES suppliers(supplier_id),  -- suggested supplier
    request_date       TEXT NOT NULL,
    estimated_amount   REAL NOT NULL,     -- excl. VAT, at supplier price-list cost
    approval_level     TEXT NOT NULL CHECK (approval_level IN ('AUTO', 'PURCHASING_MANAGER', 'MANAGING_DIRECTOR')),
    status             TEXT NOT NULL CHECK (status IN ('PENDING_APPROVAL', 'CONVERTED', 'REJECTED')),
    approver_id        INTEGER REFERENCES employees(employee_id),            -- NULL for AUTO
    decision_date      TEXT,
    rejection_reason   TEXT
);

CREATE TABLE purchase_requisition_lines (
    requisition_line_id INTEGER PRIMARY KEY,
    requisition_id      INTEGER NOT NULL REFERENCES purchase_requisitions(requisition_id),
    line_no             INTEGER NOT NULL,
    product_id          INTEGER NOT NULL REFERENCES products(product_id),
    quantity            INTEGER NOT NULL CHECK (quantity > 0),
    estimated_unit_cost REAL NOT NULL,
    UNIQUE (requisition_id, line_no)
);

CREATE TABLE rfqs (
    rfq_id              INTEGER PRIMARY KEY,
    rfq_number          TEXT NOT NULL UNIQUE,
    product_id          INTEGER NOT NULL REFERENCES products(product_id),
    buyer_id            INTEGER NOT NULL REFERENCES employees(employee_id),
    annual_quantity     INTEGER NOT NULL,  -- volume the quote is for
    issue_date          TEXT NOT NULL,
    response_due_date   TEXT NOT NULL,
    suppliers_invited   INTEGER NOT NULL,
    status              TEXT NOT NULL CHECK (status IN ('OPEN', 'AWARDED', 'CANCELLED')),
    awarded_supplier_id INTEGER REFERENCES suppliers(supplier_id),
    award_date          TEXT,
    previous_unit_cost  REAL,              -- preferred supplier's price before the RFQ
    awarded_unit_cost   REAL,
    cancel_reason       TEXT
);

CREATE TABLE rfq_quotes (
    quote_id       INTEGER PRIMARY KEY,
    rfq_id         INTEGER NOT NULL REFERENCES rfqs(rfq_id),
    supplier_id    INTEGER NOT NULL REFERENCES suppliers(supplier_id),
    quote_date     TEXT NOT NULL,
    unit_price     REAL NOT NULL,
    lead_time_days INTEGER NOT NULL,
    min_order_qty  INTEGER NOT NULL,
    valid_until    TEXT NOT NULL,
    score          REAL,                   -- evaluation: price × lead-time × delivery-history penalty (lower wins)
    status         TEXT NOT NULL CHECK (status IN ('SUBMITTED', 'AWARDED', 'LOST')),
    UNIQUE (rfq_id, supplier_id)
);

CREATE TABLE purchase_orders (
    purchase_order_id INTEGER PRIMARY KEY,
    po_number         TEXT NOT NULL UNIQUE,
    supplier_id       INTEGER NOT NULL REFERENCES suppliers(supplier_id),
    requisition_id    INTEGER NOT NULL UNIQUE REFERENCES purchase_requisitions(requisition_id),
    buyer_id          INTEGER NOT NULL REFERENCES employees(employee_id),
    warehouse_id      INTEGER NOT NULL REFERENCES warehouses(warehouse_id),
    order_date        TEXT NOT NULL,
    expected_date     TEXT NOT NULL,
    status            TEXT NOT NULL CHECK (status IN ('OPEN', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED_SHORT')),
    subtotal          REAL NOT NULL,
    vat_amount        REAL NOT NULL,
    total_amount      REAL NOT NULL
);

CREATE TABLE purchase_order_lines (
    po_line_id        INTEGER PRIMARY KEY,
    purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(purchase_order_id),
    line_no           INTEGER NOT NULL,
    product_id        INTEGER NOT NULL REFERENCES products(product_id),
    quantity          INTEGER NOT NULL CHECK (quantity > 0),
    unit_cost         REAL NOT NULL,
    line_amount       REAL NOT NULL,
    received_quantity INTEGER NOT NULL,  -- accepted into stock (excl. rejected units)
    UNIQUE (purchase_order_id, line_no)
);

CREATE TABLE goods_receipts (
    goods_receipt_id  INTEGER PRIMARY KEY,
    gr_number         TEXT NOT NULL UNIQUE,
    purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(purchase_order_id),  -- a PO can arrive in several deliveries
    delivery_no       INTEGER NOT NULL,
    warehouse_id      INTEGER NOT NULL REFERENCES warehouses(warehouse_id),
    receipt_date      TEXT NOT NULL,
    received_by       INTEGER NOT NULL REFERENCES employees(employee_id)
);

CREATE TABLE goods_receipt_lines (
    gr_line_id        INTEGER PRIMARY KEY,
    goods_receipt_id  INTEGER NOT NULL REFERENCES goods_receipts(goods_receipt_id),
    po_line_id        INTEGER NOT NULL REFERENCES purchase_order_lines(po_line_id),
    product_id        INTEGER NOT NULL REFERENCES products(product_id),
    quantity_received INTEGER NOT NULL,  -- delivered
    quantity_rejected INTEGER NOT NULL,  -- damaged / wrong; returned, never enters stock
    quantity_accepted INTEGER NOT NULL,
    rejection_reason  TEXT,
    unit_cost         REAL NOT NULL
);

CREATE TABLE supplier_invoices (
    supplier_invoice_id   INTEGER PRIMARY KEY,
    document_number       TEXT NOT NULL UNIQUE,   -- internal AP voucher number
    supplier_invoice_ref  TEXT NOT NULL,          -- supplier's own invoice number
    supplier_id           INTEGER NOT NULL REFERENCES suppliers(supplier_id),
    purchase_order_id     INTEGER NOT NULL REFERENCES purchase_orders(purchase_order_id),
    goods_receipt_id      INTEGER NOT NULL UNIQUE REFERENCES goods_receipts(goods_receipt_id),
    invoice_date          TEXT NOT NULL,
    due_date              TEXT NOT NULL,
    billed_subtotal       REAL NOT NULL,          -- as invoiced by the supplier
    billed_vat_amount     REAL NOT NULL,
    billed_total_amount   REAL NOT NULL,
    receipt_value         REAL NOT NULL,          -- accepted qty × PO price (what the goods receipt says we owe)
    match_status          TEXT NOT NULL CHECK (match_status IN ('MATCHED', 'WITHIN_TOLERANCE', 'EXCEPTION')),
    exception_type        TEXT CHECK (exception_type IN ('PRICE', 'QUANTITY', 'PRICE_AND_QUANTITY')),
    hold_reason           TEXT,
    resolution            TEXT CHECK (resolution IN ('AUTO_APPROVED', 'SUPPLIER_CORRECTED', 'VARIANCE_ACCEPTED')),  -- NULL while on hold
    approved_date         TEXT,
    approved_by           INTEGER REFERENCES employees(employee_id),  -- buyer who resolved an exception
    subtotal              REAL,                   -- approved payable amounts; NULL while on hold
    vat_amount            REAL,
    total_amount          REAL,
    price_variance        REAL,                   -- subtotal − receipt_value, posted to 5200 PPV
    status                TEXT NOT NULL CHECK (status IN ('ON_HOLD', 'OPEN', 'PAID'))  -- as of dataset end date
);

CREATE TABLE supplier_invoice_lines (
    supplier_invoice_line_id INTEGER PRIMARY KEY,
    supplier_invoice_id      INTEGER NOT NULL REFERENCES supplier_invoices(supplier_invoice_id),
    line_no                  INTEGER NOT NULL,
    gr_line_id               INTEGER NOT NULL REFERENCES goods_receipt_lines(gr_line_id),
    po_line_id               INTEGER NOT NULL REFERENCES purchase_order_lines(po_line_id),
    product_id               INTEGER NOT NULL REFERENCES products(product_id),
    quantity_billed          INTEGER NOT NULL,
    unit_price_billed        REAL NOT NULL,
    line_amount_billed       REAL NOT NULL,
    quantity_accepted        INTEGER NOT NULL,   -- from the goods receipt
    po_unit_cost             REAL NOT NULL,      -- from the purchase order
    match_result             TEXT NOT NULL CHECK (match_result IN ('OK', 'PRICE', 'QUANTITY', 'PRICE_AND_QUANTITY')),
    UNIQUE (supplier_invoice_id, line_no)
);

CREATE TABLE supplier_payments (
    supplier_payment_id INTEGER PRIMARY KEY,
    payment_number      TEXT NOT NULL UNIQUE,
    supplier_invoice_id INTEGER NOT NULL REFERENCES supplier_invoices(supplier_invoice_id),
    supplier_id         INTEGER NOT NULL REFERENCES suppliers(supplier_id),
    payment_date        TEXT NOT NULL,
    amount              REAL NOT NULL CHECK (amount > 0),
    method              TEXT NOT NULL CHECK (method IN ('TRANSFER', 'CHEQUE'))
);

-- ============ Inventory ============

CREATE TABLE inventory_transactions (
    inventory_txn_id INTEGER PRIMARY KEY,
    txn_date         TEXT NOT NULL,
    product_id       INTEGER NOT NULL REFERENCES products(product_id),
    warehouse_id     INTEGER NOT NULL REFERENCES warehouses(warehouse_id),
    txn_type         TEXT NOT NULL CHECK (txn_type IN ('OPENING', 'RECEIPT', 'SHIPMENT', 'ADJUSTMENT')),
    quantity         INTEGER NOT NULL,   -- signed: + in, - out
    unit_cost        REAL NOT NULL,      -- moving-average cost (out) or PO cost (in)
    total_cost       REAL NOT NULL,      -- signed
    reference_type   TEXT,               -- DELIVERY | GOODS_RECEIPT | CYCLE_COUNT | OPENING
    reference_id     INTEGER
);

-- ============ General ledger ============

CREATE TABLE journal_entries (
    journal_entry_id INTEGER PRIMARY KEY,
    entry_number     TEXT NOT NULL UNIQUE,
    entry_date       TEXT NOT NULL,
    source_type      TEXT NOT NULL,      -- OPENING | SALES_INVOICE | DELIVERY | CUSTOMER_PAYMENT | GOODS_RECEIPT | SUPPLIER_INVOICE (posted at approval) | SUPPLIER_PAYMENT | INVENTORY_ADJ | PAYROLL | EXPENSE | VAT_RETURN
    source_id        INTEGER,
    description      TEXT NOT NULL
);

CREATE TABLE journal_lines (
    journal_line_id  INTEGER PRIMARY KEY,
    journal_entry_id INTEGER NOT NULL REFERENCES journal_entries(journal_entry_id),
    line_no          INTEGER NOT NULL,
    account_code     TEXT NOT NULL REFERENCES chart_of_accounts(account_code),
    debit            REAL NOT NULL DEFAULT 0,
    credit           REAL NOT NULL DEFAULT 0,
    UNIQUE (journal_entry_id, line_no)
);

-- Helpful indexes
CREATE INDEX ix_so_customer ON sales_orders(customer_id, order_date);
CREATE INDEX ix_sol_product ON sales_order_lines(product_id);
CREATE INDEX ix_inv_customer ON sales_invoices(customer_id, invoice_date);
CREATE INDEX ix_pay_invoice ON customer_payments(invoice_id);
CREATE INDEX ix_pol_product ON purchase_order_lines(product_id);
CREATE INDEX ix_gr_po ON goods_receipts(purchase_order_id);
CREATE INDEX ix_si_po ON supplier_invoices(purchase_order_id);
CREATE INDEX ix_quotes_rfq ON rfq_quotes(rfq_id);
CREATE INDEX ix_itx_prod_wh ON inventory_transactions(product_id, warehouse_id, txn_date);
CREATE INDEX ix_jl_account ON journal_lines(account_code);
CREATE INDEX ix_je_date ON journal_entries(entry_date);
