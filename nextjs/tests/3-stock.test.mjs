// Workshop 1.6: stock dashboard. Stock is derived from inventory_transactions; value must tie to GL 1200.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { cents, demoLogin, login, rpc, select, text } from "./helpers.mjs";

describe("stock", () => {
  test("one row per inventory_policies row (660)", async () => {
    const { data } = await rpc("stock_on_hand", {}, await login("E0004"));
    assert.equal(data.length, 660);
  });
  test("stock value = GL 1200 Inventory (฿16,932,503.93)", async () => {
    const { data } = await rpc("stock_on_hand", {}, await login("E0004"));
    const value = data.reduce((s, r) => s + cents(r.stock_value), 0);
    assert.ok(Math.abs(value - 1693250393) <= data.length, `stock ${value / 100}`); // rows are rounded to cents one by one
  });
  test("below reorder point at BKK = 75 items", async () => {
    const { data } = await rpc("stock_on_hand", { p_warehouse_id: 1 }, await login("E0004"));
    assert.equal(data.filter((r) => r.below_reorder).length, 75);
  });
  test("one SKU by hand: raw movements = dashboard row (PLMB-0004 @ CNX)", async () => {
    const t = await login("E0004");
    const p = (await select("products?select=product_id&sku=eq.PLMB-0004", t)).data[0];
    const moves = (await select(`inventory_transactions?select=quantity,total_cost&product_id=eq.${p.product_id}&warehouse_id=eq.2&txn_date=lte.2026-10-31`, t)).data;
    const row = (await rpc("stock_on_hand", { p_warehouse_id: 2 }, t)).data.find((r) => r.product_id === p.product_id);
    assert.equal(moves.reduce((s, m) => s + m.quantity, 0), row.on_hand);
    assert.equal(Math.round(moves.reduce((s, m) => s + Number(m.total_cost), 0) * 100), cents(row.stock_value));
  });
  test("a Sales Rep (no stock.view, not WHS/PUR/FIN) gets nothing, also via the API", async () => {
    const t = await login("E0005");
    assert.equal((await rpc("stock_on_hand", {}, t)).status, 403);
    assert.deepEqual((await select("inventory_transactions?select=quantity&limit=1", t)).data, []);
  });
  test("dashboard page shows the value and the SQL", async () => {
    const page = await (await demoLogin("E0004")).get("/stock");
    const t = text(page.html);
    assert.ok(t.includes("16,932,504"), "stock value card");
    assert.ok(t.includes("Show SQL") || t.includes("behind the stock value"));
  });
});
