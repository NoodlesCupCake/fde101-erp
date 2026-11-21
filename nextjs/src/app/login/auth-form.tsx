"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { signIn, signUp, type FormState } from "./actions";

const input =
  "h-10 w-full rounded-md border border-line bg-surface px-3 text-sm outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/20";

function Field({ label, hint, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      <input {...props} className={input} />
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}

function Message({ state }: { state: FormState }) {
  if (state?.error)
    return <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{state.error}</p>;
  if (state?.notice)
    return <p role="status" className="rounded-md border border-ok/30 bg-ok/5 px-3 py-2 text-sm text-ok">{state.notice}</p>;
  return null;
}

function Submit({ pending, children }: { pending: boolean; children: React.ReactNode }) {
  return (
    <button type="submit" disabled={pending}
      className="h-10 w-full rounded-md bg-brand text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-wait disabled:opacity-60">
      {pending ? "Please wait…" : children}
    </button>
  );
}

export function AuthForm({ mode, next, initialError }: { mode: "signin" | "register"; next: string; initialError?: string }) {
  const [signInState, signInAction, signingIn] = useActionState(signIn, initialError ? { error: initialError } : undefined);
  const [signUpState, signUpAction, signingUp] = useActionState(signUp, undefined);
  const [show, setShow] = useState(false);

  if (mode === "register") {
    return (
      <form action={signUpAction} className="space-y-4">
        <Message state={signUpState} />
        <Field label="Employee code" name="username" required autoFocus autoComplete="username"
          defaultValue={signUpState?.username} placeholder="E0001" hint="Only active A-Pro employees can register." />
        <Field label="Password" name="password" type={show ? "text" : "password"} required minLength={8} autoComplete="new-password" hint="At least 8 characters." />
        <Field label="Confirm password" name="confirm" type={show ? "text" : "password"} required minLength={8} autoComplete="new-password" />
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show passwords
        </label>
        <Submit pending={signingUp}>Create account</Submit>
        <p className="text-center text-sm text-muted">
          Already registered? <Link href="/login" className="font-medium text-brand hover:underline">Sign in</Link>
        </p>
      </form>
    );
  }

  return (
    <form action={signInAction} className="space-y-4">
      <Message state={signInState} />
      <input type="hidden" name="next" value={next} />
      <Field label="Username" name="username" required autoFocus autoComplete="username"
        defaultValue={signInState?.username} placeholder="E0001" hint="Your employee code (or work email)." />
      <Field label="Password" name="password" type={show ? "text" : "password"} required autoComplete="current-password" />
      <label className="flex items-center gap-2 text-sm text-muted">
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Show password
      </label>
      <Submit pending={signingIn}>Sign in</Submit>
      <p className="text-center text-sm text-muted">
        New employee? <Link href="/login?mode=register" className="font-medium text-brand hover:underline">Register</Link>
      </p>
    </form>
  );
}
