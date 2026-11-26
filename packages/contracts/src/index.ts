import { z } from "zod";
export { z };

export function cleanMoney(val: unknown): string {
  if (val === null || val === undefined) return "";
  let s = String(val).trim().replace(/[₹\u20B9,\s]/g, "").replace(/^rs\.?/i, "").trim();
  if (!s) return "";
  const neg = s.startsWith("-");
  if (neg) s = s.slice(1).trim();
  if (s.startsWith(".")) s = "0" + s;
  const parts = s.split(".");
  if (parts.length > 2) return "";
  const whole = parts[0] || "0";
  const frac = parts.length === 2 ? parts[1].slice(0, 2) : "";
  if (!/^\d+$/.test(whole) || (frac && !/^\d+$/.test(frac))) return "";
  const normalizedWhole = whole.replace(/^0+(?=\d)/, "") || "0";
  return (neg ? "-" : "") + normalizedWhole + (parts.length === 2 ? "." + frac.padEnd(2, "0") : ".00");
}

/**
 * Normalize an Indian mobile number to E.164-without-plus format for WhatsApp (91XXXXXXXXXX).
 * Strips all non-digit characters, then:
 *  - 10 digits               → "91" + digits
 *  - 11 digits starting 0    → "91" + digits[1:]
 *  - 12 digits starting 91   → kept as-is
 * Returns null for empty or unrecognizable input.
 */
export function cleanIndianPhone(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  const digits = String(val).replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  return null; // reject ambiguous or invalid lengths
}

export function parseMultiAmounts(val: unknown): string[] {
  if (val === null || val === undefined) return [];
  const raw = String(val).trim();
  if (!raw) return [];
  // Split by plus '+', slash '/', or pipe '|' so amounts with internal commas (e.g. ₹1,500.00) are not fragmented
  const tokens = raw.split(/[+|/]/);
  const results: string[] = [];
  for (const t of tokens) {
    const cleaned = cleanMoney(t);
    if (cleaned && !cleaned.startsWith("-") && cleaned !== "0.00") {
      results.push(cleaned);
    }
  }
  return results;
}

export function cleanDecimal(val: unknown): string {
  if (val === null || val === undefined) return "";
  let s = String(val).trim().replace(/[₹\u20B9,\s]/g, "").replace(/^rs\.?/i, "").trim();
  if (!s) return "";
  const neg = s.startsWith("-");
  if (neg) s = s.slice(1).trim();
  if (s.startsWith(".")) s = "0" + s;
  const parts = s.split(".");
  if (parts.length > 2) return "";
  const whole = parts[0] || "0";
  const frac = parts.length === 2 ? parts[1].slice(0, 8) : "";
  if (!/^\d+$/.test(whole) || (frac && !/^\d+$/.test(frac))) return "";
  const normalizedWhole = whole.replace(/^0+(?=\d)/, "") || "0";
  return (neg ? "-" : "") + normalizedWhole + (parts.length === 2 && frac ? "." + frac : "");
}

export const decimal = z.preprocess(
  (v) => (typeof v === "string" || typeof v === "number" ? cleanDecimal(v) : v),
  z
    .string()
    .regex(
      /^(0|[1-9]\d{0,15})(\.\d{1,8})?$/,
      "Use a plain positive decimal string",
    ),
);
export const money = z.preprocess(
  (v) => (typeof v === "string" || typeof v === "number" ? cleanMoney(v) : v),
  z
    .string()
    .regex(
      /^(0|[1-9]\d{0,15})(\.\d{1,2})?$/,
      "Money must be a decimal string with at most two decimal places",
    ),
);
export const signedMoney = z.preprocess(
  (v) => (typeof v === "string" || typeof v === "number" ? cleanMoney(v) : v),
  z
    .string()
    .regex(/^-?(0|[1-9]\d{0,15})(\.\d{1,2})?$/),
);
export const id = z.uuid();
export const date = z.iso.date();
const note = z.string().max(2000).default("");
const base = { date, note };
export const receipt = z
  .object({
    salesmanId: id,
    customerId: id.optional(),
    amount: money,
    accountId: id,
    method: z.enum(["cash", "online"]),
    actualDate: date,
    reference: z.string().max(200).default(""),
    verified: z.boolean().default(false),
  })
  .strict();
