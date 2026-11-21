"use server";

import type { MoreRows } from "@/components/infinite-rows";
import { requirePermission } from "@/lib/dal";
import { parseEmployeeFilters } from "@/lib/employee-filters";
import { adminUsersPage } from "./data";

export async function loadAdminUsers(filters: Record<string, string>, cursor: string): Promise<MoreRows> {
  const me = await requirePermission("users.manage");
  return adminUsersPage(me, parseEmployeeFilters(filters), cursor);
}
