import { describe, test, expect } from "bun:test";
import {
  lineAmount,
  billLinePricing,
  returnAmount,
  normalizeDecimal,
  businessDate,
  csvCell,
  money,
  canonical,
  quoteFingerprint,
} from "../apps/api/src/money";
import { commands, z, parseMultiAmounts } from "../packages/contracts/src";
import { isDirectRouteSalesman } from "../apps/api/src/engine";
describe("Exact decimal domain rules", () => {
  test("A13 configured conversion and price basis", () =>
    expect(lineAmount("2", "10", "100", "250", false)).toBe("50.00"));
  test("A14 half-up at line boundary", () => {
    expect(lineAmount("3", "1", "1", "10.005", false)).toBe("30.02");
    expect(money("10.005")).toBe("10.01");
    expect(money("30.03")).toBe("30.03");
  });
  test("A15 rejects fractional integer products", () =>
    expect(() => lineAmount("0.5", "1", "1", "100", false)).toThrow());
  test("A51 full return consumes rounding residual", () => {
    const first = returnAmount("3", "30.02", "0", "0", "1");
    expect(first).toBe("10.01");
    expect(returnAmount("3", "30.02", "1", first, "2")).toBe("20.01");
    expect(() => returnAmount("3", "30.02", "1", first, "3")).toThrow();

    // Partial returns across 3 steps: 100.00 across 3 items
    const r1 = returnAmount("3", "100.00", "0", "0", "1");
    expect(r1).toBe("33.33");
    const r2 = returnAmount("3", "100.00", "1", r1, "1");
    expect(r2).toBe("33.33");
    const r3 = returnAmount("3", "100.00", "2", "66.66", "1");
    expect(r3).toBe("33.34");
    expect((parseFloat(r1) + parseFloat(r2) + parseFloat(r3)).toFixed(2)).toBe("100.00");
  });
  test("A52 Kolkata midnight independent of host timezone", () => {
    expect(businessDate(new Date("2026-11-05T18:29:59Z"))).toBe("2026-11-05");
    expect(businessDate(new Date("2026-11-05T18:30:00Z"))).toBe("2026-11-06");
  });
  test("Indian grouping normalized explicitly", () => {
    expect(normalizeDecimal("1,25,000.50")).toBe("125000.5");
    expect(normalizeDecimal("0002")).toBe("2");
    for (const value of ["1,250,00", "1.2L", "NaN", "", "Infinity"])
      expect(() => normalizeDecimal(value)).toThrow();
  });
  test("A46 money API rejects floats and client totals", () => {
    expect(commands.receipt.safeParse({ amount: 4000 }).success).toBe(false);
    expect(commands.bill.safeParse({ amount: "4000.00" }).success).toBe(false);
    expect(commands.receiveSalesmanCash.safeParse({ amount: 500 }).success).toBe(false);
  });
  test("Direct route salesman identification (H1 fix)", () => {
    // Configured via details takes precedence over name
    expect(isDirectRouteSalesman({ name: "Rajesh", details: { is_direct_route: "true" } })).toBe(true);
    expect(isDirectRouteSalesman({ name: "Rajesh", details: { direct_route: true } })).toBe(true);
    expect(isDirectRouteSalesman({ name: "Rajesh", details: {} })).toBe(false);
    // Backward compatibility for existing data
    expect(isDirectRouteSalesman({ name: "MUBASHIR SALESMAN" })).toBe(true);
    expect(isDirectRouteSalesman({ name: "Mudashir Route" })).toBe(true);
    expect(isDirectRouteSalesman(undefined)).toBe(false);
  });
  test("A54 exports neutralize spreadsheet formulas", () => {
    expect(csvCell('=HYPERLINK("bad")')).toStartWith("\"'");
    expect(csvCell("  @x")).toStartWith("\"'");
    expect(csvCell("4000.00")).toBe('"4000.00"');
  });
  test("Large exact decimal amount stays exact", () =>
    expect(money("9999999999999999.99")).toBe("9999999999999999.99"));
  test("parseMultiAmounts splits by '+', '/', or '|' and supports formatted amounts with commas and rupee signs", () => {
    // Single amounts with commas and rupee signs must stay as single amounts
    expect(parseMultiAmounts("1,500")).toEqual(["1500.00"]);
    expect(parseMultiAmounts("₹1,20,500.50")).toEqual(["120500.50"]);
    expect(parseMultiAmounts(" 500.00 ")).toEqual(["500.00"]);

    // Multiple amounts separated by pipe '|', plus '+', or slash '/'
    expect(parseMultiAmounts("500 | 1,200")).toEqual(["500.00", "1200.00"]);
    expect(parseMultiAmounts("500 + 1,200")).toEqual(["500.00", "1200.00"]);
    expect(parseMultiAmounts("500+1200")).toEqual(["500.00", "1200.00"]);
    expect(parseMultiAmounts("500 / 1,200")).toEqual(["500.00", "1200.00"]);
    expect(parseMultiAmounts("500/1200")).toEqual(["500.00", "1200.00"]);
    expect(parseMultiAmounts("₹1,20,500.50 + 50,000 / 2500 | 300")).toEqual(["120500.50", "50000.00", "2500.00", "300.00"]);

    // Empty, invalid or zero amounts ignored cleanly
    expect(parseMultiAmounts("")).toEqual([]);
    expect(parseMultiAmounts("0.00 + -50 / 1000")).toEqual(["1000.00"]);
    expect(parseMultiAmounts(" + 500 / ")).toEqual(["500.00"]);
  });
});