export const bill = z
  .object({
    ...base,
    salesmanId: id,
    customerId: id.optional(),
    expectedQuoteHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    lines: z
      .array(
        z
          .object({
            productId: id.optional(),
            name: z.string().min(1).max(200).optional(),
            code: z.string().max(100).optional(),
            category: z.string().min(1).max(100).default("CG-01 CIGARETTE"),
            quantity: decimal,
            rate: decimal.optional(),
            basis: decimal.optional(),
            discount: z
              .discriminatedUnion("type", [
                z.object({ type: z.literal("fixed"), value: money }).strict(),
                z
                  .object({ type: z.literal("percent"), value: decimal })
                  .strict(),
              ])
              .optional(),
          })
          .strict()
          .refine(
            (l) => Boolean(l.productId || (l.name && l.rate)),
            "Manual line items must specify both a name and a rate",
          ),
      )
      .min(1)
      .max(100),
    receipts: z
      .array(receipt.omit({ salesmanId: true }))
      .max(50)
      .default([]),
    paperReference: z.string().max(200).default(""),
    discount: money.optional(),
    overrideReason: note,
  })
  .strict();
const openingInput = z
  .object({
    ...base,
    batchId: z.string().min(1).max(100),
    rowId: z.string().min(1).max(100),
    target: z.enum([
      "trade",
      "customer",
      "money",
      "loan_given",
      "borrowed",
      "staff",
      "transit",
      "unidentified",
    ]),
    targetId: id,
    amount: signedMoney,
    legacyMode: z.enum(["total", "items"]).default("total"),
    counterparty: z.string().max(200).optional(),
  })
  .strict();
