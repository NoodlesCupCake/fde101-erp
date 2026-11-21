"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type FormState = { error?: string; notice?: string; username?: string } | undefined;

const BAD_LOGIN = "Username or password is incorrect.";

/** Only allow in-app relative redirects (no open redirect via ?next=). */
function safeNext(next: FormDataEntryValue | null) {
  const n = typeof next === "string" ? next : "";
  return n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/login") ? n : "/";
}

/** "E0001" → that active employee's work email (via public.login_email_for); an email is passed through. */
async function resolveEmail(supabase: Awaited<ReturnType<typeof createClient>>, username: string) {
  if (username.includes("@")) return username.toLowerCase();
  const { data, error } = await supabase.rpc("login_email_for", { p_username: username });
  if (error) console.error("[signIn] login_email_for failed:", error.code, error.message);
  return (data as string | null) ?? null;
}

function mask(email: string) {
  const [user, domain] = email.split("@");
  return `${user.slice(0, 2)}${"•".repeat(Math.max(1, user.length - 2))}@${domain}`;
}

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!username || !password) return { error: "Enter your username and password.", username };

  const supabase = await createClient();
  const email = await resolveEmail(supabase, username);
  // Same message for "unknown username" and "wrong password", so the form doesn't confirm which part was wrong.
  if (!email) {
    console.warn("[signIn] no active employee for username");
    return { error: BAD_LOGIN, username };
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    // Server log only (never shown to the user): tells "wrong password" apart from config/network problems.
    console.warn("[signIn] signInWithPassword failed:", error.status, error.code, error.message);
    if (error.code === "email_not_confirmed") {
      return { error: `Confirm your email first: check the inbox of ${mask(email)}.`, username };
    }
    if (error.status === 429) return { error: "Too many attempts. Wait a minute and try again.", username };
    return { error: BAD_LOGIN, username };
  }

  // Signed in to Supabase, but is this still an active employee? (email-login path, or deactivated later)
  const { data: employee } = await supabase.rpc("current_employee").maybeSingle();
  if (!employee) {
    await supabase.auth.signOut();
    return { error: "This account is not linked to an active employee.", username };
  }
  redirect(safeNext(formData.get("next")));
}