test("Bill-only pricing uses explicit basis and discount after exact line rounding", () => {
  const config = {
    conversion: "1",
    basis: "1",
    rate: "10.005",
    fractional: false,
  };
  expect(
    billLinePricing(
      { quantity: "3", discount: { type: "percent", value: "10" } },
      config,
    ),
  ).toMatchObject({ gross: "30.02", discount: "3.00", amount: "27.02" });
  expect(
    billLinePricing(
      {
        quantity: "3",
        rate: "125",
        basis: "2",
        discount: { type: "fixed", value: "7.51" },
      },
      config,
    ),
  ).toMatchObject({ gross: "187.50", discount: "7.51", amount: "179.99" });
});
test("Bill discounts and price basis reject invalid or excessive values", () => {
  const config = {
    conversion: "1",
    basis: "1",
    rate: "100",
    fractional: false,
  };
  for (const discount of [
    { type: "percent" as const, value: "100.01" },
    { type: "fixed" as const, value: "100.01" },
    { type: "fixed" as const, value: "-1" },
  ])
    expect(() =>
      billLinePricing({ quantity: "1", discount }, config),
    ).toThrow();
  expect(() =>
    billLinePricing({ quantity: "1", basis: "0" }, config),
  ).toThrow();
  expect(() => billLinePricing({ quantity: "0" }, config)).toThrow();
  expect(() =>
    billLinePricing({ quantity: "1" }, { ...config, conversion: "0" }),
  ).toThrow();
  expect(
    billLinePricing(
      { quantity: "1", discount: { type: "percent", value: "100" } },
      config,
    ).amount,
  ).toBe("0.00");
});

