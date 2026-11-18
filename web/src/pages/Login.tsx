import { Eye, EyeOff, Loader2 } from "lucide-react";
import { useId, useState, type SubmitEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { cx } from "../components/ui";
import { useAuth } from "../lib/auth";

/** Only allow in-app relative redirects (no open redirect via ?next=) */
function safeNext(next: string | null) {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login") ? next : "/";
}

export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 py-10">
      <main className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-base font-bold text-primary-foreground" aria-hidden>A</div>
          <div className="leading-tight">
            <div className="font-semibold">A-ERP</div>
            <div className="text-xs text-muted-foreground">A-Pro Distribution · Prototype</div>
          </div>
        </div>
        <div className="rounded-xl border bg-card p-6 shadow-sm">
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
          <div className="mt-5">{children}</div>
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground">Contains synthetic data only.</p>
      </main>
    </div>
  );
}

const inputCls = "h-10 w-full rounded-md border bg-card px-3 text-sm text-foreground transition-colors duration-150 hover:border-muted-foreground/40 aria-invalid:border-destructive";

export function TextField({ label, hint, error, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">{label}</label>
      <input id={id} {...props} aria-invalid={!!error || undefined} aria-describedby={hint || error ? `${id}-d` : undefined} className={inputCls} />
      {(error || hint) && <p id={`${id}-d`} className={cx("text-xs", error ? "text-destructive" : "text-muted-foreground")}>{error ?? hint}</p>}
    </div>
  );
}

export function PasswordField({ label, hint, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const id = useId();
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">{label}</label>
      <div className="relative">
        <input id={id} {...props} type={show ? "text" : "password"} aria-describedby={hint ? `${id}-d` : undefined} className={cx(inputCls, "pr-11")} />
        <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide password" : "Show password"} aria-pressed={show}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground transition-colors duration-150 hover:text-foreground">
          {show ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
        </button>
      </div>
      {hint && <p id={`${id}-d`} className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function SubmitButton({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <button type="submit" disabled={busy} aria-busy={busy}
      className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground transition-opacity duration-150 hover:opacity-90 disabled:cursor-wait disabled:opacity-70">
      {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function FormError({ message }: { message: string | null }) {
  return message ? (
    <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{message}</div>
  ) : null;
}

export function LoginPage() {
  const { user, loading, signIn } = useAuth();
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const next = safeNext(sp.get("next"));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!loading && user) return <Navigate to={next} replace />;

  async function onSubmit(e: SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await signIn(email, password);
      navigate(next, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Sign in" subtitle="Use your A-ERP account to continue.">
      <form onSubmit={onSubmit} className="space-y-4">
        <FormError message={error} />
        <TextField label="Email" type="email" name="email" autoComplete="username" required autoFocus
          value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
        <PasswordField label="Password" name="password" required autoComplete="current-password"
          value={password} onChange={(e) => setPassword(e.target.value)} />
        <SubmitButton busy={busy}>Sign in</SubmitButton>
      </form>
      <p className="mt-5 border-t pt-4 text-center text-xs text-muted-foreground">
        No account? Ask an administrator to create one for you.
      </p>
    </AuthShell>
  );
}
