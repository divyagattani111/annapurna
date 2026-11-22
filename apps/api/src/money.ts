import Decimal from "decimal.js";
Decimal.set({ precision: 60, rounding: Decimal.ROUND_HALF_UP });
export class MoneyError extends Error {}
export const D = (v: Decimal.Value) => new Decimal(v);
export const money = (v: Decimal.Value) =>
  D(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
export const positive = (v: string) => {
  if (!D(v).gt(0)) throw new MoneyError("Amount must be greater than zero");
  return money(v);
};
export function lineAmount(
  q: string,
  conversion: string,
  basis: string,
  rate: string,
  fractional: boolean,
) {
  if (
    !D(q).gt(0) ||
    !D(conversion).gt(0) ||
    !D(basis).gt(0) ||
    D(rate).isNegative()
  )
    throw new MoneyError("Invalid quantity or product configuration");
  if (!fractional && !D(q).isInteger())
    throw new MoneyError("This product requires whole quantities");
  return money(D(q).times(conversion).div(basis).times(rate));
}
export function billLinePricing(
  input: {
    quantity: string;
    rate?: string;
    basis?: string;
    discount?: { type: "fixed" | "percent"; value: string };
  },
  config: {
    conversion: string;
    basis: string;
    rate: string;
    fractional: boolean;
  },
) {
  const rate = input.rate ?? config.rate,
    basis = input.basis ?? config.basis;
  const gross = lineAmount(
    input.quantity,
    config.conversion,
    basis,
    rate,
    config.fractional,
  );
  const discountInput = input.discount?.value ?? "0",
    discountType = input.discount?.type ?? "fixed";
  if (
    D(discountInput).isNegative() ||
    (discountType === "percent" && D(discountInput).gt(100))
  )
    throw new MoneyError(
      "Discount must be nonnegative and percentage cannot exceed 100",
    );
  const discount =
    discountType === "percent"
      ? money(D(gross).times(discountInput).div(100))
      : money(discountInput);
  if (D(discount).gt(gross))
    throw new MoneyError("Discount cannot exceed the line amount");
  return {
    rate,
    basis,
    gross,
    discount,
    discountType,
    discountInput,
    amount: money(D(gross).minus(discount)),
  };
}
export function billPricingNeedsApproval(
  actor: { role: string; capabilities: Record<string, boolean> },
  lines: { rate?: string; basis?: string; discount?: unknown }[],
) {
  return (
    actor.role !== "owner" &&
    ((lines.some((l) => l.rate !== undefined || l.basis !== undefined) &&
      actor.capabilities.editBillPrices !== true) ||
      (lines.some((l) => l.discount !== undefined) &&
        actor.capabilities.applyBillDiscounts !== true))
  );
}
export function returnAmount(
  sold: string,
  total: string,
  returned: string,
  credited: string,
  quantity: string,
) {
  const remaining = D(sold).minus(returned);
  if (!D(quantity).gt(0) || D(quantity).gt(remaining))
    throw new MoneyError("Return exceeds remaining quantity");
  const maxEligible = D(total).minus(credited);
  if (D(quantity).eq(remaining)) {
    return money(maxEligible);
  }
  const unrounded = D(total).times(quantity).div(sold);
  const rounded = D(money(Decimal.min(unrounded, maxEligible)));
  return money(Decimal.min(rounded, maxEligible));
}
export function businessDate(at = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}
export function normalizeDecimal(s: string) {
  if (!/^(?:\d+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d+)?$/.test(s))
    throw new MoneyError("Enter a plain or correctly grouped decimal");
  return D(s.replaceAll(",", "")).toFixed();
}
export { csvCell } from "@ledger/contracts";

export function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  return (
    "{" +
    Object.entries(v as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, x]) => JSON.stringify(k) + ":" + canonical(x))
      .join(",") +
    "}"
  );
}

export function quoteFingerprint(
  date: string,
  salesmanId: string,
  previous: string,
  total: string,
  creditLimit: string | null,
  lines: {
    productId?: string;
    name?: string;
    configurationId?: string | null;
    quantity: string;
    rate?: string;
    basis?: string;
    discount?: unknown;
  }[],
  receipts: unknown[],
  billDiscount: string = "0.00",
) {
  return new Bun.CryptoHasher("sha256")
    .update(
      canonical([
        date,
        salesmanId,
        previous,
        total,
        creditLimit,
        lines.map((l) => [
          l.productId ?? l.name ?? "",
          l.configurationId ?? null,
          l.quantity,
          l.rate ?? null,
          l.basis ?? null,
          l.discount ?? null,
        ]),
        receipts,
        billDiscount,
      ]),
    )
    .digest("hex");
}
