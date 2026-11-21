export const thb = (n: number | string | null) =>
  n == null ? "–" : Number(n).toLocaleString("en-US", { style: "currency", currency: "THB", maximumFractionDigits: 0 });

export const num = (n: number | null) => (n == null ? "–" : n.toLocaleString("en-US"));

export const date = (d: string | null) =>
  d ? new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "–";
