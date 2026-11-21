"use server";

import { getCurrentEmployee } from "@/lib/dal";
import { createClient } from "@/lib/supabase/server";

export type BadgeCounts = { approvals: number; my_leave: number; requisitions: number };

/** Sidebar notification counts, computed in the database (badge_counts()). Polled by the sidebar. */
export async function getBadgeCounts(): Promise<BadgeCounts> {
  await getCurrentEmployee();
  const supabase = await createClient();
  const { data } = await supabase.rpc("badge_counts").maybeSingle<BadgeCounts>();
  return { approvals: data?.approvals ?? 0, my_leave: data?.my_leave ?? 0, requisitions: data?.requisitions ?? 0 };
}
