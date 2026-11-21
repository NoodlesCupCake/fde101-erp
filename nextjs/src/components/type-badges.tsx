import type { UserType } from "@/lib/dal";

const STYLE: Record<UserType, string> = {
  employee: "bg-muted/15 text-foreground",
  manager: "bg-brand/15 text-brand",
  hr: "bg-ok/15 text-ok",
  admin: "bg-danger/15 text-danger",
};
const LABEL: Record<UserType, string> = { employee: "Employee", manager: "Manager", hr: "HR", admin: "Admin" };

export function TypeBadges({ types }: { types: UserType[] }) {
  return (
    <span className="inline-flex flex-wrap gap-1">
      {types.map((t) => (
        <span key={t} className={`rounded-full px-2 py-0.5 text-xs font-medium ${STYLE[t]}`}>{LABEL[t]}</span>
      ))}
    </span>
  );
}
