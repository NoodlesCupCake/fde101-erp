"use server";

import type { MoreRows } from "@/components/infinite-rows";
import { getCurrentEmployee } from "@/lib/dal";
import { parseEmployeeFilters } from "@/lib/employee-filters";
import { employeesPage } from "./data";

export async function loadEmployees(filters: Record<string, string>, cursor: string): Promise<MoreRows> {
  const me = await getCurrentEmployee();
  const { rows, next } = await employeesPage(me, parseEmployeeFilters(filters), cursor);
  return { rows, next };
}
