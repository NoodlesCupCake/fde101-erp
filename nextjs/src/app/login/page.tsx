import type { Metadata } from "next";
import { ThemeToggle } from "@/components/theme-toggle";
import { AuthForm } from "./auth-form";

export const metadata: Metadata = { title: "Sign in · A-ERP" };

const ERRORS: Record<string, string> = {
  switch: "Couldn't switch account. Pick a demo user or sign in below.",
  inactive: "Your account is not linked to an active employee, so you were signed out.",
  confirm: "That confirmation link is invalid or has expired. Sign in again or register again.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const mode = sp.mode === "register" ? "register" : "signin";
  const next = typeof sp.next === "string" ? sp.next : "/";
  const error = typeof sp.error === "string" ? ERRORS[sp.error] : undefined;

  return (
    <main className="relative flex min-h-dvh items-center justify-center px-4 py-10">
      <ThemeToggle className="absolute right-4 top-4" />
      <div className="animate-rise w-full max-w-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-brand text-lg font-bold text-white" aria-hidden>A</div>
          <div className="leading-tight">
            <div className="font-semibold">A-ERP</div>
            <div className="text-xs text-muted">A-Pro Distribution · Employees only</div>
          </div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-6 shadow-sm">
          <h1 className="text-lg font-semibold">{mode === "register" ? "Register" : "Sign in"}</h1>
          <p className="mb-5 mt-1 text-sm text-muted">
            {mode === "register" ? "Create an account with your employee code." : "Use your employee code and password."}
          </p>
          <AuthForm key={mode} mode={mode} next={next} initialError={error} />
        </div>
        <p className="mt-4 text-center text-xs text-muted">Prototype with synthetic data only.</p>
      </div>
    </main>
  );
}