export const commands = {
  bill,
  receiptBatch: z
    .object({
      ...base,
      salesmanId: id,
      customerId: id.optional(),
      receipts: z
        .array(receipt.omit({ salesmanId: true }))
        .min(1)
        .max(50),
    })
    .strict(),
  adjustment: z
    .object({
      ...base,
      target: z.enum(["trade", "money"]),
      targetId: id,
      direction: z.enum(["increase", "decrease"]),
      amount: money,
      category: z.enum([
        "opening_correction",
        "write_off",
        "cash_over_short",
        "approved_trade_correction",
      ]),
      reason: z.string().min(3).max(2000),
    })
    .strict(),
  receipt: receipt.extend(base).strict(),
  verify: z
    .object({
      ...base,
      claimId: id,
      bankIdentity: z.string().min(1).max(200),
      evidence: z.string().min(3).max(2000),
    })
    .strict(),
  reject: z
    .object({ claimId: id, reason: z.string().min(3).max(2000) })
    .strict(),
  return: z
    .object({
      ...base,
      lineId: id,
      quantity: decimal,
      reason: z.string().min(3).max(2000),
    })
    .strict(),
  refund: z
    .object({
      ...base,
      salesmanId: id,
      amount: money,
      accountId: id,
      reason: z.string().min(3).max(2000),
    })
    .strict(),
  opening: openingInput,
  openingBatch: z
    .object({
      ...base,
      batchId: z.string().min(1).max(100),
      rows: z
        .array(openingInput.omit({ date: true, note: true, batchId: true }))
        .min(1)
        .max(500),
    })
    .strict(),
  expense: z
    .object({
      ...base,
      category: z.string().min(1).max(100),
      payee: z.string().min(1).max(200),
      amount: money,
      legs: z
        .array(z.object({ accountId: id, amount: money }).strict())
        .min(1)
        .max(10),
    })
    .strict(),
  transfer: z
    .object({ ...base, sourceId: id, destinationId: id, amount: money })
    .strict(),
  deposit: z
    .object({ ...base, sourceId: id, destinationId: id, amount: money })
    .strict(),
  resolveDeposit: z
    .object({
      ...base,
      depositId: id,
      accountId: id,
      amount: money,
      resolution: z.enum(["credit", "return"]),
      bankIdentity: z.string().max(200).default(""),
    })
    .strict(),
  loan: z
    .object({
      ...base,
      direction: z.enum(["given", "borrowed", "staff"]),
      counterparty: z.string().min(1).max(200),
      employeeId: id.optional(),
      accountId: id,
      amount: money,
    })
    .strict(),
  repay: z
    .object({ ...base, loanId: id, accountId: id, amount: money })
    .strict(),
  salary: z
    .object({
      ...base,
      staffLoanId: id.optional(),
      employeeId: id.optional(),
      payee: z.string().min(1).max(200),
      period: z.string().min(1).max(100),
      amount: money,
      setoff: money.default("0"),
      accountId: id,
    })
    .strict(),
  owner: z
    .object({
      ...base,
      classification: z.enum([
        "contribution",
        "owner_advance",
        "withdrawal",
        "owner_advance_repayment",
      ]),
      accountId: id,
      amount: money,
    })
    .strict(),
  unidentified: z
    .object({
      ...base,
      accountId: id,
      amount: money,
      bankIdentity: z.string().min(1).max(200),
    })
    .strict(),
  identify: z
    .object({
      ...base,
      receiptId: id,
      assignments: z
        .array(z.object({ salesmanId: id, amount: money }).strict())
        .min(1)
        .max(50),
    })
    .strict(),
  reverse: z
    .object({ ...base, documentId: id, reason: z.string().min(3).max(2000) })
    .strict(),
  resolveCloseException: z
    .object({
      ...base,
      closeId: id,
      resolution: z.enum(["recount_confirmed", "linked_correction"]),
      documentId: id.optional(),
      reason: z.string().min(3).max(2000),
    })
    .strict(),
  close: z
    .object({
      date,
      counts: z
        .array(
          z.object({ accountId: id, counted: money, reason: note }).strict(),
        )
        .min(1),
    })
    .strict(),
  reopen: z.object({ date, reason: z.string().min(3).max(2000) }).strict(),
  reconcile: z
    .object({
      date,
      accountId: id,
      statement: signedMoney,
      matches: z.array(id),
      note,
    })
    .strict(),
  reallocate: z
    .object({ ...base, salesmanId: id, preferredChargeIds: z.array(id) })
    .strict(),
  foodsReceipt: z
    .object({
      ...base,
      foodsSalesman: z.string().min(1).max(200),
      foodsSalesmanId: id.optional(),
      billNo: z.string().max(100).optional(),
      foodItems: z.string().max(500).optional(),
      cashAmount: money.default("0.00"),
      bankAmount: money.default("0.00"),
      bankAmounts: z.array(money).optional(),
      cashAccountId: id.optional(),
      bankAccountId: id.optional(),
      method: z.enum(["cash", "online"]).optional(),
      verified: z.boolean().default(false),
      note: z.string().max(2000).optional(),
    })
    .strict(),
  employeeReceipt: z
    .object({
      ...base,
      employeeName: z.string().min(1).max(200),
      employeeId: id.optional(),
      amount: money,
      accountId: id,
      note: z.string().max(2000).optional(),
    })
    .strict(),
  receiveSalesmanCash: z
    .object({
      ...base,
      salesmanId: id,
      amount: money,
      accountId: id,
      managerNote: z.string().max(2000).optional(),
    })
    .strict(),
  initiateCashHandover: z
    .object({
      ...base,
      salesmanId: id,
      amount: money,
      salesmanNote: z.string().max(2000).optional(),
    })
    .strict(),
  confirmCashHandover: z
    .object({
      ...base,
      handoverId: z.string().max(200).optional(),
      salesmanId: id.optional(),
      acceptedAmount: money,
      accountId: id,
      sourceAccountId: id.optional(),
      method: z.enum(["cash", "online"]).optional(),
      managerNote: z.string().max(2000).optional(),
    })
    .strict(),
  rejectCashHandover: z
    .object({
      ...base,
      handoverId: id,
      reason: z.string().min(3).max(2000),
    })
    .strict(),
};
export type CommandName = keyof typeof commands;
export type Inputs = { [K in CommandName]: z.infer<(typeof commands)[K]> };
export const salesmanSchema = z
  .object({
    code: z.string().min(1).max(30),
    name: z.string().min(1).max(200),
    active: z.boolean().default(true),
    creditLimit: money.nullable().default(null),
    details: z.record(z.string(), z.string()).default({}),
  })
  .strict();
