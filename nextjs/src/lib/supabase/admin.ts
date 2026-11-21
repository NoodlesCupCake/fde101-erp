import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Supabase Admin client (secret key). BYPASSES RLS, so only call it from Server Actions that have
 * already checked `requirePermission("users.manage")`. Used only for login-account CRUD (auth.users), which RLS can't cover.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error("SUPABASE_SECRET_KEY is not set");
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
