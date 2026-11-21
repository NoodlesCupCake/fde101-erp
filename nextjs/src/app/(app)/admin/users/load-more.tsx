"use server";

import type { MoreRows } from "@/components/infinite-rows";
import { requireType } from "@/lib/dal";
import { adminUsersPage } from "./data";

export async function loadAdminUsers(cursor: string): Promise<MoreRows> {
  const me = await requireType("admin");
  return adminUsersPage(me, cursor);
}
