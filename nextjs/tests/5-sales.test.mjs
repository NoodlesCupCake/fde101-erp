// Workshop 1.8: sales orders. Totals computed in the database; reps see only their own customers' orders.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { api, cents, count, demoLogin, forms, login, notFoundPage, round2, rpc, select, text, writes } from "./helpers.mjs";

const OTHER_REPS_ORDER = 12; // SO25-000012 belongs to rep E0006
const MY_CUSTOMER = 205;     // C00205, Contractor, rep E0005, warehouse BKK
const OTHER_CUSTOMER = 234;  // rep E0006

describe("sales: who sees which orders", () => {
  test("Sales Rep E0005 sees only own customers' orders", async () => {
    const t = await login("E0005");
    const mine = await count("sales_orders", t);
    assert.ok(mine > 500 && mine < 2000, `${mine}`);
    assert.equal(await count("sales_orders", t, "&sales_rep_id=neq.5"), 0);
    assert.equal(await count("customers", t, "&sales_rep_id=neq.5"), 0);
  });
  test("Sales Manager E0004 sees the whole team (every order)", async () => {
    assert.equal(await count("sales_orders", await login("E0004")), await count("sales_orders", await login("E0061")));
  });
  test("Buyer E0023 / HR E0059 (not Sales, not Finance/Warehouse) see no orders", async () => {
    for (const code of ["E0023", "E0059"]) assert.equal(await count("sales_orders", await login(code)), 0, code);
  });
  test("API: E0005 asks for another rep's order, its lines, delivery and invoice by id → nothing", async () => {
    const t = await login("E0005");
    for (const table of ["sales_orders", "sales_order_lines", "deliveries", "sales_invoices"]) {
      assert.deepEqual((await select(`${table}?select=*&sales_order_id=eq.${OTHER_REPS_ORDER}`, t)).data, [], table);
    }
  });
  test("URL: E0005 changes /sales-orders/<id> to another rep's order → not found, no data", async () => {
    const page = await (await demoLogin("E0005")).get(`/sales-orders/${OTHER_REPS_ORDER}`);
    assert.ok(notFoundPage(page), `HTTP ${page.status}`);
    assert.ok(!page.html.includes("SO25-000012"));
  });
  test("the Sales Manager can open that order", async () => {
    const page = await (await demoLogin("E0004")).get(`/sales-orders/${OTHER_REPS_ORDER}`);
    assert.ok(text(page.html).includes("SO25-000012"));
  });
});

describe("sales: list (server-side paging + filters in the URL)", () => {
  test("filters by status, customer, date and rep", async () => {
    const b = await demoLogin("E0004");
    const n = async (qs) => Number(/\(([\d,]+) found\)/.exec(text((await b.get(`/sales-orders${qs}`)).html))[1].replace(/,/g, ""));
    const all = await n("");
    assert.ok(all > 13000);
    assert.ok((await n("?status=CANCELLED")) < all);
    assert.equal(await n(`?customer=${MY_CUSTOMER}`), await count("sales_orders", await login("E0004"), `&customer_id=eq.${MY_CUSTOMER}`));
    assert.equal(await n("?rep=5"), await count("sales_orders", await login("E0005")));
    assert.ok((await n("?from=2026-10-01&to=2026-10-31")) > 0);
  });
  test("a page has 30 rows, not 14k", async () => {
    const html = (await (await demoLogin("E0004")).get("/sales-orders")).html;
    assert.equal((html.match(/href="\/sales-orders\/\d+"/g) ?? []).length, 30);
  });
});

describe("sales: create order rules (refused, nothing is written)", () => {
  const order = (lines, customer = MY_CUSTOMER, code = "E0005") => login(code).then((t) => rpc("create_sales_order", { p_customer_id: customer, p_lines: lines }, t));
  test("discount above the segment cap (Contractor 4% + 5) → refused", async () => {
    const r = await order([{ product_id: 1, quantity: 1, discount_pct: 10 }]);
    assert.equal(r.status, 400); assert.match(r.data, /0–9%/);
  });
  test("another rep's customer → 403", async () => assert.equal((await order([{ product_id: 1, quantity: 1 }], OTHER_CUSTOMER)).status, 403));
  test("same product twice → refused", async () => assert.equal((await order([{ product_id: 1, quantity: 1 }, { product_id: 1, quantity: 2 }])).status, 400));
  test("quantity 0 → refused", async () => assert.equal((await order([{ product_id: 1, quantity: 0 }])).status, 400));
  test("no lines → refused", async () => assert.equal((await order([])).status, 400));
  test("someone outside Sales → 403", async () => assert.equal((await order([{ product_id: 1, quantity: 1 }], MY_CUSTOMER, "E0023")).status, 403));
  test("writing totals directly → 403", async () => {
    const t = await login("E0005");
    assert.equal((await api("/rest/v1/sales_orders?sales_order_id=eq.1", { method: "PATCH", body: { total_amount: 1 }, token: t })).status, 403);
    assert.equal((await api("/rest/v1/sales_orders", { body: { order_number: "HACK" }, token: t })).status, 403);
  });
});

