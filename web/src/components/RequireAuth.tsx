import { Loader2 } from "lucide-react";
import { Navigate, Outlet, useLocation } from "react-router";
import { useAuth } from "../lib/auth";

/** Gate for every app route: unauthenticated users go to /login and come back afterwards. */
export function RequireAuth() {
  const { user, loading } = useAuth();
  const { pathname, search } = useLocation();
  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center" role="status" aria-label="Checking session">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden />
      </div>
    );
  }
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(pathname + search)}`} replace />;
  return <Outlet />;
}
