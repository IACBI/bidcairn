import { type ReactNode } from "react";
import { Check } from "lucide-react";
import type { FactKey } from "../../shared/model.js";
export const money = (cents: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 ? 2 : 0,
  }).format(cents / 100);
export const labels: Record<FactKey, string> = {
  totalCents: "All-inclusive price",
  deliveryDays: "Delivery time",
  warrantyDays: "Defect warranty",
  depositPercent: "Upfront deposit",
  slaHours: "Support response",
};
export const criterionLabels = {
  price: "Price",
  scope: "Scope coverage",
  delivery: "Delivery",
  warranty: "Warranty",
  upfront: "Upfront exposure",
};
export function formatFact(key: FactKey, value: number | null) {
  if (value === null) return "Not stated";
  if (key === "totalCents") return money(value);
  if (key === "depositPercent") return `${value}%`;
  return `${value} ${key === "slaHours" ? "hours" : "days"}`;
}
export function Mark({ children }: { children: ReactNode }) {
  return (
    <span className="status-mark">
      <Check size={12} />
      {children}
    </span>
  );
}
