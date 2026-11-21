import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** POST from the Sign out button; GET only when the DAL bounces an inactive employee. */
async function signOut(request: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut(); // revokes the refresh token on Supabase and clears the auth cookies
  const url = new URL("/login", request.url);
  if (request.nextUrl.searchParams.get("reason") === "inactive") url.searchParams.set("error", "inactive");
  return NextResponse.redirect(url, { status: 303 });
}

export const POST = signOut;
export const GET = signOut;
