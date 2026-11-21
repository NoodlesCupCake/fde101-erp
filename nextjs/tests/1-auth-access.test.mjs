// Workshops 1.1–1.4: sign-in, signed-out visitors, user types, role × action matrix, salary in the database.
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { api, Browser, demoLogin, forms, login, redirectedTo, rpc, select, text } from "./helpers.mjs";

const ROLE = { employee: "E0005", manager: "E0004", hr: "E0059", admin: "E0061" };

describe("signed-out visitor", () => {
  for (const path of ["/", "/employees", "/sales-orders", "/stock", "/procurement", "/admin/users"]) {
    test(`${path} sends you to /login`, async () => {
      const page = await new Browser().get(path);
      assert.ok(page.url.startsWith("/login"), `ended at ${page.url}`);
    });
  }
  test("the API returns no employees without a login", async () => {
    const r = await select("employees?select=employee_code&limit=1");
    assert.ok(r.status !== 200 || r.data.length === 0, JSON.stringify(r.data));
  });
});

describe("sign-in", () => {
  test("wrong password shows an error and no session", async () => {
    const b = new Browser();
    const { html } = await b.get("/login");
    const form = forms(html).find((f) => f.html.includes('name="password"'));
    await b.post("/login", [...form.hidden, ["username", "E0005"], ["password", "wrong-password"]]);
    assert.ok((await b.get("/")).url.startsWith("/login"));
  });
  for (const code of ["E0005", "E0004", "E0059", "E0057", "E0061", "E0023", "E0022", "E0001"]) {
    test(`demo preset ${code} signs in`, async () => {
      const b = await demoLogin(code);
      const page = await b.get("/profile");
      assert.equal(page.url, "/profile");
      assert.ok(text(page.html).includes(code));
    });
  }
  test("sign out ends the session", async () => {
    const b = await demoLogin("E0005", { fresh: true });
    await b.post("/auth/signout", []);
    assert.ok((await b.get("/")).url.startsWith("/login"));
  });
});

describe("salary is enforced in the database", () => {
  for (const [role, code] of Object.entries(ROLE)) {
    test(`${role}: reading employees.monthly_salary directly is refused`, async () => {
      const r = await select("employees?select=employee_code,monthly_salary&employee_code=eq.E0001", await login(code));
      assert.notEqual(r.status, 200, JSON.stringify(r.data));
    });
    test(`${role}: sees own salary${role === "hr" ? " and everyone else's" : " only"}`, async () => {
      const t = await login(code);
      const me = (await rpc("current_employee", {}, t)).data[0];
      const { data } = await rpc("visible_salaries", {}, t);
      assert.ok(data.some((r) => r.employee_id === me.employee_id), "own salary missing");
      const others = data.filter((r) => r.employee_id !== me.employee_id).length;
      if (role === "hr") assert.ok(others > 50, `HR sees ${others} others`); else assert.equal(others, 0);
    });
  }
});

describe("user types and admin actions", () => {
  test("types come from the database (E0057 is Manager + HR)", async () => {
    const { data } = await rpc("current_employee", {}, await login("E0057"));
    assert.deepEqual([...data[0].types].sort(), ["employee", "hr", "manager"]);
  });
  for (const role of ["employee", "manager", "hr"]) {
    test(`${role} can't make themselves admin`, async () => {
      const t = await login(ROLE[role]);
      const me = (await rpc("current_employee", {}, t)).data[0];
      const r = await api("/rest/v1/employee_roles", { body: { employee_id: me.employee_id, role: "admin" }, token: t });
      assert.ok(r.status >= 400, `HTTP ${r.status}`);
    });
    test(`${role} can't create a user`, async () => {
      const r = await rpc("admin_create_employee", { p_first_name: "No", p_last_name: "Way", p_email: "no.way@example.com", p_department_id: 2,
        p_job_title: "Test", p_manager_id: 4, p_monthly_salary: 1, p_hire_date: null }, await login(ROLE[role]));
      assert.ok(r.status >= 400, `HTTP ${r.status}`);
    });
    test(`${role} can't edit the permission matrix`, async () => {
      const r = await api("/rest/v1/role_permissions?role=eq.employee&permission=eq.salary.read_all",
        { body: { allowed: true }, method: "PATCH", token: await login(ROLE[role]) });
      assert.ok(r.status >= 400 || (Array.isArray(r.data) && r.data.length === 0), `HTTP ${r.status} ${JSON.stringify(r.data)}`);
    });
  }
  test("a manager sees their team; an employee has none", async () => {
    const mgr = await select("employees?select=employee_code&manager_id=eq.4&is_active=eq.true", await login("E0004"));
    assert.ok(mgr.data.length >= 17);
    const { data } = await rpc("current_employee", {}, await login("E0005"));
    assert.ok(!data[0].types.includes("manager"));
  });
  test("/admin/users is only for admins", async () => {
    assert.equal((await (await demoLogin("E0061")).get("/admin/users")).url, "/admin/users");
    const page = await (await demoLogin("E0005")).get("/admin/users");
    assert.ok(redirectedTo(page, "/?denied=users.manage") || !text(page.html).includes("Create user"));
  });
});
