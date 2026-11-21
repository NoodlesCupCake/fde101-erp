import type { Session } from "@supabase/supabase-js";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "./supabase";

export interface User {
  id: string;
  email: string;
  display_name: string | null;
  role: "user" | "admin";
}

interface AuthState {
  user: User | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

/** Fired by the API client on any 401 so the app drops to the login page. */
export const UNAUTHORIZED_EVENT = "aerp:unauthorized";

const Ctx = createContext<AuthState | null>(null);

function toUser(session: Session | null): User | null {
  const u = session?.user;
  if (!u) return null;
  const meta = u.user_metadata ?? {};
  return {
    id: u.id,
    email: u.email ?? "",
    display_name: meta.display_name ?? meta.full_name ?? meta.name ?? null,
    role: u.app_metadata?.role === "admin" ? "admin" : "user",
  };
}

function friendlyError(message: string) {
  if (/invalid login credentials/i.test(message)) return "Email or password is incorrect.";
  if (/email not confirmed/i.test(message)) return "This email isn't confirmed yet. Check your inbox or ask an administrator.";
  if (/failed to fetch|network/i.test(message)) return "Can't reach Supabase. Check your internet connection.";
  return message;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fires once with the stored session (INITIAL_SESSION), then on every sign-in, sign-out and token refresh.
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(toUser(session));
      setLoading(false);
      if (event === "SIGNED_OUT") qc.clear(); // never show another user's cached data
    });
    // The API rejected our token (revoked user, expired refresh): sign out locally.
    const onUnauthorized = () => void supabase.auth.signOut({ scope: "local" });
    addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => {
      data.subscription.unsubscribe();
      removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    };
  }, [qc]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error(friendlyError(error.message));
    qc.clear();
    setUser(toUser(data.session));
  }, [qc]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut(); // revokes the refresh token on Supabase, clears local storage
    qc.clear();
    setUser(null);
  }, [qc]);

  const value = useMemo(() => ({ user, loading, signIn, signOut }), [user, loading, signIn, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside <AuthProvider>");
  return v;
}