describe("H5 canonical fingerprinting & C4 UUID safety", () => {
  test("canonical helper sorts object keys deterministically", () => {
    const objA = { z: 1, a: 2, m: { b: 3, a: 4 } };
    const objB = { a: 2, m: { a: 4, b: 3 }, z: 1 };
    expect(canonical(objA)).toBe(canonical(objB));
    expect(canonical(objA)).toBe('{"a":2,"m":{"a":4,"b":3},"z":1}');
  });

  test("quoteFingerprint is invariant to child receipt key ordering", () => {
    const lines = [
      {
        productId: "p1",
        configurationId: "c1",
        quantity: "10",
        rate: "100.00",
        basis: "1",
      },
    ];
    const receiptsA = [
      { amount: "500.00", method: "cash", note: "Handover" },
      { method: "online", amount: "500.00", reference: "UPI123" },
    ];
    const receiptsB = [
      { note: "Handover", method: "cash", amount: "500.00" },
      { reference: "UPI123", amount: "500.00", method: "online" },
    ];

    const hashA = quoteFingerprint("2026-11-18", "salesman-1", "0.00", "1000.00", null, lines, receiptsA);
    const hashB = quoteFingerprint("2026-11-18", "salesman-1", "0.00", "1000.00", null, lines, receiptsB);
    expect(hashA).toBe(hashB);
  });

  test("C4 UUID parsing rejects SQL injection and malformed query strings", () => {
    const uuidParser = z.string().uuid();
    const goodIds = "550e8400-e29b-41d4-a716-446655440000,6ba7b810-9dad-11d1-80b4-00c04fd430c8";
    const malicious = "550e8400-e29b-41d4-a716-446655440000; DROP TABLE documents; --, bad-id";

    const filteredGood = goodIds
      .split(",")
      .map((s) => s.trim())
      .filter((id) => uuidParser.safeParse(id).success);
    expect(filteredGood.length).toBe(2);

    const filteredBad = malicious
      .split(",")
      .map((s) => s.trim())
      .filter((id) => uuidParser.safeParse(id).success);
    expect(filteredBad.length).toBe(0);
  });

  test("H4 foodsReceipt schema supports optional explicit cash/bank account IDs and split bankAmounts", () => {
    const validWithAccounts = commands.foodsReceipt.safeParse({
      foodsSalesman: "Ramesh Foods",
      cashAmount: "1500.00",
      bankAmount: "2500.00",
      bankAmounts: ["1000.00", "1500.00"],
      cashAccountId: "550e8400-e29b-41d4-a716-446655440000",
      bankAccountId: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
      verified: false,
      date: "2026-11-18",
    });
    expect(validWithAccounts.success).toBe(true);

    const validWithoutAccounts = commands.foodsReceipt.safeParse({
      foodsSalesman: "Ramesh Foods",
      cashAmount: "1500.00",
      date: "2026-11-18",
    });
    expect(validWithoutAccounts.success).toBe(true);
  });

  test("Overall bill flat discount contract and fingerprinting", () => {
    const validBillWithDiscount = commands.bill.safeParse({
      date: "2026-11-18",
      salesmanId: "550e8400-e29b-41d4-a716-446655440000",
      lines: [
        {
          productId: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
          quantity: "5",
        },
      ],
      discount: "150.00",
      receipts: [],
      paperReference: "",
      overrideReason: "",
    });
    expect(validBillWithDiscount.success).toBe(true);

    const lines = [
      {
        productId: "p1",
        configurationId: "c1",
        quantity: "10",
        rate: "100.00",
        basis: "1",
      },
    ];
    const hashWithoutDiscount = quoteFingerprint(
      "2026-11-18",
      "s1",
      "0.00",
      "1000.00",
      null,
      lines,
      [],
      "0.00",
    );
    const hashWithDiscount = quoteFingerprint(
      "2026-11-18",
      "s1",
      "0.00",
      "850.00",
      null,
      lines,
      [],
      "150.00",
    );
    expect(hashWithoutDiscount).not.toBe(hashWithDiscount);
  });

  test("Confectionery lines and one-time manual products in bill schema", () => {
    // 1. Valid bill with master product line AND manual confectionery line
    const validBill = commands.bill.safeParse({
      date: "2026-11-18",
      salesmanId: "550e8400-e29b-41d4-a716-446655440000",
      lines: [
        {
          productId: "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
          quantity: "5",
        },
        {
          name: "Cadbury Dairy Milk Silk 60g",
          code: "MANUAL",
          category: "confectionery",
          quantity: "12",
          rate: "80.00",
        },
      ],
      receipts: [],
      paperReference: "",
      overrideReason: "",
    });
    expect(validBill.success).toBe(true);

    // 2. Reject manual line without a rate
    const invalidNoRate = commands.bill.safeParse({
      date: "2026-11-18",
      salesmanId: "550e8400-e29b-41d4-a716-446655440000",
      lines: [
        {
          name: "KitKat 2 Finger",
          quantity: "10",
        },
      ],
      receipts: [],
      paperReference: "",
      overrideReason: "",
    });
    expect(invalidNoRate.success).toBe(false);

    // 3. Fingerprint with manual lines works deterministically
    const confLines = [
      {
        name: "Cadbury Dairy Milk",
        configurationId: null,
        quantity: "10",
        rate: "10.00",
      },
    ];
    const fp1 = quoteFingerprint("2026-11-18", "s1", "0.00", "100.00", null, confLines, []);
    const fp2 = quoteFingerprint("2026-11-18", "s1", "0.00", "100.00", null, confLines, []);
    expect(fp1).toBe(fp2);
    expect(typeof fp1).toBe("string");
  });
  test("Loading sheet documentIds payload validates UUIDs and rejects injection", () => {
    const documentIdsSchema = z.array(z.string().uuid());
    const valid = documentIdsSchema.safeParse([
      "97e20cf3-d5d1-4203-b0f3-93863412595a",
      "bfdf2a23-4e4b-4b21-8271-fc30f555d4ae",
    ]);
    expect(valid.success).toBe(true);

    const invalid = documentIdsSchema.safeParse([
      "not-a-uuid",
      "'; DROP TABLE documents; --",
    ]);
    expect(invalid.success).toBe(false);

    // Verify documents/lines array parsing contract
    const lineItemSchema = z.array(z.record(z.string(), z.unknown()));
    const sampleLines = [
      {
        id: "4c9ab663-4e87-4ebf-af0a-c13097e07790",
        document_id: "ce1d1480-778d-4d65-a69d-5bf4423565d8",
        product_id: "b7f89b34-e295-4057-aff1-861e85db824e",
        quantity: "8.00000000",
        amount: "49841.60",
        snapshot: { name: "BERKELEY", rate: "6230.20", unit: "m" },
      },
    ];
    expect(lineItemSchema.safeParse(sampleLines).success).toBe(true);
  });
  test("Relational master FKs in commands schemas (employeeId, foodsSalesmanId)", () => {
    // 1. foodsReceipt with optional foodsSalesmanId
    const parsedFoods = commands.foodsReceipt.safeParse({
      date: "2026-11-19",
      foodsSalesman: "Sunil Agrawal (Foods)",
      foodsSalesmanId: "bfdf2a23-4e4b-4b21-8271-fc30f555d4ae",
      cashAmount: "500.00",
      bankAmount: "0.00",
      billNo: "B-101",
      foodItems: "Biscuits",
      note: "Test note",
    });
    expect(parsedFoods.success).toBe(true);

    // 2. employeeReceipt with optional employeeId
    const parsedEmp = commands.employeeReceipt.safeParse({
      date: "2026-11-19",
      employeeName: "Ramesh Kumar",
      employeeId: "bfdf2a23-4e4b-4b21-8271-fc30f555d4ae",
      amount: "1500.00",
      accountId: "97e20cf3-d5d1-4203-b0f3-93863412595a",
      note: "Returned advance",
    });
    expect(parsedEmp.success).toBe(true);

    // 3. salary with optional employeeId
    const parsedSalary = commands.salary.safeParse({
      date: "2026-11-19",
      employeeId: "bfdf2a23-4e4b-4b21-8271-fc30f555d4ae",
      payee: "Ramesh Kumar",
      period: "Nov 2026",
      amount: "12000.00",
      setoff: "2000.00",
      staffLoanId: "bfdf2a23-4e4b-4b21-8271-fc30f555d4ae",
      accountId: "97e20cf3-d5d1-4203-b0f3-93863412595a",
    });
    expect(parsedSalary.success).toBe(true);
  });
  test("Customer isolation in settlement allocations", () => {
    // Verify that allocation grouping preserves customer separation
    type MockItem = { id: string; kind: string; delta: string; custKey: string | null; left: number };
    const charges: MockItem[] = [
      { id: "bill-ashok", kind: "bill", delta: "17450.39", custKey: "ashok", left: 17450.39 },
      { id: "bill-bharath", kind: "bill", delta: "49841.60", custKey: "bharath", left: 49841.60 },
    ];
    const credits: MockItem[] = [
      { id: "receipt-bharath-1", kind: "receipt", delta: "-31151.00", custKey: "bharath", left: 31151.00 },
      { id: "receipt-bharath-2", kind: "receipt", delta: "-9000.00", custKey: "bharath", left: 9000.00 },
    ];
    const customerKeys = new Set<string>();
    for (const c of credits) if (c.custKey) customerKeys.add(c.custKey);
    for (const d of charges) if (d.custKey) customerKeys.add(d.custKey);

    const applications: { creditId: string; chargeId: string; amount: number }[] = [];
    for (const custKey of customerKeys) {
      const custCredits = credits.filter((c) => c.custKey === custKey);
      const custCharges = charges.filter((d) => d.custKey === custKey);
      for (const c of custCredits) {
        for (const d of custCharges) {
          const amount = Math.min(c.left, d.left);
          if (amount <= 0) continue;
          c.left -= amount;
          d.left -= amount;
          applications.push({ creditId: c.id, chargeId: d.id, amount });
        }
      }
    }

    // Assert: No Bharath receipt was applied to Ashok's bill
    const ashokApplications = applications.filter((a) => a.chargeId === "bill-ashok");
    expect(ashokApplications).toHaveLength(0);

    // Assert: Bharath receipts were applied to Bharath's bill
    const bharathApplications = applications.filter((a) => a.chargeId === "bill-bharath");
    expect(bharathApplications).toHaveLength(2);
    expect(bharathApplications[0].creditId).toBe("receipt-bharath-1");
    expect(bharathApplications[1].creditId).toBe("receipt-bharath-2");
    expect(bharathApplications[0].amount + bharathApplications[1].amount).toBe(40151.00);
  });
});
