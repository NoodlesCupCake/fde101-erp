"use server";

import type { MoreRows } from "@/components/infinite-rows";
import { getCurrentEmployee } from "@/lib/dal";
import { parseSalesFilters, SalesOrderRows, salesOrdersPage } from "./data";

/** Infinite scroll: next page with the same filters, already rendered. Re-checks the session and re-cleans filters. */
export async function loadSalesOrders(filters: Record<string, string>, cursor: string): Promise<MoreRows> {
  await getCurrentEmployee();
  const page = await salesOrdersPage(parseSalesFilters(filters), cursor);
  return { rows: <SalesOrderRows rows={page.rows} />, next: page.next };
}