export const productSchema = z
  .object({
    id: id.optional(),
    code: z.string().min(1).max(30),
    name: z.string().min(1).max(200),
    barcode: z.string().max(500).optional().nullable(),
    category: z.string().min(1).max(100).default("CG-01 CIGARETTE"),
    unit: z.string().min(1).max(50),
    baseUnit: z.string().min(1).max(50),
    conversion: decimal,
    basis: decimal,
    rate: decimal,
    fractional: z.boolean(),
    confirmed: z.boolean(),
    effectiveDate: date,
    itcMultiple: decimal.optional().nullable(),
    isFocusBrand: z.boolean().optional().default(false),
  })
  .strict();
export const accountSchema = z
  .object({
    name: z.string().min(1).max(200),
    type: z.enum(["cash", "bank"]),
    holder: z.string().min(1).max(200),
    allowOverdraft: z.boolean().default(false),
  })
  .strict();
export const commandResult = z
  .object({
    id: z.string(),
    number: z.string().optional(),
    amount: signedMoney.optional(),
  })
  .passthrough();
export const rowSchema = z.record(z.string(), z.unknown());
export const rowsSchema = z.array(rowSchema);
// Runtime response contracts: posted money must remain decimal strings at the browser boundary.
const balanceRow = z
  .object({ id, name: z.string(), balance: signedMoney })
  .passthrough();
export const dashboardResponse = z
  .object({
    date,
    refreshedAt: z.string(),
    due: money,
    credit: money,
    people: z.array(balanceRow),
    accounts: z.array(balanceRow),
    activity: rowsSchema,
    claims: rowsSchema,
    transit: rowsSchema,
    loans: rowsSchema,
    closes: rowsSchema,
    summary: z
      .object({
        collections: signedMoney,
        cash_collections: signedMoney,
        online_collections: signedMoney,
        total_inflows: signedMoney.optional(),
        cash_inflows: signedMoney.optional(),
        bank_inflows: signedMoney.optional(),
        expenses: signedMoney,
        loans: signedMoney.optional(),
        expenses_and_loans: signedMoney.optional(),
        returns: signedMoney,
      })
      .passthrough(),
    cashSummary: z.array(
      z
        .object({
          id,
          name: z.string(),
          opening: signedMoney,
          inflows: money,
          outflows: money,
          expected: signedMoney,
        })
        .passthrough(),
    ),
    dayClosed: z.boolean(),
    backupStatus: z.string(),
  })
  .passthrough();
export const documentResponse = z
  .object({
    id,
    number: z.string(),
    kind: z.string(),
    business_date: date,
    created_at: z.string().optional(),
    amount: money,
    data: rowSchema,
  })
  .passthrough();
export const documentListResponse = z.array(documentResponse);
export const statementResponse = z
  .object({
    salesman: rowSchema,
    from: date,
    to: date,
    opening: signedMoney,
    ending: signedMoney,
    entries: z.array(
      z
        .object({
          id,
          number: z.string(),
          date,
          created_at: z.string().optional(),
          debit: money,
          credit: money,
          balance: signedMoney,
        })
        .passthrough(),
    ),
    pending: rowsSchema,
  })
  .passthrough();
export const previewResponse = z
  .object({
    quoteHash: z.string().regex(/^[0-9a-f]{64}$/),
    needsOwnerApproval: z.boolean(),
    total: money,
    subtotal: money.optional(),
    discount: money.optional(),
    previous: signedMoney,
    confirmed: money,
    cashConfirmed: money.optional(),
    onlineConfirmed: money.optional(),
    pending: money,
    projected: signedMoney,
    salesmanPrevious: signedMoney.optional(),
    salesmanProjected: signedMoney.optional(),
    customerPrevious: signedMoney.optional(),
    customerProjected: signedMoney.optional(),
    lines: z.array(
      z
        .object({
          productId: id,
          quantity: decimal,
          amount: money,
          gross: money.optional(),
          discountAmount: money.optional(),
          effectiveRate: decimal.optional(),
          effectiveBasis: decimal.optional(),
          unit: z.string().optional(),
          baseUnit: z.string().optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
export const bookResponse = z
  .object({
    account: rowSchema,
    from: date,
    to: date,
    opening: signedMoney,
    ending: signedMoney,
    entries: z.array(
      z
        .object({
          id,
          number: z.string(),
          date: date.optional(),
          created_at: z.string().optional(),
          inflow: money,
          outflow: money,
          balance: signedMoney,
        })
        .passthrough(),
    ),
  })
  .passthrough();

export { csvCell, encodeCsvRows } from "./csv";
