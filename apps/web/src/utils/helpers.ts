/**
 * Pure utility / formatting helpers shared across the entire web app.
 * No React, no API, no business logic — only data transformation.
 */
import Decimal from "decimal.js";
import {
  rowsSchema,
  cleanMoney,
} from "@ledger/contracts";
import type { z } from "zod";

Decimal.set({ precision: 60, rounding: Decimal.ROUND_HALF_UP });
export const D = (v: Decimal.Value) => new Decimal(v);

export type Row = Record<string, unknown>;

export const str = (v: unknown): string => String(v ?? "");
export const arr = (v: unknown): Row[] => rowsSchema.parse(v ?? []);

export function parseCents(s: unknown): bigint {
  const cleaned = cleanMoney(s);
  if (!cleaned) return 0n;
  const neg = cleaned.startsWith("-");
  const clean = neg ? cleaned.slice(1) : cleaned;
  const parts = clean.split(".");
  const whole = parts[0] ? BigInt(parts[0]) : 0n;
  const fracStr = (parts[1] || "").padEnd(2, "0").slice(0, 2);
  const frac = fracStr ? BigInt(fracStr) : 0n;
  const total = whole * 100n + frac;
  return neg ? -total : total;
}

export function parseMoneyNumber(v: unknown): number {
  const c = cleanMoney(v);
  if (!c) return NaN;
  const n = Number(c);
  return isNaN(n) ? NaN : n;
}

export function formatCents(cents: bigint): string {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  const whole = abs / 100n;
  const frac = abs % 100n;
  return (neg ? "-" : "") + whole.toString() + "." + frac.toString().padStart(2, "0");
}

export function rupees(value: unknown): string {
  const s = str(value || "0"),
    negative = s.startsWith("-"),
    [whole, paise = "00"] = s.replace("-", "").split(".");
  const prefix = whole.slice(0, -3),
    last = whole.slice(-3),
    grouped = prefix
      ? prefix.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last
      : last;
  return `${negative ? "−" : ""}₹${grouped}.${paise.replace(/0+$/, "").padEnd(2, "0")}`;
}

export function formatBilledCaption(
  grossVal: unknown,
  revVal: unknown,
  retVal: unknown,
): string {
  const gross = str(grossVal ?? "0.00");
  const rev = str(revVal ?? "0.00");
  const ret = str(retVal ?? "0.00");
  const hasGross = parseFloat(gross) > 0;
  const hasRev = parseFloat(rev) > 0;
  const hasRet = parseFloat(ret) > 0;
  if (!hasGross && !hasRev && !hasRet) return "Total billed today";
  const parts = [`Gross: ${rupees(gross)}`];
  if (hasRev) parts.push(`Rev: ${rupees(rev)}`);
  if (hasRet) parts.push(`Ret: ${rupees(ret)}`);
  if (!hasRev && !hasRet) parts.push("No reversals");
  return parts.join(" · ");
}

export const dateLabel = (s: unknown): string =>
  new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(new Date(str(s).slice(0, 10) + "T12:00:00+05:30"));

export const timeOnlyLabel = (s: unknown): string => {
  if (!s) return "";
  try {
    const d = new Date(String(s));
    if (isNaN(d.getTime())) return "";
    const parts = new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
      timeZone: "Asia/Kolkata",
    }).formatToParts(d);
    const day = parts.find((p) => p.type === "day")?.value;
    const month = parts.find((p) => p.type === "month")?.value;
    const hour = parts.find((p) => p.type === "hour")?.value;
    const minute = parts.find((p) => p.type === "minute")?.value;
    const dayPeriod = (parts.find((p) => p.type === "dayPeriod")?.value || "").toUpperCase();
    return `${day}/${month}  ${hour}:${minute} ${dayPeriod}`;
  } catch {
    return "";
  }
};

export const formatDateTime = (s: unknown): string => {
  if (!s) return "—";
  try {
    const d = new Date(String(s));
    if (isNaN(d.getTime())) return dateLabel(s);
    return new Intl.DateTimeFormat("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "Asia/Kolkata",
    }).format(d);
  } catch {
    return dateLabel(s);
  }
};

export interface TransactionTypeMeta {
  key: string;
  label: string;
  group: string;
  badgeStyle: {
    background: string;
    color: string;
  };
}

