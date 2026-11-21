// Workshop 1.7: procurement. Approval by amount is enforced in the database (functions + trigger on purchase_orders).
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { api, demoLogin, login, notFoundPage, redirectedTo, rpc, select, text, writes } from "./helpers.mjs";

const pending = async (level) => (await select(`purchase_requisitions?select=requisition_id,requested_by&status=eq.PENDING_APPROVAL&approval_level=eq.${level}&limit=1`, await login("E0001"))).data[0];

describe("procurement: who sees it", () => {
  test("Sales Rep E0005 gets no rows from any procurement table", async () => {
    const t = await login("E0005");
    for (const table of ["purchase_orders", "purchase_requisitions", "goods_receipts", "supplier_invoices", "supplier_payments"]) {
      assert.deepEqual((await select(`${table}?select=*&limit=1`, t)).data, [], table);
    }
  });
  test("Sales Rep E0005 is sent away from the pages", async () => {
    const b = await demoLogin("E0005");
    for (const path of ["/procurement", "/procurement/3168", "/procurement/invoices"]) {
      const page = await b.get(path);
      assert.ok(redirectedTo(page, "/?denied=procurement.view") && !page.html.includes("PO26-001039"), path);
    }
  });
  test("Buyer E0023 (Purchasing) and Manager E0004 can read purchase orders", async () => {
    for (const code of ["E0023", "E0004"]) assert.equal((await select("purchase_orders?select=po_number&limit=1", await login(code))).data.length, 1, code);
  });
});

describe("procurement: pages", () => {
  test("PO list with a status filter", async () => {
    const b = await demoLogin("E0023");
    const all = text((await b.get("/procurement")).html), open = text((await b.get("/procurement?status=OPEN")).html);
    assert.match(all, /Purchase orders \([\d,]+ found\)/);
    assert.ok(Number(/\(([\d,]+) found\)/.exec(open)[1].replace(/,/g, "")) < Number(/\(([\d,]+) found\)/.exec(all)[1].replace(/,/g, "")));
  });
  test("PO26-001039 shows the whole flow: requisition (MD) → PO → 2 receipts with rejects → invoice exception → payments", async () => {
    const t = text((await (await demoLogin("E0023")).get("/procurement/3168")).html);
    for (const s of ["PR", "Managing Director", "Goods receipts (2)", "Rejected", "exception", "Payments", "trace PO26-001039 by hand"]) assert.ok(t.toLowerCase().includes(s.toLowerCase()), s);
  });
  test("invoices on hold: 9, each with a hold reason", async () => {
    const { data } = await select("supplier_invoices?select=document_number,hold_reason&status=eq.ON_HOLD", await login("E0023"));
    assert.equal(data.length, 9);
    assert.ok(data.every((i) => i.hold_reason));
    const page = (await (await demoLogin("E0023")).get("/procurement/invoices")).html;
    for (const i of data) assert.ok(page.includes(i.document_number), i.document_number);
  });
  test("supplier scorecard: one row per supplier with on-time / rejection / exception %", async () => {
    const t = await login("E0023");
    const { data } = await rpc("supplier_scorecard", {}, t);
    const suppliers = (await select("suppliers?select=supplier_id", t)).data;
    assert.equal(data.length, suppliers.length);
    assert.ok(data.every((r) => r.on_time_pct === null || (r.on_time_pct >= 0 && r.on_time_pct <= 100)));
  });
  test("a PO id that doesn't exist is a 404", async () => {
    assert.ok(notFoundPage(await (await demoLogin("E0023")).get("/procurement/999999")));
  });
});