describe("sales: a new order's totals match a hand calculation", writes, () => {
  const lines = [{ product_id: 1, quantity: 10, discount_pct: 4 }, { product_id: 2, quantity: 3, discount_pct: 9 }];
  let o;
  test("E0005 creates an order (the request also sends a fake price, which is ignored)", async () => {
    const r = await rpc("create_sales_order", { p_customer_id: MY_CUSTOMER, p_lines: lines.map((l) => ({ ...l, unit_price: 1, line_amount: 1 })) }, await login("E0005"));
    assert.equal(r.status, 200, JSON.stringify(r.data));
    o = r.data[0];
  });
  test("subtotal / VAT 7% / total = hand calculation from list_price", async () => {
    const prices = Object.fromEntries((await select("products?select=product_id,list_price&product_id=in.(1,2)", await login("E0005"))).data.map((p) => [p.product_id, Number(p.list_price)]));
    const sub = lines.reduce((s, l) => s + round2(l.quantity * prices[l.product_id] * (1 - l.discount_pct / 100)), 0);
    const vat = round2(sub * 0.07);
    assert.equal(cents(o.subtotal), cents(sub));
    assert.equal(cents(o.vat_amount), cents(vat));
    assert.equal(cents(o.total_amount), cents(sub) + cents(vat));
    const stored = (await select(`sales_order_lines?select=unit_price&sales_order_id=eq.${o.sales_order_id}&order=line_no`, await login("E0005"))).data;
    assert.deepEqual(stored.map((l) => Number(l.unit_price)), [prices[1], prices[2]]);
  });
  test("it shows up first in the rep's list, and its page shows ✓ by hand three times", async () => {
    const b = await demoLogin("E0005");
    const list = (await b.get("/sales-orders")).html;
    assert.ok(list.indexOf(`/sales-orders/${o.sales_order_id}"`) > -1 && list.indexOf(`/sales-orders/${o.sales_order_id}"`) === list.search(/\/sales-orders\/\d+"/));
    assert.equal(text((await b.get(`/sales-orders/${o.sales_order_id}`)).html).split("✓ by hand").length - 1, 3);
  });
  test("not enough stock → accepted as a backorder, the short line is reported", async () => {
    const t = await login("E0005");
    const av = (await rpc("sales_available", { p_warehouse_id: 1, p_product_ids: Array.from({ length: 215 }, (_, i) => i + 1) }, t)).data
      .filter((a) => a.available >= 0).sort((a, b) => a.available - b.available)[0];
    const r = await rpc("create_sales_order", { p_customer_id: MY_CUSTOMER, p_lines: [{ product_id: av.product_id, quantity: av.available + 1 }] }, t);
    assert.equal(r.status, 200);
    assert.equal(r.data[0].backorder_lines.length, 1);
  });
  test("the real form creates an order too (Server Action)", async () => {
    const b = await demoLogin("E0005");
    const form = forms((await b.get("/sales-orders/new")).html).find((f) => f.html.includes('name="lines"'));
    const r = await b.post("/sales-orders/new", [...form.hidden.filter(([k]) => k !== "lines"), ["customer_id", String(MY_CUSTOMER)], ["requested_date", ""],
      ["lines", JSON.stringify([{ product_id: 3, quantity: 7, discount_pct: 4 }])]]);
    const id = /\/sales-orders\/(\d+)\?created=1/.exec(r.location + r.html)?.[1];
    assert.ok(id, `HTTP ${r.status} ${r.location}`);
    const t = text((await b.get(`/sales-orders/${id}`)).html);
    const price = Number((await select("products?select=list_price&product_id=eq.3", await login("E0005"))).data[0].list_price);
    const sub = round2(7 * price * 0.96);
    assert.ok(t.includes(sub.toLocaleString("en-US", { minimumFractionDigits: 2 })), `subtotal ${sub}`);
  });
});