export function resolveTransactionType(doc: Row | null | undefined): TransactionTypeMeta {
  if (!doc) {
    return {
      key: "unknown",
      label: "Unknown",
      group: "unknown",
      badgeStyle: { background: "#f1f5f9", color: "#475569" },
    };
  }

  const rawKind = str(doc.type || doc.kind || doc.display_kind || "").toLowerCase();
  const rowData = (doc.data || {}) as Row;
  const method = str(rowData.method || doc.method || "").toLowerCase();
  const isHandover = Boolean(rowData.isHandoverConfirmation || doc.isHandoverConfirmation);

  // 1. Receipts
  if (rawKind === "receipt" || rawKind === "receipt_cash" || rawKind === "receipt_online" || rawKind === "cash_handover") {
    if (isHandover || rawKind === "cash_handover") {
      return {
        key: "cash_handover",
        label: "Cash Handover",
        group: "receipt",
        badgeStyle: { background: "#f0fdf4", color: "#166534" },
      };
    }
    if (method === "online" || rawKind === "receipt_online") {
      return {
        key: "receipt_online",
        label: "Online Receipt",
        group: "receipt",
        badgeStyle: { background: "#f0f9ff", color: "#0369a1" },
      };
    }
    return {
      key: "receipt_cash",
      label: "Cash Receipt",
      group: "receipt",
      badgeStyle: { background: "#f0fdf4", color: "#15803d" },
    };
  }

  // 2. Foods Receipts
  if (rawKind === "foods_receipt" || rawKind === "foods_receipt_cash" || rawKind === "foods_receipt_online") {
    if (method === "online" || rawKind === "foods_receipt_online") {
      return {
        key: "foods_receipt_online",
        label: "Foods Receipt Online",
        group: "foods_receipt",
        badgeStyle: { background: "#f0f9ff", color: "#0284c7" },
      };
    }
    if (method === "cash" || rawKind === "foods_receipt_cash") {
      return {
        key: "foods_receipt_cash",
        label: "Foods Receipt Cash",
        group: "foods_receipt",
        badgeStyle: { background: "#f0fdf4", color: "#15803d" },
      };
    }
    return {
      key: "foods_receipt",
      label: "Foods Receipt (All)",
      group: "foods_receipt",
      badgeStyle: { background: "#f0fdf4", color: "#15803d" },
    };
  }

  // Sony Receipts
  if (rawKind === "sony_receipt" || rawKind === "sony_receipt_cash" || rawKind === "sony_receipt_online") {
    if (method === "online" || rawKind === "sony_receipt_online") {
      return {
        key: "sony_receipt_online",
        label: "Sony Receipt Online",
        group: "sony_receipt",
        badgeStyle: { background: "#f0f9ff", color: "#0284c7" },
      };
    }
    if (method === "cash" || rawKind === "sony_receipt_cash") {
      return {
        key: "sony_receipt_cash",
        label: "Sony Receipt Cash",
        group: "sony_receipt",
        badgeStyle: { background: "#faf5ff", color: "#7c3aed" },
      };
    }
    return {
      key: "sony_receipt",
      label: "Sony Receipt",
      group: "sony_receipt",
      badgeStyle: { background: "#faf5ff", color: "#7c3aed" },
    };
  }

  // 3. Bills
  if (rawKind === "bill") {
    return {
      key: "bill",
      label: "Bill",
      group: "bill",
      badgeStyle: { background: "#eff6ff", color: "#1d4ed8" },
    };
  }

  // 4. Returns
  if (rawKind === "return" || rawKind === "sales_return") {
    return {
      key: "sales_return",
      label: "Sales Return",
      group: "return",
      badgeStyle: { background: "#fef3c7", color: "#b45309" },
    };
  }

  // 5. Expenses
  if (rawKind === "expense") {
    return {
      key: "expense",
      label: "Expense",
      group: "expense",
      badgeStyle: { background: "#fff1f2", color: "#be123c" },
    };
  }

  // 6. Salaries & Loans
  if (rawKind === "salary") {
    return {
      key: "salary",
      label: "Salary",
      group: "salary",
      badgeStyle: { background: "#f5f3ff", color: "#6d28d9" },
    };
  }
  if (rawKind === "loan") {
    return {
      key: "loan",
      label: "Loan",
      group: "loan",
      badgeStyle: { background: "#f5f3ff", color: "#6d28d9" },
    };
  }
  if (rawKind === "employee_receipt") {
    return {
      key: "employee_receipt",
      label: "Employee Receipt",
      group: "receipt",
      badgeStyle: { background: "#f0fdf4", color: "#15803d" },
    };
  }

  // 7. Transfers & Deposits
  if (rawKind === "deposit" || rawKind === "bank_deposit") {
    return {
      key: "bank_deposit",
      label: "Bank Deposit",
      group: "deposit",
      badgeStyle: { background: "#f0f9ff", color: "#0369a1" },
    };
  }
  if (rawKind === "transfer" || rawKind === "cash_transfer") {
    return {
      key: "cash_transfer",
      label: "Cash Transfer",
      group: "transfer",
      badgeStyle: { background: "#f0f9ff", color: "#0369a1" },
    };
  }

  // 8. Reversal
  if (rawKind === "reversal") {
    return {
      key: "reversal",
      label: "Reversal Entry",
      group: "reversal",
      badgeStyle: { background: "#fee2e2", color: "#dc2626" },
    };
  }

  const cleanLabel = rawKind.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return {
    key: rawKind,
    label: cleanLabel || "Other",
    group: rawKind,
    badgeStyle: { background: "#f1f5f9", color: "#475569" },
  };
}