describe("procurement: approval by amount (no writes)", () => {
  test("every existing PO over ฿300k was approved by the Managing Director", async () => {
    const { data } = await select("purchase_requisitions?select=approver_id&status=eq.CONVERTED&estimated_amount=gt.300000", await login("E0001"));
    assert.ok(data.length > 0 && data.every((r) => r.approver_id === 1));
  });
  test("every existing PO of ฿50k–300k was approved by the Purchasing Manager or the MD", async () => {
    const { data } = await select("purchase_requisitions?select=approver_id&status=eq.CONVERTED&estimated_amount=gte.50000&estimated_amount=lte.300000", await login("E0001"));
    assert.ok(data.length > 0 && data.every((r) => [1, 22].includes(r.approver_id)));
  });
  test("Purchasing Manager can't approve an over-฿300k requisition", async () => {
    const r = await pending("MANAGING_DIRECTOR");
    assert.ok(r, "needs a pending MD-level requisition in the data");
    const res = await rpc("decide_requisition", { p_requisition_id: r.requisition_id, p_approve: true }, await login("E0022"));
    assert.equal(res.status, 403);
    assert.match(String(res.data), /Managing Director/);
  });
  for (const [who, code] of [["Admin", "E0061"], ["Buyer", "E0023"], ["Sales Manager", "E0004"]]) {
    test(`${who} can't approve a ฿50k–300k requisition`, async () => {
      const r = await pending("PURCHASING_MANAGER");
      const res = await rpc("decide_requisition", { p_requisition_id: r.requisition_id, p_approve: true }, await login(code));
      assert.equal(res.status, 403);
    });
  }
  test("inserting a purchase order directly is refused", async () => {
    const r = await pending("MANAGING_DIRECTOR");
    const res = await api("/rest/v1/purchase_orders", { token: await login("E0022"), body: { po_number: "HACK", supplier_id: 1, requisition_id: r.requisition_id,
      buyer_id: 23, warehouse_id: 1, order_date: "2026-11-21", expected_date: "2026-11-28", status: "OPEN", subtotal: 1, vat_amount: 0, total_amount: 1 } });
    assert.equal(res.status, 403);
  });
  test("marking a requisition approved directly is refused", async () => {
    const r = await pending("MANAGING_DIRECTOR");
    const res = await api(`/rest/v1/purchase_requisitions?requisition_id=eq.${r.requisition_id}`, { method: "PATCH", body: { status: "CONVERTED", approver_id: 1 }, token: await login("E0022") });
    assert.equal(res.status, 403);
  });
  test("an employee outside Warehouse/Purchasing can't create a requisition", async () => {
    const res = await rpc("submit_requisition", { p_product_id: 137, p_warehouse_id: 1, p_supplier_id: 9, p_quantity: 1 }, await login("E0005"));
    assert.equal(res.status, 403);
  });
});

describe("procurement: requisition → approval (writes; rejected at the end, so no PO is created)", writes, () => {
  const made = [];
  after(async () => { // reject anything left pending by a failed run
    for (const id of made) await rpc("decide_requisition", { p_requisition_id: id, p_approve: false, p_reason: "automated test" }, await login("E0001"));
  });
  /** A product at BKK with a preferred supplier and no pending requisition, plus a quantity worth about `amount`. */
  async function pick(amount) {
    const t = await login("E0023");
    const busy = new Set((await select("purchase_requisitions?select=purchase_requisition_lines(product_id)&status=eq.PENDING_APPROVAL&warehouse_id=eq.1", t)).data
      .flatMap((r) => r.purchase_requisition_lines.map((l) => l.product_id)));
    const sp = (await select("supplier_products?select=product_id,supplier_id,unit_cost,min_order_qty&is_preferred=eq.true&order=unit_cost.desc", t)).data
      .find((s) => !busy.has(s.product_id));
    return { p_product_id: sp.product_id, p_warehouse_id: 1, p_supplier_id: sp.supplier_id, p_quantity: Math.max(sp.min_order_qty, Math.ceil(amount / Number(sp.unit_cost))) };
  }
  test("Buyer: ~฿105k → routed to the Purchasing Manager; PM rejects with a reason", async () => {
    const r = await rpc("submit_requisition", await pick(105000), await login("E0023"));
    assert.equal(r.status, 200, JSON.stringify(r.data)); made.push(r.data);
    const row = (await select(`purchase_requisitions?select=approval_level,status,approver_id&requisition_id=eq.${r.data}`, await login("E0023"))).data[0];
    assert.deepEqual(row, { approval_level: "PURCHASING_MANAGER", status: "PENDING_APPROVAL", approver_id: 22 });
    assert.equal((await rpc("decide_requisition", { p_requisition_id: r.data, p_approve: false, p_reason: "" }, await login("E0022"))).status, 400, "reason required");
    assert.equal((await rpc("decide_requisition", { p_requisition_id: r.data, p_approve: false, p_reason: "automated test" }, await login("E0022"))).status, 200);
    made.pop();
  });
  test("Buyer: ~฿320k → Managing Director only; PM refused, MD rejects", async () => {
    const r = await rpc("submit_requisition", await pick(320000), await login("E0023"));
    assert.equal(r.status, 200, JSON.stringify(r.data)); made.push(r.data);
    assert.equal((await rpc("decide_requisition", { p_requisition_id: r.data, p_approve: true }, await login("E0022"))).status, 403);
    assert.equal((await rpc("decide_requisition", { p_requisition_id: r.data, p_approve: false, p_reason: "automated test" }, await login("E0001"))).status, 200);
    made.pop();
    const po = await select(`purchase_orders?select=po_number&requisition_id=eq.${r.data}`, await login("E0023"));
    assert.deepEqual(po.data, [], "a rejected requisition never becomes a PO");
  });
});
