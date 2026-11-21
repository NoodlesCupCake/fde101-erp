"use server";

import type { MoreRows } from "@/components/infinite-rows";
import { getCurrentEmployee } from "@/lib/dal";
import { employeesPage } from "./data";

export async function loadEmployees(cursor: string): Promise<MoreRows> {
  const me = await getCurrentEmployee();
  const { rows, next } = await employeesPage(me, cursor);
  return { rows, next };
}
