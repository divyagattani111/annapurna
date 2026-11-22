import { test, expect, beforeAll, afterAll } from "bun:test";
import { sql } from "drizzle-orm";
import { db, pool } from "../packages/db/src";
import {
  command,
  rows,
  balance,
  type Actor,
  type Row,
} from "../apps/api/src/engine";
import { businessDate, D } from "../apps/api/src/money";
import { auth } from "../apps/api/src/auth";
import { app } from "../apps/api/src/app";
if (
  process.env.APP_MODE !== "test" ||
  !new URL(process.env.DATABASE_URL ?? "").pathname.endsWith("_test")
)
  throw new Error(
    "Tests require a separate *_test PostgreSQL database and APP_MODE=test",
  );
const date = businessDate();
let n = 0;
async function fixture() {
  const org = crypto.randomUUID(),
    ownerId = crypto.randomUUID(),
    managerId = crypto.randomUUID();
  await db.execute(
    sql`insert into organizations(id,name,mode) values(${org},${"Test " + org},'test')`,
  );
  for (const [id, role] of [
    [ownerId, "owner"],
    [managerId, "manager"],
  ]) {
    await db.execute(
      sql`insert into "user"(id,name,email) values(${id},${role},${id + "@test.invalid"})`,
    );
    await db.execute(
      sql`insert into members(org,user_id,role) values(${org},${id},${role})`,
    );
  }
  const owner: Actor = { id: ownerId, org, role: "owner", capabilities: {} },
    manager: Actor = { id: managerId, org, role: "manager", capabilities: {} };
  const s1 = crypto.randomUUID(),
    s2 = crypto.randomUUID(),
    cash = crypto.randomUUID(),
    bank = crypto.randomUUID(),
    cash2 = crypto.randomUUID(),
    product = crypto.randomUUID();
  for (const [id, code] of [
    [s1, "S1"],
    [s2, "S2"],
  ])
    await db.execute(
      sql`insert into salesmen(id,org,code,name) values(${id},${org},${code},${code})`,
    );
  for (const [id, type] of [
    [cash, "cash"],
    [bank, "bank"],
    [cash2, "cash"],
  ])
    await db.execute(
      sql`insert into money_accounts(id,org,name,type,holder) values(${id},${org},${type},${type},'Test custodian')`,
    );
  await db.execute(
    sql`insert into products(id,org,code,name) values(${product},${org},'T','Test product')`,
  );
  await db.execute(
    sql`insert into product_configurations(org,product_id,effective_date,unit,base_unit,conversion,basis,rate,confirmed) values(${org},${product},${date},'unit','unit','1','1','100',true)`,
  );
  const run = (
    name: Parameters<typeof command>[1],
    p: unknown,
    key = crypto.randomUUID(),
    actor = owner,
  ) => command(actor, name, p, key);
  const bal = (target: string, asOf = date) => balance(db, org, target, asOf);
  const bill = (quantity: string, salesmanId = s1, receipts: Row[] = []) =>
    run("bill", {
      date,
      salesmanId,
      lines: [{ productId: product, quantity }],
      receipts,
    });
  const receipt = (amount: string, method = "cash", salesmanId = s1) =>
    run("receipt", {
      date,
      actualDate: date,
      salesmanId,
      amount,
      accountId: method === "cash" ? cash : bank,
      method,
      reference: "TEST-" + crypto.randomUUID(),
      verified: false,
    });
  const fund = async (amount = "100000.00") =>
    run("opening", {
      date,
      target: "money",
      targetId: cash,
      amount,
      batchId: "T",
      rowId: "cash",
    });
  const line = async (id: unknown) => {
    const [r] = await rows<{ id: string }>(
      db,
      sql`select id from bill_lines where document_id=${String(id)}`,
    );
    return r.id;
  };
  return {
    org,
    owner,
    manager,
    s1,
    s2,
    cash,
    bank,
    cash2,
    product,
    run,
    bal,
    bill,
    receipt,
    fund,
    line,
  };
}
type F = Awaited<ReturnType<typeof fixture>>;
async function due(f: F, s = f.s1) {
  return f.bal("trade:" + s);
}
async function verify(f: F, claim: Row, identity = crypto.randomUUID()) {
  return f.run("verify", {
    date,
    claimId: claim.id,
    bankIdentity: identity,
    evidence: "Checked receiving bank statement",
  });
}
async function refund(f: F, amount: string) {
  return f.run("refund", {
    date,
    salesmanId: f.s1,
    accountId: f.cash,
    amount,
    reason: "Return credit payout",
  });
}
async function ret(f: F, bill: Row, q: string) {
  return f.run("return", {
    date,
    lineId: await f.line(bill.id),
    quantity: q,
    reason: "Goods returned",
  });
}
async function authCookie(f: F, role: "owner" | "manager") {
  const email = crypto.randomUUID() + "@test.invalid",
    password = "Local-test-" + crypto.randomUUID();
  const result = await auth.api.signUpEmail({
    body: { name: "API test", email, password },
  });
  await db.execute(
    sql`insert into members(org,user_id,role) values(${f.org},${result.user.id},${role})`,
  );
  const response = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
    headers: new Headers({ origin: "http://localhost:5173" }),
  });
  expect(response.status).toBe(200);
  return response.headers
    .getSetCookie()
    .map((v) => v.split(";")[0])
    .join("; ");
}
async function request(cookie: string, path: string, body?: unknown) {
  return app.request("http://localhost:5173/api/v1/" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      cookie,
      origin: "http://localhost:5173",
      "content-type": "application/json",
      "idempotency-key": crypto.randomUUID(),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeAll(async () => {
  await db.execute(sql`select 1`);
});
afterAll(async () => {
  await pool.end();
});
test("A01 opening due is neither sale nor receipt", async () => {
  const f = await fixture();
  await f.run("opening", {
    date,
    target: "trade",
    targetId: f.s1,
    amount: "5000",
    batchId: "T",
    rowId: "1",
  });
  expect(await due(f)).toBe("5000.00");
  expect(await f.bal("control:sales")).toBe("0.00");
  expect(await f.bal("money:" + f.cash)).toBe("0.00");
});
test("A02-A04 bill, split claim, once-only verification, later receipt and original return", async () => {
  const f = await fixture();
  await f.run("opening", {
    date,
    target: "trade",
    targetId: f.s1,
    amount: "5000",
    batchId: "T",
    rowId: "1",
  });
  const b = await f.bill("200", f.s1, [
    {
      amount: "8000",
      accountId: f.cash,
      method: "cash",
      actualDate: date,
      reference: "",
    },
    {
      amount: "7000",
      accountId: f.bank,
      method: "online",
      actualDate: date,
      reference: "CLAIM",
    },
  ]);
  expect(await due(f)).toBe("17000.00");
  expect(await f.bal("money:" + f.bank)).toBe("0.00");
  const claim = (b.receipts as Row[])[1];
  await verify(f, claim);
  await verify(f, claim);
  expect(await due(f)).toBe("10000.00");
  expect(await f.bal("money:" + f.bank)).toBe("7000.00");
  await f.receipt("4000");
  expect(await due(f)).toBe("6000.00");
  await ret(f, b, "10");
  expect(await due(f)).toBe("5000.00");
});
test("A05 pending/rejected never affect money; confirmed cannot reject", async () => {
  const f = await fixture();
  const p = await f.receipt("700", "online");
  expect(await due(f)).toBe("0.00");
  await f.run("reject", { claimId: p.id, reason: "No bank evidence" });
  await expect(verify(f, p)).rejects.toThrow();
  const p2 = await f.receipt("700", "online");
  await verify(f, p2);
  await expect(
    f.run("reject", { claimId: p2.id, reason: "Changed mind" }),
  ).rejects.toThrow();
});
test("A06 overpayment consumed by later bill without second receipt", async () => {
  const f = await fixture();
  await f.bill("10");
  await f.receipt("1500");
  expect(await due(f)).toBe("-500.00");
  await f.bill("8");
  expect(await due(f)).toBe("300.00");
  expect(await f.bal("money:" + f.cash)).toBe("1500.00");
});
test("A07 opening advance is not a collection", async () => {
  const f = await fixture();
  await f.run("opening", {
    date,
    target: "trade",
    targetId: f.s1,
    amount: "-500",
    batchId: "T",
    rowId: "1",
  });
  await f.bill("8");
  expect(await due(f)).toBe("300.00");
  expect(await f.bal("money:" + f.cash)).toBe("0.00");
});
test("A08 oldest first and reviewed reallocation conserve totals", async () => {
  const f = await fixture();
  const b1 = await f.bill("10"),
    b2 = await f.bill("20");
  await f.receipt("1500");
  const applied = await rows(
    db,
    sql`select x.charge_id,x.amount from allocations x join allocation_heads h on h.generation=x.generation where x.org=${f.org}`,
  );
  expect(applied.find((x) => x.charge_id === b1.id)?.amount).toBe("1000.00");
  await f.run("reallocate", {
    date,
    salesmanId: f.s1,
    preferredChargeIds: [b2.id],
  });
  expect(await due(f)).toBe("1500.00");
  expect(await f.bal("money:" + f.cash)).toBe("1500.00");
});
test("A09 return releases paid credit; refund is separate", async () => {
  const f = await fixture();
  const b = await f.bill("10");
  await f.receipt("1000");
  await ret(f, b, "2");
  expect(await due(f)).toBe("-200.00");
  expect(await f.bal("money:" + f.cash)).toBe("1000.00");
  await refund(f, "200");
  expect(await due(f)).toBe("0.00");
  expect(await f.bal("money:" + f.cash)).toBe("800.00");
});
test("A10 concurrent refunds cannot consume same credit", async () => {
  const f = await fixture();
  await f.receipt("200");
  await expect(refund(f, "300")).rejects.toThrow();
  const results = await Promise.allSettled([
    refund(f, "150"),
    refund(f, "150"),
  ]);
  expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  expect(await due(f)).toBe("-50.00");
});
test("A11 return quantity cap and reversal restores capacity once", async () => {
  const f = await fixture();
  const b = await f.bill("5"),
    r = await ret(f, b, "2");
  await expect(ret(f, b, "4")).rejects.toThrow();
  await f.run("reverse", {
    date,
    documentId: r.id,
    reason: "Return entered incorrectly",
  });
  await expect(
    f.run("reverse", { date, documentId: r.id, reason: "Repeated" }),
  ).rejects.toThrow();
  await ret(f, b, "4");
  expect(await due(f)).toBe("100.00");
});
test("A12 old returns use original rate; new bill uses new rate", async () => {
  const f = await fixture();
  const b = await f.bill("5");
  await db.execute(
    sql`insert into product_configurations(org,product_id,effective_date,unit,base_unit,conversion,basis,rate,confirmed) values(${f.org},${f.product},${date},'unit','unit','1','1','120',true)`,
  );
  expect((await ret(f, b, "1")).amount).toBe("100.00");
  expect((await f.bill("1")).amount).toBe("120.00");
});
test("A13 unconfirmed config blocks that product only", async () => {
  const f = await fixture();
  await db.execute(
    sql`insert into product_configurations(org,product_id,effective_date,unit,base_unit,conversion,basis,rate,confirmed) values(${f.org},${f.product},${date},'M','unknown','1','1','100',false)`,
  );
  await expect(f.bill("1")).rejects.toThrow();
});
test("A14 line rounding persists exact decimal strings", async () => {
  const f = await fixture();
  await db.execute(
    sql`insert into product_configurations(org,product_id,effective_date,unit,base_unit,conversion,basis,rate,confirmed) values(${f.org},${f.product},${date},'unit','unit','1','1','10.005',true)`,
  );
  expect((await f.bill("3")).amount).toBe("30.02");
  const b = await f.run("bill", {
    date,
    salesmanId: f.s1,
    lines: [1, 2, 3].map(() => ({ productId: f.product, quantity: "1" })),
  });
  expect(b.amount).toBe("30.03");
});
test("A15 fractional quantity rejected and snapshots retained", async () => {
  const f = await fixture();
  await expect(f.bill("0.5")).rejects.toThrow();
  const b = await f.bill("1");
  const [line] = await rows(
    db,
    sql`select snapshot from bill_lines where document_id=${b.id}`,
  );
  expect((line.snapshot as Row).conversion).toBe("1.00000000");
});
test("A16 physical cash excludes online and subtracts handed-over deposits", async () => {
  const f = await fixture();
  await f.fund("5000");
  await f.receipt("8000");
  const c = await f.receipt("7000", "online");
  await verify(f, c);
  await f.run("expense", {
    date,
    category: "diesel",
    payee: "Fuel",
    amount: "600",
    legs: [{ accountId: f.cash, amount: "600" }],
  });
  await f.run("deposit", {
    date,
    sourceId: f.cash,
    destinationId: f.bank,
    amount: "10000",
  });
  expect(await f.bal("money:" + f.cash)).toBe("2400.00");
});
test("A17-A18 deposit partial credit, return and duplicate protections", async () => {
  const f = await fixture();
  await f.fund("10000");
  const d = await f.run("deposit", {
    date,
    sourceId: f.cash,
    destinationId: f.bank,
    amount: "10000",
  });
  expect(await f.bal("money:" + f.cash)).toBe("0.00");
  expect(await f.bal("money:" + f.bank)).toBe("0.00");
  await f.run("resolveDeposit", {
    date,
    depositId: d.id,
    accountId: f.bank,
    amount: "8000",
    resolution: "credit",
    bankIdentity: "DEP-1",
  });
  await f.run("resolveDeposit", {
    date,
    depositId: d.id,
    accountId: f.cash,
    amount: "2000",
    resolution: "return",
  });
  expect(await f.bal("money:" + f.cash)).toBe("2000.00");
  expect(await f.bal("money:" + f.bank)).toBe("8000.00");
  await expect(
    f.run("resolveDeposit", {
      date,
      depositId: d.id,
      accountId: f.cash,
      amount: "1",
      resolution: "return",
    }),
  ).rejects.toThrow();
  expect(await f.bal("control:sales")).toBe("0.00");
});
test("A19 confirmed transfer conserves total, rejects same account", async () => {
  const f = await fixture();
  await f.fund("3000");
  await f.run("transfer", {
    date,
    sourceId: f.cash,
    destinationId: f.bank,
    amount: "2000",
  });
  expect(await f.bal("money:" + f.bank)).toBe("2000.00");
  expect(await f.bal("money:" + f.cash)).toBe("1000.00");
  await expect(
    f.run("transfer", {
      date,
      sourceId: f.cash,
      destinationId: f.cash,
      amount: "1",
    }),
  ).rejects.toThrow();
});
test("A20-A21 principal directions and repayment cap", async () => {
  const f = await fixture();
  await f.fund();
  const l = await f.run("loan", {
    date,
    direction: "given",
    counterparty: "Person",
    accountId: f.cash,
    amount: "2000",
  });
  await f.run("repay", {
    date,
    loanId: l.id,
    accountId: f.cash,
    amount: "500",
  });
  const [doc] = await rows<{ data: Row }>(
    db,
    sql`select data from documents where id=${l.id}`,
  );
  expect(await f.bal(String(doc.data.target))).toBe("1500.00");
  const b = await f.run("loan", {
    date,
    direction: "borrowed",
    counterparty: "Lender",
    accountId: f.cash,
    amount: "10000",
  });
  await f.run("repay", {
    date,
    loanId: b.id,
    accountId: f.cash,
    amount: "3000",
  });
  await expect(
    f.run("repay", { date, loanId: b.id, accountId: f.cash, amount: "8000" }),
  ).rejects.toThrow();
  expect(await f.bal("control:sales")).toBe("0.00");
});
test("A22 salary full expense with advance setoff and net payout", async () => {
  const f = await fixture();
  await f.fund("10000");
  const l = await f.run("loan", {
    date,
    direction: "staff",
    counterparty: "Staff",
    accountId: f.cash,
    amount: "2000",
  });
  await f.run("salary", {
    date,
    payee: "Staff",
    period: "Test period",
    staffLoanId: l.id,
    amount: "5000",
    setoff: "2000",
    accountId: f.cash,
  });
  expect(await f.bal("expense:salary")).toBe("5000.00");
  expect(await f.bal("money:" + f.cash)).toBe("5000.00");
});
test("A23 owner funding distinct from sales and custody", async () => {
  const f = await fixture();
  await f.run("owner", {
    date,
    classification: "contribution",
    accountId: f.cash,
    amount: "10000",
  });
  await f.run("transfer", {
    date,
    sourceId: f.cash,
    destinationId: f.cash2,
    amount: "2000",
  });
  expect(await f.bal("control:sales")).toBe("0.00");
  expect(await f.bal("money:" + f.cash2)).toBe("2000.00");
});
test("A24 headline dues and advances never net people", async () => {
  const f = await fixture();
  await f.bill("50");
  await f.receipt("2000", "cash", f.s2);
  const cookie = await authCookie(f, "owner");
  const r = await request(cookie, "dashboard");
  expect(r.status).toBe(200);
  const d = await r.json();
  expect(d.due).toBe("5000.00");
  expect(d.credit).toBe("2000.00");
});
test("A25-A26 difference stays explicit; close freeze and owner reopening", async () => {
  const f = await fixture();
  await f.fund("2400");
  await f.run("close", {
    date,
    counts: [
      { accountId: f.cash, counted: "2350", reason: "Unresolved short cash" },
      { accountId: f.cash2, counted: "0", reason: "" },
    ],
  });
  expect(await f.bal("money:" + f.cash)).toBe("2400.00");
  await expect(
    f.run(
      "bill",
      {
        date,
        salesmanId: f.s1,
        lines: [{ productId: f.product, quantity: "1" }],
      },
      crypto.randomUUID(),
      f.manager,
    ),
  ).rejects.toThrow();
  await f.run("reopen", { date, reason: "Review close" });
  await f.bill("1");
  const [c] = await rows(
    db,
    sql`select state,difference from closes where org=${f.org} and account_id=${f.cash}`,
  );
  expect(c.state).toBe("stale");
  expect(c.difference).toBe("-50.00");
});
test("A27 claimed actual date preserved while verification posts current date", async () => {
  const f = await fixture();
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString(
    "en-CA",
    { timeZone: "Asia/Kolkata" },
  );
  const p = await f.run("receipt", {
    date,
    actualDate: yesterday,
    salesmanId: f.s1,
    amount: "700",
    accountId: f.bank,
    method: "online",
    reference: "OLD",
    verified: false,
  });
  const r = await verify(f, p);
  const [doc] = await rows(
    db,
    sql`select business_date::text,actual_date::text from documents where id=${r.id}`,
  );
  expect(doc.actual_date).toBe(yesterday);
  expect(doc.business_date).toBe(date);
});
test("A28 duplicate bill, receipt and transfer keys once; changed payload conflicts", async () => {
  const f = await fixture();
  const p = {
      date,
      salesmanId: f.s1,
      lines: [{ productId: f.product, quantity: "1" }],
    },
    key = crypto.randomUUID();
  const rs = await Promise.all([f.run("bill", p, key), f.run("bill", p, key)]);
  expect(rs[0].id).toBe(rs[1].id);
  await expect(f.run("bill", { ...p, note: "changed" }, key)).rejects.toThrow();
  await f.fund("1000");
  const tp = { date, sourceId: f.cash, destinationId: f.bank, amount: "100" },
    tk = crypto.randomUUID();
  await f.run("transfer", tp, tk);
  await f.run("transfer", tp, tk);
  expect(await f.bal("money:" + f.bank)).toBe("100.00");
});
test("A29 atomic rollback and lost-response recovery", async () => {
  const f = await fixture(),
    key = crypto.randomUUID(),
    p = {
      date,
      salesmanId: f.s1,
      lines: [{ productId: f.product, quantity: "1" }],
    };
  await expect(
    command(f.owner, "bill", p, key, { failAfterPost: true }),
  ).rejects.toThrow();
  expect(await due(f)).toBe("0.00");
  const saved = await f.run("bill", p, key);
  const retry = await f.run("bill", p, key);
  expect(saved.id).toBe(retry.id);
  expect(await due(f)).toBe("100.00");
});
test("A30 concurrent returns cannot exceed sold quantity", async () => {
  const f = await fixture(),
    b = await f.bill("5");
  const outcomes = await Promise.allSettled([ret(f, b, "4"), ret(f, b, "4")]);
  expect(outcomes.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  expect(await due(f)).toBe("100.00");
});
test("A31 close/post race serializes frozen snapshot", async () => {
  const f = await fixture();
  const outcomes = await Promise.allSettled([
    f.receipt("100"),
    f.run("close", {
      date,
      counts: [
        { accountId: f.cash, counted: "100", reason: "Race test" },
        { accountId: f.cash2, counted: "0", reason: "" },
      ],
    }),
  ]);
  expect(
    outcomes.filter((x) => x.status === "fulfilled").length,
  ).toBeGreaterThanOrEqual(1);
  const [c] = await rows<{ expected: string }>(
    db,
    sql`select expected from closes where org=${f.org} and account_id=${f.cash} and state='closed'`,
  );
  if (c) expect(c.expected).toBe(await f.bal("money:" + f.cash));
});
test("A32 direct manager API cannot reverse or change permissions", async () => {
  const f = await fixture(),
    b = await f.bill("1"),
    cookie = await authCookie(f, "manager");
  expect(
    (
      await request(cookie, "commands/reverse", {
        date,
        documentId: b.id,
        reason: "Unauthorized",
      })
    ).status,
  ).toBe(403);
  const r = await app.request(
    "http://localhost:5173/api/v1/members/" + f.owner.id,
    {
      method: "PATCH",
      headers: {
        cookie,
        origin: "http://localhost:5173",
        "content-type": "application/json",
      },
      body: JSON.stringify({ active: false, verifyOnline: false }),
    },
  );
  expect(r.status).toBe(403);
});
test("A33 organization-scoped documents, statements and private evidence", async () => {
  const f = await fixture(),
    other = await fixture(),
    b = await other.bill("1"),
    cookie = await authCookie(f, "owner");
  expect((await request(cookie, "documents/" + b.id)).status).toBe(404);
  expect((await request(cookie, "statements/" + other.s1)).status).toBe(404);
  expect((await request("", "documents/" + b.id)).status).toBe(401);
});
test("A34 paid bill reversal leaves receipt credit", async () => {
  const f = await fixture(),
    b = await f.bill("10");
  await f.receipt("1000");
  await f.run("reverse", { date, documentId: b.id, reason: "Incorrect bill" });
  expect(await due(f)).toBe("-1000.00");
  expect(await f.bal("money:" + f.cash)).toBe("1000.00");
});
test("A35 receipt reversal once restores due and money", async () => {
  const f = await fixture();
  await f.bill("10");
  const r = await f.receipt("1000");
  await f.run("reverse", { date, documentId: r.id, reason: "Receipt error" });
  expect(await due(f)).toBe("1000.00");
  expect(await f.bal("money:" + f.cash)).toBe("0.00");
  await expect(
    f.run("reverse", { date, documentId: r.id, reason: "Again" }),
  ).rejects.toThrow();
});
test("A36-A38 unidentified credit, split assignment and bank identity conservation", async () => {
  const f = await fixture();
  await f.bill("10");
  const u = await f.run("unidentified", {
    date,
    accountId: f.bank,
    amount: "1000",
    bankIdentity: "UNIQUE-CREDIT",
  });
  expect(await due(f)).toBe("1000.00");
  await f.run("identify", {
    date,
    receiptId: u.id,
    assignments: [
      { salesmanId: f.s1, amount: "600" },
      { salesmanId: f.s2, amount: "400" },
    ],
  });
  expect(await due(f)).toBe("400.00");
  expect(await due(f, f.s2)).toBe("-400.00");
  expect(await f.bal("money:" + f.bank)).toBe("1000.00");
  await expect(
    f.run("identify", {
      date,
      receiptId: u.id,
      assignments: [{ salesmanId: f.s1, amount: "1" }],
    }),
  ).rejects.toThrow();
  await expect(
    f.run("unidentified", {
      date,
      accountId: f.bank,
      amount: "1000",
      bankIdentity: "UNIQUE-CREDIT",
    }),
  ).rejects.toThrow();
  await f.run("unidentified", {
    date,
    accountId: f.bank,
    amount: "1000",
    bankIdentity: "ANOTHER-CREDIT",
  });
  expect(await f.bal("money:" + f.bank)).toBe("2000.00");
});
test("A39 opening repeated key idempotent and duplicate totals blocked", async () => {
  const f = await fixture(),
    p = {
      date,
      target: "trade",
      targetId: f.s1,
      amount: "5000",
      batchId: "B",
      rowId: "1",
    },
    key = crypto.randomUUID();
  await f.run("opening", p, key);
  await f.run("opening", p, key);
  await expect(f.run("opening", { ...p, rowId: "2" })).rejects.toThrow();
  expect(await due(f)).toBe("5000.00");
});
test("A40 statement brought forward and exact 4000.00 JSON string", async () => {
  const f = await fixture();
  await f.bill("40");
  const cookie = await authCookie(f, "owner");
  const r = await request(
      cookie,
      "statements/" + f.s1 + "?from=" + date + "&to=" + date,
    ),
    s = await r.json();
  expect(s.opening).toBe("0.00");
  expect(s.ending).toBe("4000.00");
  expect(typeof s.ending).toBe("string");
  expect(s.entries[0].debit).toBe("4000.00");
});
test("A41 concurrent document numbers unique and retained", async () => {
  const f = await fixture();
  const result = await Promise.all([f.bill("1"), f.bill("1"), f.bill("1")]);
  expect(new Set(result.map((x) => x.number)).size).toBe(3);
  await f.run("reverse", { date, documentId: result[0].id, reason: "Test" });
  expect((await f.bill("1")).number).not.toBe(result[0].number);
});
test("A42 issue-time account snapshot remains unchanged on reprint", async () => {
  const f = await fixture(),
    b = await f.bill("10");
  await f.receipt("500");
  const cookie = await authCookie(f, "owner"),
    r = await request(cookie, "documents/" + b.id),
    d = await r.json();
  expect(d.data.issueBalance).toBe("1000.00");
  expect(await due(f)).toBe("500.00");
});
test("A43 bill child receipts atomic and pending child has no journal", async () => {
  const f = await fixture();
  const b = await f.bill("10", f.s1, [
    {
      amount: "300",
      accountId: f.cash,
      method: "cash",
      actualDate: date,
      reference: "",
    },
    {
      amount: "700",
      accountId: f.bank,
      method: "online",
      actualDate: date,
      reference: "P",
    },
  ]);
  expect(b.receipts as Row[]).toHaveLength(2);
  expect(await due(f)).toBe("700.00");
  expect(await f.bal("money:" + f.bank)).toBe("0.00");
});
test("A44 split expense posts each leg exactly once", async () => {
  const f = await fixture();
  await f.fund("1000");
  await f.run("owner", {
    date,
    accountId: f.bank,
    classification: "contribution",
    amount: "1000",
  });
  await f.run("expense", {
    date,
    category: "repairs",
    payee: "Repairer",
    amount: "1000",
    legs: [
      { accountId: f.cash, amount: "300" },
      { accountId: f.bank, amount: "700" },
    ],
  });
  expect(await f.bal("expense:repairs")).toBe("1000.00");
  expect(await f.bal("money:" + f.cash)).toBe("700.00");
  expect(await f.bal("money:" + f.bank)).toBe("300.00");
});
test("A45 credit limit includes confirmed same-batch cash, ignores pending", async () => {
  const f = await fixture();
  await f.bill("9");
  const ownerCookie = await authCookie(f, "owner");
  const policy = await app.request(
    "http://localhost:5173/api/v1/salesmen/" + f.s1,
    {
      method: "PATCH",
      headers: {
        cookie: ownerCookie,
        origin: "http://localhost:5173",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: "S1",
        creditLimit: "1000.00",
        details: {},
        active: true,
      }),
    },
  );
  expect(policy.status).toBe(200);
  const p = {
    date,
    salesmanId: f.s1,
    lines: [{ productId: f.product, quantity: "5" }],
    receipts: [
      {
        amount: "400",
        accountId: f.cash,
        method: "cash",
        actualDate: date,
        reference: "",
      },
    ],
  };
  await f.run("bill", p, crypto.randomUUID(), f.manager);
  expect(await due(f)).toBe("1000.00");
  await expect(
    f.run(
      "bill",
      {
        ...p,
        receipts: [
          {
            amount: "400",
            accountId: f.bank,
            method: "online",
            actualDate: date,
            reference: "Pending",
          },
        ],
      },
      crypto.randomUUID(),
      f.manager,
    ),
  ).rejects.toThrow();
});
test("A46 client totals, roles and account IDs cannot manipulate posting", async () => {
  const f = await fixture(),
    other = await fixture();
  await expect(
    f.run("bill", {
      date,
      salesmanId: f.s1,
      lines: [{ productId: f.product, quantity: "1" }],
      amount: "1",
    }),
  ).rejects.toThrow();
  await expect(
    f.run("receipt", {
      date,
      actualDate: date,
      salesmanId: f.s1,
      amount: "100",
      accountId: other.cash,
      method: "cash",
      reference: "",
    }),
  ).rejects.toThrow();
  await expect(
    f.run(
      "owner",
      {
        date,
        classification: "contribution",
        amount: "100",
        accountId: f.cash,
      },
      crypto.randomUUID(),
      { ...f.manager, role: "owner" },
    ),
  ).rejects.toThrow();
});
test("A47 deactivation retains history, old dues still collectible", async () => {
  const f = await fixture();
  await f.bill("10");
  await db.execute(sql`update salesmen set active=false where id=${f.s1}`);
  await expect(f.bill("1")).rejects.toThrow();
  await f.receipt("1000");
  expect(await due(f)).toBe("0.00");
});
test("A49 all journal entries balance and posted history rejects mutation", async () => {
  const f = await fixture();
  await f.fund();
  const b = await f.bill("10");
  await f.receipt("1000");
  await ret(f, b, "2");
  const bad = await rows(
    db,
    sql`select document_id from journal where org=${f.org} group by document_id having sum(debit-credit)<>0`,
  );
  expect(bad).toHaveLength(0);
  await expect(
    Promise.resolve(
      db.execute(sql`update documents set amount='1' where id=${b.id}`),
    ),
  ).rejects.toThrow();
  await expect(
    db.transaction(async (t) => {
      await t.execute(
        sql`insert into documents(org,number,kind,business_date,amount,data,actor) values(${f.org},${"BAD-" + n++},'bill',${date},'1','{}',${f.owner.id})`,
      );
    }),
  ).rejects.toThrow();
});
test("A51 cumulative partial returns conserve original paise", async () => {
  const f = await fixture();
  await db.execute(
    sql`insert into product_configurations(org,product_id,effective_date,unit,base_unit,conversion,basis,rate,confirmed) values(${f.org},${f.product},${date},'unit','unit','1','1','10.005',true)`,
  );
  const b = await f.bill("3"),
    r1 = await ret(f, b, "1"),
    r2 = await ret(f, b, "2");
  expect(D(String(r1.amount)).plus(String(r2.amount)).toFixed(2)).toBe("30.02");
  expect(await due(f)).toBe("0.00");
});
test("A52 future date and manager backdate blocked", async () => {
  const f = await fixture();
  await expect(
    f.run("bill", {
      date: "2099-01-01",
      salesmanId: f.s1,
      lines: [{ productId: f.product, quantity: "1" }],
    }),
  ).rejects.toThrow();
  await expect(
    f.run(
      "bill",
      {
        date: "2020-01-01",
        salesmanId: f.s1,
        lines: [{ productId: f.product, quantity: "1" }],
      },
      crypto.randomUUID(),
      f.manager,
    ),
  ).rejects.toThrow();
});
test("A53 cash custody independent, no extra expense/collection", async () => {
  const f = await fixture();
  await f.fund("5000");
  await f.run("transfer", {
    date,
    sourceId: f.cash,
    destinationId: f.cash2,
    amount: "2000",
  });
  expect(await f.bal("money:" + f.cash)).toBe("3000.00");
  expect(await f.bal("money:" + f.cash2)).toBe("2000.00");
  expect(await f.bal("expense:miscellaneous")).toBe("0.00");
});
test("A54 revoked member immediately loses session access", async () => {
  const f = await fixture(),
    cookie = await authCookie(f, "manager");
  expect((await request(cookie, "me")).status).toBe(200);
  await db.execute(
    sql`update members set active=false where org=${f.org} and user_id not in (${f.owner.id},${f.manager.id})`,
  );
  expect((await request(cookie, "me")).status).toBe(403);
});
test("A55 live organization cannot receive demo financial commands", async () => {
  const f = await fixture();
  await db.execute(sql`update organizations set mode='live' where id=${f.org}`);
  await expect(f.bill("1")).rejects.toThrow("Live posting is blocked");
  expect(await due(f)).toBe("0.00");
});
test("Split receipts post atomically with an unconfirmed online leg", async () => {
  const f = await fixture();
  await f.bill("10");
  const p = {
    date,
    salesmanId: f.s1,
    receipts: [
      {
        amount: "300",
        accountId: f.cash,
        method: "cash",
        actualDate: date,
        reference: "",
      },
      {
        amount: "700",
        accountId: f.bank,
        method: "online",
        actualDate: date,
        reference: "PENDING",
      },
    ],
  };
  await f.run("receiptBatch", p);
  expect(await due(f)).toBe("700.00");
  expect(await f.bal("money:" + f.cash)).toBe("300.00");
  expect(await f.bal("money:" + f.bank)).toBe("0.00");
});
test("Owner correction is classified, balanced and denied to forged manager roles", async () => {
  const f = await fixture();
  await f.bill("10");
  const p = {
    date,
    target: "trade",
    targetId: f.s1,
    direction: "decrease",
    amount: "100",
    category: "write_off",
    reason: "Owner-approved irrecoverable amount",
  };
  await expect(
    f.run("adjustment", p, crypto.randomUUID(), {
      ...f.manager,
      role: "owner",
    }),
  ).rejects.toThrow();
  await f.run("adjustment", p);
  expect(await due(f)).toBe("900.00");
  expect(await f.bal("adjustment:write_off")).toBe("100.00");
});
test("Opening batch preview, atomic rollback and stable batch/row identity", async () => {
  const f = await fixture(),
    cookie = await authCookie(f, "owner");
  const p = {
    date,
    batchId: "approved-cutover",
    rows: [
      { rowId: "1", target: "trade", targetId: f.s1, amount: "5000" },
      { rowId: "2", target: "money", targetId: f.cash, amount: "2400" },
    ],
  };
  const preview = await request(cookie, "opening-import/preview", p);
  expect(preview.status).toBe(200);
  expect((await preview.json()).dryRun).toBe(true);
  expect(await due(f)).toBe("0.00");
  await expect(
    f.run("openingBatch", {
      ...p,
      rows: [
        ...p.rows,
        {
          rowId: "3",
          target: "trade",
          targetId: crypto.randomUUID(),
          amount: "10",
        },
      ],
    }),
  ).rejects.toThrow();
  expect(await due(f)).toBe("0.00");
  await f.run("openingBatch", p);
  await f.run("openingBatch", p);
  expect(await due(f)).toBe("5000.00");
  expect(await f.bal("money:" + f.cash)).toBe("2400.00");
  await expect(
    f.run("openingBatch", { ...p, rows: [{ ...p.rows[0], amount: "6000" }] }),
  ).rejects.toThrow();
});
test("Opening borrowing and staff balances can be repaid without fake money at cutover", async () => {
  const f = await fixture();
  const loan = await f.run("opening", {
    date,
    target: "borrowed",
    targetId: crypto.randomUUID(),
    counterparty: "Agreed opening lender",
    amount: "-7000",
    batchId: "O",
    rowId: "L",
  });
  expect(await f.bal("money:" + f.cash)).toBe("0.00");
  await f.fund("3000");
  await f.run("repay", {
    date,
    loanId: loan.id,
    accountId: f.cash,
    amount: "3000",
  });
  const [doc] = await rows<{ data: Row }>(
    db,
    sql`select data from documents where id=${loan.id}`,
  );
  expect(await f.bal(String(doc.data.target))).toBe("-4000.00");
});
test("Frozen owner approval posts once and leaves the manager request nonfinancial until approved", async () => {
  const f = await fixture();
  await f.fund("1000");
  const managerCookie = await authCookie(f, "manager"),
    ownerCookie = await authCookie(f, "owner");
  const response = await request(managerCookie, "requests", {
    command: "loan",
    payload: {
      date,
      direction: "given",
      counterparty: "Person",
      accountId: f.cash,
      amount: "200",
    },
    reason: "Please approve completed loan disbursement",
  });
  expect(response.status).toBe(201);
  const r = await response.json();
  expect(await f.bal("money:" + f.cash)).toBe("1000.00");
  expect(
    (await request(managerCookie, "requests/" + r.id + "/approve", {})).status,
  ).toBe(403);
  expect(
    (await request(ownerCookie, "requests/" + r.id + "/approve", {})).status,
  ).toBe(200);
  expect(
    (await request(ownerCookie, "requests/" + r.id + "/approve", {})).status,
  ).toBe(200);
  expect(await f.bal("money:" + f.cash)).toBe("800.00");
});
test("Report endpoints and CSV share decimal totals; records remain private", async () => {
  const f = await fixture();
  await f.bill("40");
  await f.receipt("100");
  const cookie = await authCookie(f, "owner");
  for (const name of [
    "outstanding",
    "products",
    "collections",
    "expenses",
    "loans",
    "deposits",
    "closes",
    "reconciliation",
    "claims",
    "ageing",
  ]) {
    const r = await request(cookie, `reports/${name}?from=${date}&to=${date}`);
    expect(r.status).toBe(200);
    expect(Array.isArray((await r.json()).rows)).toBe(true);
  }
  const csv = await request(
    cookie,
    `reports/outstanding?to=${date}&format=csv`,
  );
  expect(await csv.text()).toContain("3900.00");
  const book = await request(cookie, `books/${f.cash}?from=${date}&to=${date}`);
  expect((await book.json()).ending).toBe("100.00");
  const exp = await request(cookie, "portability-export");
  const text = await exp.text();
  expect(text).not.toContain("password");
  expect(text).not.toContain("sessionToken");
});
test("Reopening marks affected reconciliation snapshots stale", async () => {
  const f = await fixture();
  await f.run("reconcile", {
    date,
    accountId: f.bank,
    statement: "0",
    matches: [],
  });
  await f.run("reopen", { date, reason: "Opening date review" });
  const [r] = await rows(
    db,
    sql`select state from reconciliations where org=${f.org}`,
  );
  expect(r.state).toBe("stale");
});
test("Concurrent receipt allocation and refund dependency corrections conserve credit sources", async () => {
  const f = await fixture(),
    b = await f.bill("10");
  await Promise.all([f.receipt("700"), f.receipt("700")]);
  expect(await due(f)).toBe("-400.00");
  await ret(f, b, "2");
  const refundDoc = await refund(f, "600");
  await expect(
    f.run("reverse", {
      date,
      documentId: (
        await rows<{ id: string }>(
          db,
          sql`select id from documents where org=${f.org} and kind='return'`,
        )
      )[0].id,
      reason: "Would consume refunded credit",
    }),
  ).rejects.toThrow();
  await f.run("reverse", {
    date,
    documentId: refundDoc.id,
    reason: "Reverse dependent refund first",
  });
  expect(await due(f)).toBe("-600.00");
});
test("Draft version conflicts and atomic consumption prevent reopening an already posted draft", async () => {
  const f = await fixture();
  const [draft] = await rows<{ id: string }>(
    db,
    sql`insert into drafts(org,actor,data) values(${f.org},${f.owner.id},'{}') returning id`,
  );
  const p = {
      date,
      salesmanId: f.s1,
      lines: [{ productId: f.product, quantity: "1" }],
    },
    key = crypto.randomUUID();
  await expect(
    command(f.owner, "bill", p, key, { draftId: draft.id, draftVersion: 2 }),
  ).rejects.toThrow();
  const first = await command(f.owner, "bill", p, key, {
    draftId: draft.id,
    draftVersion: 1,
  });
  const retry = await command(f.owner, "bill", p, key, {
    draftId: draft.id,
    draftVersion: 1,
  });
  expect(first.id).toBe(retry.id);
  expect(
    await rows(db, sql`select id from drafts where id=${draft.id}`),
  ).toHaveLength(0);
});
test("Public registration and forged mutation origins are blocked", async () => {
  const f = await fixture(),
    cookie = await authCookie(f, "owner");
  const signup = await app.request(
    "http://localhost:5173/api/v1/auth/sign-up/email",
    {
      method: "POST",
      headers: {
        origin: "http://localhost:5173",
        "content-type": "application/json",
      },
      body: "{}",
    },
  );
  expect(signup.status).toBe(404);
  const forged = await app.request(
    "http://localhost:5173/api/v1/commands/bill",
    {
      method: "POST",
      headers: {
        cookie,
        origin: "https://untrusted.invalid",
        "content-type": "application/json",
      },
      body: "{}",
    },
  );
  expect(forged.status).toBe(403);
});
test("Prior cash differences remain explicit until reviewed owner resolution without hidden money", async () => {
  const f = await fixture();
  await f.fund("2400");
  await f.run("close", {
    date,
    counts: [
      { accountId: f.cash, counted: "2350", reason: "Initial count short" },
      { accountId: f.cash2, counted: "0", reason: "" },
    ],
  });
  const [close] = await rows<{ id: string }>(
    db,
    sql`select id from closes where org=${f.org} and account_id=${f.cash}`,
  );
  const cookie = await authCookie(f, "owner");
  expect(
    (await (await request(cookie, "dashboard")).json()).exceptions,
  ).toHaveLength(1);
  await expect(
    f.run(
      "resolveCloseException",
      {
        date,
        closeId: close.id,
        resolution: "recount_confirmed",
        reason: "Reviewed actual count",
      },
      crypto.randomUUID(),
      f.manager,
    ),
  ).rejects.toThrow();
  await f.run("resolveCloseException", {
    date,
    closeId: close.id,
    resolution: "recount_confirmed",
    reason: "Owner recount confirms full book cash was present",
  });
  expect(await f.bal("money:" + f.cash)).toBe("2400.00");
  expect(
    (await (await request(cookie, "dashboard")).json()).exceptions,
  ).toHaveLength(0);
});
test("Product and deposit reports include original and inverse movements exactly once", async () => {
  const f = await fixture();
  const b = await f.bill("10"),
    r = await ret(f, b, "2");
  await f.run("reverse", {
    date,
    documentId: r.id,
    reason: "Return correction",
  });
  await f.run("reverse", { date, documentId: b.id, reason: "Bill correction" });
  await f.fund("1000");
  const deposit = await f.run("deposit", {
    date,
    sourceId: f.cash,
    destinationId: f.bank,
    amount: "500",
  });
  const credit = await f.run("resolveDeposit", {
    date,
    depositId: deposit.id,
    accountId: f.bank,
    amount: "200",
    resolution: "credit",
    bankIdentity: "TEST-DEPOSIT-CREDIT",
  });
  await f.run("reverse", {
    date,
    documentId: credit.id,
    reason: "Incorrect deposit credit",
  });
  const cookie = await authCookie(f, "owner");
  const products = await (
    await request(cookie, `reports/products?from=${date}&to=${date}`)
  ).json();
  expect(D(products.rows[0].billed_quantity).isZero()).toBe(true);
  expect(D(products.rows[0].returned_quantity).isZero()).toBe(true);
  const deposits = await (
    await request(cookie, `reports/deposits?to=${date}`)
  ).json();
  expect(deposits.rows[0].credited).toBe("0.00");
  expect(deposits.rows[0].in_transit).toBe("500.00");
});
test("Configured document series starts safely and never reuses a reversed number", async () => {
  const f = await fixture();
  await db.execute(
    sql`update organizations set setup='{"documentPrefix":"FY26-","documentStart":"1000"}'::jsonb where id=${f.org}`,
  );
  const first = await f.bill("1");
  expect(first.number).toBe("FY26-BILL-001000");
  await f.run("reverse", {
    date,
    documentId: first.id,
    reason: "Incorrect entry",
  });
  const next = await f.bill("1");
  expect(next.number).not.toBe(first.number);
  expect(String(next.number)).toStartWith("FY26-BILL-");
});
test("Idempotent response lookup still rechecks the current actor permission", async () => {
  const f = await fixture();
  await f.fund("1000");
  const key = crypto.randomUUID(),
    p = {
      date,
      direction: "given",
      counterparty: "Borrower",
      accountId: f.cash,
      amount: "200",
    };
  await f.run("loan", p, key);
  await expect(f.run("loan", p, key, f.manager)).rejects.toThrow(
    "Owner approval",
  );
  expect(await f.bal("money:" + f.cash)).toBe("800.00");
});
test("A46 stale bill reviews reject changed balance or price before committing", async () => {
  const f = await fixture(),
    cookie = await authCookie(f, "owner"),
    p = {
      date,
      salesmanId: f.s1,
      lines: [{ productId: f.product, quantity: "1" }],
    };
  expect((await request(cookie, "commands/bill", p)).status).toBe(409);
  const initial = await (await request(cookie, "preview/bill", p)).json();
  await f.receipt("100");
  expect(
    (
      await request(cookie, "commands/bill", {
        ...p,
        expectedQuoteHash: initial.quoteHash,
      })
    ).status,
  ).toBe(409);
  const afterReceipt = await (await request(cookie, "preview/bill", p)).json();
  await db.execute(
    sql`insert into product_configurations(org,product_id,effective_date,unit,base_unit,conversion,basis,rate,confirmed) values(${f.org},${f.product},${date},'unit','unit','1','1','120',true)`,
  );
  expect(
    (
      await request(cookie, "commands/bill", {
        ...p,
        expectedQuoteHash: afterReceipt.quoteHash,
      })
    ).status,
  ).toBe(409);
  expect(await due(f)).toBe("-100.00");
  const fresh = await (await request(cookie, "preview/bill", p)).json();
  const saved = await request(cookie, "commands/bill", {
    ...p,
    expectedQuoteHash: fresh.quoteHash,
  });
  expect(saved.status).toBe(201);
  expect((await saved.json()).amount).toBe("120.00");
  expect(await due(f)).toBe("20.00");
});

test("Bill price/basis/discount snapshots conserve net credit across partial returns", async () => {
  const f = await fixture();
  const saved = await f.run("bill", {
    date,
    salesmanId: f.s1,
    lines: [
      {
        productId: f.product,
        quantity: "3",
        rate: "125",
        basis: "2",
        discount: { type: "fixed", value: "7.51" },
      },
    ],
  });
  expect(saved.amount).toBe("179.99");
  const [line] = await rows<{ id: string; snapshot: Row }>(
    db,
    sql`select id,snapshot from bill_lines where document_id=${saved.id}`,
  );
  expect(line.snapshot).toMatchObject({
    rate: "125",
    basis: "2",
    masterRate: "100.00000000",
    discountAmount: "7.51",
    grossAmount: "187.50",
  });
  const [config] = await rows(
    db,
    sql`select rate::text,basis::text from product_configurations where product_id=${f.product}`,
  );
  expect(config.rate).toBe("100.00000000");
  expect(config.basis).toBe("1.00000000");
  const first = await f.run("return", {
    date,
    lineId: line.id,
    quantity: "1",
    reason: "Fictional return",
  });
  expect(first.amount).toBe("60.00");
  const final = await f.run("return", {
    date,
    lineId: line.id,
    quantity: "2",
    reason: "Remaining fictional return",
  });
  expect(final.amount).toBe("119.99");
  expect(await due(f)).toBe("0.00");
});
test("Manager bill edits require frozen owner approval unless explicitly permitted", async () => {
  const f = await fixture(),
    managerCookie = await authCookie(f, "manager"),
    ownerCookie = await authCookie(f, "owner");
  const p = {
    date,
    salesmanId: f.s1,
    lines: [
      {
        productId: f.product,
        quantity: "2",
        rate: "120",
        discount: { type: "percent", value: "10" },
      },
    ],
  };
  const preview = await (
    await request(managerCookie, "preview/bill", p)
  ).json();
  expect(preview.total).toBe("216.00");
  expect(preview.needsOwnerApproval).toBe(true);
  const input = { ...p, expectedQuoteHash: preview.quoteHash };
  expect((await request(managerCookie, "commands/bill", input)).status).toBe(
    403,
  );
  expect(await due(f)).toBe("0.00");
  const submitted = await request(managerCookie, "requests", {
    command: "bill",
    payload: input,
    reason: "Owner review for fictional bill pricing",
  });
  expect(submitted.status).toBe(201);
  const pending = await submitted.json();
  const approved = await request(
    ownerCookie,
    "requests/" + pending.id + "/approve",
    {},
  );
  expect(approved.status).toBe(200);
  expect(await due(f)).toBe("216.00");
  expect(
    (await request(ownerCookie, "requests/" + pending.id + "/approve", {}))
      .status,
  ).toBe(200);
  expect(await due(f)).toBe("216.00");
});
test("Revoked bill edit permission blocks cached retries while preserving the original posting", async () => {
  const f = await fixture(),
    key = crypto.randomUUID();
  await db.execute(
    sql`update members set capabilities='{"editBillPrices":true,"applyBillDiscounts":true}'::jsonb where user_id=${f.manager.id}`,
  );
  const p = {
    date,
    salesmanId: f.s1,
    lines: [
      {
        productId: f.product,
        quantity: "1",
        rate: "120",
        discount: { type: "fixed", value: "1" },
      },
    ],
  };
  expect((await f.run("bill", p, key, f.manager)).amount).toBe("119.00");
  await db.execute(
    sql`update members set capabilities='{}'::jsonb where user_id=${f.manager.id}`,
  );
  await expect(f.run("bill", p, key, f.manager)).rejects.toThrow(
    "Owner approval",
  );
  expect(await due(f)).toBe("119.00");
});
test("Bill review hash binds per-line prices even when a changed payload has the same total", async () => {
  const f = await fixture(),
    cookie = await authCookie(f, "owner");
  const p = {
    date,
    salesmanId: f.s1,
    lines: [
      { productId: f.product, quantity: "1", rate: "110" },
      { productId: f.product, quantity: "1", rate: "90" },
    ],
  };
  const preview = await (await request(cookie, "preview/bill", p)).json();
  expect(preview.total).toBe("200.00");
  const tampered = {
    ...p,
    expectedQuoteHash: preview.quoteHash,
    lines: [
      { productId: f.product, quantity: "1", rate: "120" },
      { productId: f.product, quantity: "1", rate: "80" },
    ],
  };
  expect((await request(cookie, "commands/bill", tampered)).status).toBe(409);
  expect(await due(f)).toBe("0.00");
});

test("Owner bill-pricing capabilities are explicit, independent and preserved by unrelated access updates", async () => {
  const f = await fixture(),
    ownerCookie = await authCookie(f, "owner"),
    managerCookie = await authCookie(f, "manager");
  const me = await (await request(managerCookie, "me")).json();
  const patch = async (body: unknown) =>
    app.request("http://localhost:5173/api/v1/members/" + me.id, {
      method: "PATCH",
      headers: {
        cookie: ownerCookie,
        origin: "http://localhost:5173",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
  expect(
    (await patch({ active: true, verifyOnline: false, editBillPrices: true }))
      .status,
  ).toBe(200);
  const p = {
    date,
    salesmanId: f.s1,
    lines: [
      {
        productId: f.product,
        quantity: "1",
        rate: "120",
        discount: { type: "fixed", value: "2" },
      },
    ],
  };
  expect(
    (await (await request(managerCookie, "preview/bill", p)).json())
      .needsOwnerApproval,
  ).toBe(true);
  expect(
    (
      await patch({
        active: true,
        verifyOnline: false,
        applyBillDiscounts: true,
      })
    ).status,
  ).toBe(200);
  expect((await patch({ active: true, verifyOnline: true })).status).toBe(200);
  const quote = await (await request(managerCookie, "preview/bill", p)).json();
  expect(quote.needsOwnerApproval).toBe(false);
  expect(
    (
      await request(managerCookie, "commands/bill", {
        ...p,
        expectedQuoteHash: quote.quoteHash,
      })
    ).status,
  ).toBe(201);
  expect(await due(f)).toBe("118.00");
});
