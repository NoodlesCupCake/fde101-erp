import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "./supabase/server";

export type Employee = {
  employee_id: number;
  employee_code: string;
  first_name: string;
  last_name: string;
  email: string;
  job_title: string;
  department: string;
  hire_date: string;
};

/**
 * Data Access Layer: the one place that decides "who is this, and may they be here?"
 * Called by every protected page/layout. Memoized per request with React cache().
 *
 * - No valid Supabase session            → /login
 * - Signed in but NOT an active employee → signed out, /login?error=inactive
 *   (covers: email not in employees, is_active = false, termination_date set,
 *    and employees deactivated AFTER they signed in, because it runs on every request)
 */
export const getCurrentEmployee = cache(async (): Promise<Employee> => {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getClaims();
  if (!auth?.claims) redirect("/login");

  // Same rule the database uses in RLS (public.current_employee_id()).
  const { data, error } = await supabase.rpc("current_employee").maybeSingle<Employee>();
  if (error) throw new Error(`Could not load your employee record: ${error.message}`);
  if (!data) redirect("/auth/signout?reason=inactive");
  return data;
});
