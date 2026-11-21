"use server";

import type { MoreRows } from "@/components/infinite-rows";
import { getCurrentEmployee } from "@/lib/dal";
import { SalesOrderRows, salesOrdersPage } from "./data";

/** Infinite scroll: next page, already rendered. Re-checks the session like any other request. */
export async function loadSalesOrders(cursor: string): Promise<MoreRows> {
  await getCurrentEmployee();
  const page = await salesOrdersPage(cursor);
  return { rows: <SalesOrderRows rows={page.rows} />, next: page.next };
}
