"use client";

import { useState } from "react";

/** Collapsible "Show SQL" with a copy button. Shows the query behind a number so anyone can re-run it. */
export function SqlBlock({ title = "Show SQL", sql, note }: { title?: string; sql: string; note?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <details className="group rounded-lg border border-line bg-background/50 text-sm">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-muted hover:text-foreground">
        <span className="font-mono text-xs transition-transform group-open:rotate-90" aria-hidden>▶</span>
        <span className="font-mono text-xs">SQL</span> {title}
      </summary>
      <div className="space-y-2 border-t border-line px-3 py-3">
        {note && <p className="text-xs text-muted">{note}</p>}
        <div className="relative">
          <button type="button" onClick={async () => { await navigator.clipboard.writeText(sql); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
            className="absolute right-2 top-2 rounded-md border border-line bg-surface px-2 py-1 text-xs hover:bg-background">
            {copied ? "Copied ✓" : "Copy"}
          </button>
          <pre className="overflow-x-auto rounded-md bg-surface p-3 pr-20 font-mono text-xs leading-relaxed"><code>{sql}</code></pre>
        </div>
      </div>
    </details>
  );
}
