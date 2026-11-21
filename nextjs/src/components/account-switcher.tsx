"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { switchAccount } from "@/app/login/actions";
import { DEMO_ACCOUNTS } from "@/lib/demo";

/** Header dropdown: jump to another demo user in one click (the password never reaches the browser). */
export function AccountSwitcher({ current }: { current: string }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    addEventListener("mousedown", close);
    addEventListener("keydown", close);
    return () => { removeEventListener("mousedown", close); removeEventListener("keydown", close); };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}
        className="h-9 whitespace-nowrap rounded-md border border-line px-3 text-sm hover:bg-background">
        {busy ? "Switching…" : "Switch ▾"}
      </button>
      {open && (
        <div role="menu" className="absolute bottom-full left-0 z-50 mb-1 w-72 rounded-lg border border-line bg-surface p-1 shadow-lg">
          <div className="px-3 py-1.5 text-xs text-muted">Switch to a demo account</div>
          <form action={switchAccount} onSubmit={(e) => setBusy(String((e.nativeEvent as SubmitEvent).submitter?.getAttribute("value")))}>
            <input type="hidden" name="next" value={path.startsWith("/admin") ? "/" : path} />
            {DEMO_ACCOUNTS.map((a) => {
              const me = a.code === current;
              return (
                <button key={a.code} type="submit" name="code" value={a.code} role="menuitem" disabled={me || !!busy}
                  className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left ${me ? "bg-brand/10" : "hover:bg-background"} disabled:cursor-default`}>
                  <span>
                    <span className="block text-sm font-medium">{a.label} {me && <span className="text-xs font-normal text-brand">(you)</span>}</span>
                    <span className="block text-xs text-muted">{a.who}</span>
                  </span>
                  <span className="font-mono text-xs text-muted">{busy === a.code ? "…" : a.code}</span>
                </button>
              );
            })}
          </form>
          <form action="/auth/signout" method="post" className="border-t border-line pt-1">
            <button className="w-full rounded-md px-3 py-2 text-left text-sm text-muted hover:bg-background hover:text-foreground">
              Sign in with another account…
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
