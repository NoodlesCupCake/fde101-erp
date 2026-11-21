// Workshop 1.5: leave requests. Rules live in submit_leave / decide_leave / cancel_leave.
import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { api, demoLogin, login, rpc, select, text, writes } from "./helpers.mjs";

describe("leave: read-only", () => {
  test("balances are computed for every leave type", async () => {
    const { status, data } = await rpc("my_leave_balances", {}, await login("E0005"));
    assert.equal(status, 200);
    assert.deepEqual(data.map((b) => b.leave_type).sort(), ["ANNUAL", "PERSONAL", "SICK"]);
    for (const b of data) assert.equal(Number(b.remaining), Number(b.entitled) - Number(b.used) - Number(b.pending));
  });
  test("writing to leave_requests directly is refused", async () => {
    const r = await api("/rest/v1/leave_requests?employee_id=eq.5", { body: { status: "APPROVED" }, method: "PATCH", token: await login("E0005") });
    assert.equal(r.status, 403);
  });
  test("a colleague who isn't the manager can't see someone's requests", async () => {
    const r = await select("leave_requests?select=request_id&employee_id=eq.5", await login("E0002"));
    assert.deepEqual(r.data, []);
  });
  test("leave pages render", async () => {
    const b = await demoLogin("E0004");
    assert.ok(text((await b.get("/leave")).html).includes("ANNUAL") || text((await b.get("/leave")).html).toLowerCase().includes("annual"));
    assert.equal((await b.get("/leave/approvals")).url, "/leave/approvals");
  });
});

describe("leave: request → decide → cancel", writes, () => {
  let id = null;
  after(async () => { if (id) await rpc("cancel_leave", { p_request_id: id }, await login("E0005")); });

  test("E0005 submits 1 personal day", async () => {
    const t = await login("E0005");
    // a Wednesday ~2 months ahead; try a few weeks in case of a holiday or an existing request
    const d = new Date(); d.setDate(d.getDate() + 60); d.setDate(d.getDate() + ((3 - d.getDay() + 7) % 7));
    let last;
    for (let i = 0; i < 6 && !id; i++, d.setDate(d.getDate() + 7)) {
      const day = d.toISOString().slice(0, 10);
      last = await rpc("submit_leave", { p_type: "PERSONAL", p_start: day, p_end: day, p_half_day: null, p_reason: "automated test" }, t);
      if (last.status === 200) id = last.data;
    }
    assert.ok(id, JSON.stringify(last?.data));
  });
  test("E0005 can't approve their own request", async () => {
    const r = await rpc("decide_leave", { p_request_id: id, p_approve: true, p_comment: "self" }, await login("E0005"));
    assert.equal(r.status, 403);
  });
  test("Admin (not HR, not the manager) can't approve it", async () => {
    const r = await rpc("decide_leave", { p_request_id: id, p_approve: true, p_comment: "" }, await login("E0061"));
    assert.ok(r.status >= 400);
  });
  test("the manager E0004 may decide it", async () => {
    const r = await rpc("can_decide_leave", { p_request_id: id }, await login("E0004"));
    assert.equal(r.data, true);
  });
  test("E0005 cancels it", async () => {
    const r = await rpc("cancel_leave", { p_request_id: id }, await login("E0005"));
    assert.ok(r.status === 200 || r.status === 204, JSON.stringify(r.data));
    const s = await select(`leave_requests?select=status&request_id=eq.${id}`, await login("E0005"));
    assert.equal(s.data[0].status, "CANCELLED");
    id = null;
  });
});
