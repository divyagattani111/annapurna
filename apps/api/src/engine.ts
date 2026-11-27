import { sql, type SQL } from "drizzle-orm";
import { db, type Tx } from "@ledger/db";
import { commands, type CommandName, type Inputs } from "@ledger/contracts";
import {
  D,
  money,
  positive,
  billLinePricing,
  billPricingNeedsApproval,
  returnAmount,
  businessDate,
  quoteFingerprint,
} from "./money";
export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 422,
  ) {
    super(message);
  }
}
export type Actor = {
  id: string;
  org: string;
  role: "owner" | "manager" | "salesman";
  capabilities: Record<string, boolean>;
  /** Set when role === "salesman"; the salesman row id this user is linked to */
  salesmanId?: string;
};
export type Row = Record<string, unknown>;
export async function rows<T = Row>(
  tx: Tx | typeof db,
  query: SQL,
): Promise<T[]> {
  const started = performance.now();
  const result = (await tx.execute(query)).rows as T[];
  if (process.env.PROFILE_SQL === "1" && performance.now() - started > 100) {
    const first = query.queryChunks[0] as { value?: string[] };
    console.log(
      "Slow statement ms",
      Math.round(performance.now() - started),
      first.value?.[0]?.slice(0, 100),
    );
  }
  return result;
}
export function ensure(
  ok: unknown,
  message: string,
  code = "INVALID",
  status = 422,
): asserts ok {
  if (!ok) throw new DomainError(code, message, status);
}
export const owner = (a: Actor) =>
  ensure(a.role === "owner", "Owner approval is required", "FORBIDDEN", 403);
export const ownerOrManager = (a: Actor) =>
  ensure(a.role === "owner" || a.role === "manager", "Owner or Manager permission is required", "FORBIDDEN", 403);
export const auditEvent = async (
  t: Tx,
  a: Actor,
  action: string,
  target: string,
  data: unknown,
) => {
  await lock(t, a.org);
  await t.execute(
    sql`insert into audit(org,actor,action,target,data) values(${a.org},${a.id},${action},${target},${JSON.stringify(data)}::jsonb)`,
  );
};
export const lock = async (t: Tx, org: string) => {
  await t.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${org},0))`,
  );
};
const trade = (id: string) => `trade:${id}`;
const cash = (id: string) => `money:${id}`;
export function isDirectRouteSalesman(salesman?: {
  name?: string | null;
  details?: unknown;
}): boolean {
  if (!salesman) return false;
  const details =
    typeof salesman.details === "object" && salesman.details !== null
      ? (salesman.details as Record<string, unknown>)
      : {};
  if (
    details.is_direct_route === "true" ||
    details.is_direct_route === true ||
    details.isDirectRoute === "true" ||
    details.isDirectRoute === true ||
    details.direct_route === "true" ||
    details.direct_route === true
  ) {
    return true;
  }
  const sName = String(salesman.name ?? "").toLowerCase();
  return sName.includes("mubashir") || sName.includes("mudashir");
}
export async function balance(
  t: Tx | typeof db,
  org: string,
  account: string,
  asOf = businessDate(),
) {
  const [r] = await rows<{ balance: string }>(
    t,
    sql`select coalesce(sum(j.debit-j.credit),0)::numeric(18,2)::text balance from journal j join documents d on d.id=j.document_id where j.org=${org} and j.account=${account} and d.business_date<=${asOf}::date`,
  );
  return r.balance;
}
export async function customerBalance(
  t: Tx | typeof db,
  org: string,
  customerId: string,
  asOf = businessDate(),
) {
  const [r] = await rows<{ balance: string }>(
    t,
    sql`
      select (
        coalesce(sum(case when d.kind in ('bill', 'opening') then d.amount::numeric else 0 end), 0)
        - coalesce(sum(case when d.kind in ('receipt', 'identify', 'return') then d.amount::numeric else 0 end), 0)
      )::numeric(18,2)::text as balance
      from documents d
      left join documents orig on orig.id::text = d.data->>'billId' and orig.org = d.org
      where d.org = ${org}
        and coalesce(d.customer_id, orig.customer_id) = ${customerId}::uuid
        and d.kind in ('bill', 'opening', 'receipt', 'identify', 'return')
        and d.business_date <= ${asOf}::date
        and not exists(select 1 from documents rev where rev.org = d.org and rev.reverses = d.id)
    `,
  );
  return r?.balance ?? "0.00";
}
export async function scoped(
  t: Tx,
  a: Actor,
  table:
    | "salesmen"
    | "money_accounts"
    | "documents"
    | "bill_lines"
    | "receipt_claims"
    | "cash_handovers",
  id: string,
) {
  const [r] = await rows(
    t,
    sql`select * from ${sql.identifier(table)} where org=${a.org} and id=${id} limit 1`,
  );
  ensure(r, "Record not found", "NOT_FOUND", 404);
  return r;
}
export type MoneyAccount = {
  id: string;
  org: string;
  name: string;
  type: string;
  holder: string;
  active: boolean;
  allow_overdraft?: boolean;
  details?: Record<string, unknown>;
  [key: string]: unknown;
};
async function account(t: Tx, a: Actor, id: string, type?: string): Promise<MoneyAccount> {
  const r = (await scoped(t, a, "money_accounts", id)) as unknown as MoneyAccount;
  ensure(r.active, "Account is inactive");
  if (type) ensure(r.type === type, `Select a ${type} account`);
  return r;
}
async function effective(t: Tx, a: Actor, id: string) {
  const r = await scoped(t, a, "documents", id);
  const rev = await rows(
    t,
    sql`select id from documents where org=${a.org} and reverses=${id}`,
  );
  ensure(!rev.length && r.kind !== "reversal", "Document has been reversed");
  return r;
}
export type Leg = { account: string; debit?: string; credit?: string };
async function post(
  t: Tx,
  a: Actor,
  kind: string,
  date: string,
  amount: string,
  data: Row,
  legs: Leg[],
  salesmanId?: string,
  reverses?: string,
) {
  const debits = legs.reduce((s, l) => s.plus(l.debit ?? "0"), D(0)),
    credits = legs.reduce((s, l) => s.plus(l.credit ?? "0"), D(0));
  ensure(
    debits.eq(credits) && debits.isPositive(),
    "Unbalanced or empty financial entry",
  );
  const [seq] = await rows<{ n: string }>(
    t,
    sql`select nextval('document_numbers')::text n`,
  );
  const [organization] = await rows<{
    setup: {
      documentPrefix?: string;
      documentStart?: string;
      documentBase?: string;
    };
  }>(t, sql`select setup from organizations where id=${a.org}`);
  const series = organization.setup;
  let base = series.documentBase,
    start = series.documentStart ?? "1";
  if (!base) {
    const [history] = await rows<{ maximum: string | null }>(
      t,
      sql`select max(substring(number from '[0-9]+$')::numeric)::text maximum from documents where org=${a.org}`,
    );
    if (history.maximum !== null)
      start = (BigInt(history.maximum) + 1n).toString();
    base = seq.n;
    await t.execute(
      sql`update organizations set setup=setup||${JSON.stringify({ documentBase: base, documentStart: start })}::jsonb where id=${a.org}`,
    );
  }
  const issued = (BigInt(seq.n) - BigInt(base) + BigInt(start)).toString();
  const id = crypto.randomUUID(),
    prefix =
      kind === "foods_receipt"
        ? "FOODS-RECEIPT"
        : kind === "employee_receipt"
          ? "EMP-RECEIPT"
          : kind.toUpperCase(),
    number = `${series.documentPrefix ?? ""}${prefix}-${issued.padStart(6, "0")}`;

  let customerId: string | null = null;
  if (data.customerId) {
    const rawCust = String(data.customerId);
    const [cust] = await rows<{ id: string }>(
      t,
      sql`select id from itc_customers where org=${a.org} and (id::text = ${rawCust} or customer_id = ${rawCust}) limit 1`,
    );
    if (cust) customerId = cust.id;
  } else if ((kind === "return" || data.billId) && data.billId) {
    const rawBill = String(data.billId);
    const [orig] = await rows<{ customer_id: string | null }>(
      t,
      sql`select customer_id from documents where org=${a.org} and id::text = ${rawBill} limit 1`,
    );
    if (orig?.customer_id) customerId = orig.customer_id;
  }

  let returnLineId: string | null = null;
  if (kind === "return" && data.lineId) {
    const rawLine = String(data.lineId);
    const [line] = await rows<{ id: string }>(
      t,
      sql`select id from bill_lines where org=${a.org} and id::text = ${rawLine} limit 1`,
    );
    if (line) returnLineId = line.id;
  }

  let employeeId: string | null = null;
  if (data.employeeId) {
    const rawEmp = String(data.employeeId);
    const [emp] = await rows<{ id: string }>(
      t,
      sql`select id from employees where org=${a.org} and id::text = ${rawEmp} limit 1`,
    );
    if (emp) employeeId = emp.id;
  } else if (data.employeeName || data.payee) {
    const rawName = String(data.employeeName || data.payee).trim();
    const [emp] = await rows<{ id: string }>(
      t,
      sql`select id from employees where org=${a.org} and lower(name) = lower(${rawName}) limit 1`,
    );
    if (emp) employeeId = emp.id;
  }

  let foodsSalesmanId: string | null = null;
  if (data.foodsSalesmanId) {
    const rawFoods = String(data.foodsSalesmanId);
    const [foods] = await rows<{ id: string }>(
      t,
      sql`select id from foods_salesmen where org=${a.org} and id::text = ${rawFoods} limit 1`,
    );
    if (foods) foodsSalesmanId = foods.id;
  } else if (data.foodsSalesman) {
    const rawName = String(data.foodsSalesman).trim();
    const [foods] = await rows<{ id: string }>(
      t,
      sql`select id from foods_salesmen where org=${a.org} and lower(name) = lower(${rawName}) limit 1`,
    );
    if (foods) foodsSalesmanId = foods.id;
  }

  await t.execute(
    sql`insert into documents(id,org,number,kind,business_date,actual_date,salesman_id,amount,data,actor,reverses,customer_id,return_line_id,employee_id,foods_salesman_id) values(${id},${a.org},${number},${kind},${date},${String(data.actualDate ?? date)},${salesmanId ?? null},${amount},${JSON.stringify(data)}::jsonb,${a.id},${reverses ?? null},${customerId},${returnLineId},${employeeId},${foodsSalesmanId})`,
  );
  for (const l of legs) {
    await t.execute(
      sql`insert into journal(org,document_id,account,debit,credit) values(${a.org},${id},${l.account},${l.debit ?? "0"},${l.credit ?? "0"})`,
    );
  }
  await auditEvent(t, a, "post", id, { kind, number });
  return { id, number, amount };
}
async function bankIdentity(
  t: Tx,
  a: Actor,
  accountId: string,
  identity: string | undefined | null,
  documentId: string,
) {
  if (!identity || !identity.trim()) return;
  await t.execute(
    sql`insert into bank_identities(org,account_id,identity,document_id) values(${a.org},${accountId},${identity.trim()},${documentId})`,
  );
}
async function checkDate(t: Tx, a: Actor, date: string) {
  ensure(date <= businessDate(), "Future completed postings are blocked");
  if (a.role === "manager" || a.role === "salesman")
    ensure(
      date === businessDate(),
      "Postings are only allowed on the current business date",
    );
  const closed = await rows(
    t,
    sql`select id from periods where org=${a.org} and date=${date} and closed=true`,
  );
  ensure(!closed.length, "This business date is closed", "DATE_CLOSED", 409);
  const later = await rows(
    t,
    sql`select id from periods where org=${a.org} and date>${date} and closed=true`,
  );
  ensure(
    !later.length,
    "Reopen affected later closes before historical posting",
    "DATE_CLOSED",
    409,
  );
}
type Item = {
  id: string;
  kind: string;
  business_date: string;
  amount: string;
  data: Row;
  delta: string;
  customer_id?: string | null;
};
export async function allocate(
  t: Tx,
  a: Actor,
  salesmanId: string,
  preferred: string[] = [],
) {
  const items = await rows<Item>(
    t,
    sql`select d.id,d.kind,d.business_date::text,d.amount,d.data,d.customer_id,sum(j.debit-j.credit)::text delta from documents d join journal j on j.document_id=d.id and j.account=${trade(salesmanId)} where d.org=${a.org} and d.kind<>'reversal' and not exists(select 1 from documents r where r.org=d.org and r.reverses=d.id) group by d.id order by d.business_date,d.created_at,d.id`,
  );

  const getCustomerKey = (x: Item): string | null => {
    if (x.customer_id) return String(x.customer_id);
    const dataCustId = (x.data as Row | undefined)?.customerId;
    if (dataCustId) return String(dataCustId);
    const origBillId = (x.data as Row | undefined)?.billId;
    if (origBillId) {
      const orig = items.find((it) => it.id === origBillId);
      if (orig) {
        if (orig.customer_id) return String(orig.customer_id);
        const ocid = (orig.data as Row | undefined)?.customerId;
        if (ocid) return String(ocid);
        const ocname = (orig.data as Row | undefined)?.customerName;
        if (ocname && String(ocname).trim()) return String(ocname).trim().toLowerCase();
      }
    }
    const dataCustName = (x.data as Row | undefined)?.customerName;
    if (dataCustName && String(dataCustName).trim()) {
      return String(dataCustName).trim().toLowerCase();
    }
    return null;
  };

  const charges = items
    .filter((x) => D(x.delta).gt(0))
    .map((x) => ({ ...x, left: D(x.delta), custKey: getCustomerKey(x) }));
  const credits = items
    .filter((x) => D(x.delta).lt(0))
    .map((x) => ({ ...x, left: D(x.delta).neg(), custKey: getCustomerKey(x) }));
  const generation = crypto.randomUUID();
  const apply = async (
    c: (typeof credits)[number],
    d: (typeof charges)[number],
  ) => {
    const amount = D(c.left.lt(d.left) ? c.left : d.left);
    if (amount.isZero()) return;
    c.left = c.left.minus(amount);
    d.left = d.left.minus(amount);
    await t.execute(
      sql`insert into allocations(org,salesman_id,generation,credit_id,charge_id,amount) values(${a.org},${salesmanId},${generation},${c.id},${d.id},${money(amount)})`,
    );
  };
  // Refunds consume actual credit capacity; return credits first settle their original bills.
  for (const c of credits.filter((c) => c.kind === "return")) {
    const d = charges.find((d) => d.id === c.data.billId);
    if (d) await apply(c, d);
  }
  for (const d of charges.filter((d) => d.kind === "refund")) {
    const eligibleCredits = d.custKey ? credits.filter((c) => c.custKey === d.custKey) : credits;
    for (const c of eligibleCredits) await apply(c, d);
    ensure(
      d.left.isZero(),
      "Correction would invalidate an existing refund; reverse dependent refund first",
    );
  }
  for (const p of preferred)
    ensure(
      charges.some((c) => c.id === p),
      "Preferred bill belongs to another account or is not effective",
    );

  // Customer-isolated matching: receipts of customer A only settle charges of customer A
  const customerKeys = new Set<string>();
  for (const c of credits) if (c.custKey) customerKeys.add(c.custKey);
  for (const d of charges) if (d.custKey) customerKeys.add(d.custKey);

  for (const custKey of customerKeys) {
    const custCredits = credits.filter((c) => c.custKey === custKey);
    const custCharges = charges.filter((d) => d.custKey === custKey);
    const ordered = [...custCharges].sort((x, y) => {
      const xi = preferred.indexOf(x.id),
        yi = preferred.indexOf(y.id);
      return (xi < 0 ? preferred.length : xi) - (yi < 0 ? preferred.length : yi);
    });
    for (const c of custCredits) {
      for (const d of ordered) {
        await apply(c, d);
      }
    }
  }

  // General items without a specific customer tagged:
  const generalCredits = credits.filter((c) => !c.custKey);
  const generalCharges = charges.filter((d) => !d.custKey);
  const orderedGeneral = [...generalCharges].sort((x, y) => {
    const xi = preferred.indexOf(x.id),
      yi = preferred.indexOf(y.id);
    return (xi < 0 ? preferred.length : xi) - (yi < 0 ? preferred.length : yi);
  });
  for (const c of generalCredits) {
    for (const d of orderedGeneral) {
      await apply(c, d);
    }
  }

  await t.execute(
    sql`insert into allocation_heads(salesman_id,org,generation) values(${salesmanId},${a.org},${generation}) on conflict(salesman_id) do update set generation=excluded.generation`,
  );
  await auditEvent(t, a, "allocations", salesmanId, { generation, preferred });
}
async function receive(
  t: Tx,
  a: Actor,
  p: Inputs["receipt"],
  billId?: string,
  batchId?: string,
) {
  ensure(
    p.actualDate <= businessDate(),
    "Actual payment date cannot be in the future",
  );
  const salesman = await scoped(t, a, "salesmen", p.salesmanId);
  const acc = await account(
    t,
    a,
    p.accountId,
    p.method === "cash" ? "cash" : "bank",
  );
  positive(p.amount);
  let customerName: string | undefined;
  if (p.customerId) {
    const [cRow] = await rows<{ customer_name: string }>(
      t,
      sql`select customer_name from itc_customers where org=${a.org} and id=${p.customerId}`,
    );
    if (cRow) customerName = cRow.customer_name;
  }
  const isDirect = isDirectRouteSalesman(salesman as { name?: string | null; details?: unknown });
  let targetAccountId = p.accountId;
  let targetAccount = acc;

  if (isDirect && p.method === "cash") {
    const isMudhasirCashAcc =
      acc.type === "cash" &&
      (acc.name.toLowerCase().includes("mudhasir") ||
        acc.name.toLowerCase().includes("mubashir") ||
        acc.holder.toLowerCase().includes("mudhasir") ||
        acc.holder.toLowerCase().includes("mubashir"));

    if (!isMudhasirCashAcc) {
      const [mudhasirCash] = await rows<{ id: string; name: string; type: string; holder: string }>(
        t,
        sql`select id, name, type, holder from money_accounts where org=${a.org} and active=true and type='cash' and (name ilike '%mudhasir%' or name ilike '%mubashir%' or holder ilike '%mudhasir%' or holder ilike '%mubashir%') limit 1`,
      );
      if (mudhasirCash) {
        targetAccountId = mudhasirCash.id;
        targetAccount = { ...acc, id: mudhasirCash.id, name: mudhasirCash.name, holder: mudhasirCash.holder };
      }
    }
  } else if (isDirect && p.method === "online") {
    const isMudhasirAcc =
      acc.name.toLowerCase().includes("mudhasir") ||
      acc.name.toLowerCase().includes("mubashir") ||
      acc.holder.toLowerCase().includes("mudhasir") ||
      acc.holder.toLowerCase().includes("mubashir");

    if (!isMudhasirAcc) {
      const [mudhasirBank] = await rows<{ id: string; name: string; type: string; holder: string }>(
        t,
        sql`select id, name, type, holder from money_accounts where org=${a.org} and active=true and type='bank' and (name ilike '%mudhasir%' or name ilike '%mubashir%' or holder ilike '%mudhasir%' or holder ilike '%mubashir%') limit 1`,
      );
      if (mudhasirBank) {
        targetAccountId = mudhasirBank.id;
        targetAccount = { ...acc, id: mudhasirBank.id, name: mudhasirBank.name, holder: mudhasirBank.holder };
      }
    }
  }

  const debitAccount = cash(targetAccountId);

  let prevBal = D(0);
  if (p.customerId) {
    const custBal = await customerBalance(t, a.org, p.customerId, p.actualDate);
    prevBal = D(custBal);
  } else if (p.salesmanId) {
    const [prevRow] = await rows<{ bal: string }>(
      t,
      sql`select coalesce(sum(j.debit - j.credit), 0)::text bal from journal j join documents doc on doc.id = j.document_id where j.org=${a.org} and j.account=${trade(p.salesmanId)} and not exists(select 1 from documents rev where rev.org=${a.org} and rev.reverses=doc.id)`,
    );
    prevBal = D(prevRow?.bal || "0");
  }
  const overallOut = prevBal.minus(p.amount);

  const r = await post(
    t,
    a,
    "receipt",
    p.date,
    money(p.amount),
    {
      ...p,
      accountId: targetAccountId,
      billId,
      batchId,
      customerName,
      accountName: isDirect && p.method === "cash" ? `${salesman.name} (In Hand)` : targetAccount.name,
      salesmanName: salesman.name,
      previousBalance: money(prevBal),
      currentAmountReceived: money(p.amount),
      overallOutstanding: money(overallOut),
    },
    [
      { account: debitAccount, debit: p.amount },
      { account: trade(p.salesmanId), credit: p.amount },
    ],
    p.salesmanId,
  );
  return r;
}
function canonical(v: unknown): string {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object")
    return (
      "{" +
      Object.entries(v)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => JSON.stringify(k) + ":" + canonical(x))
        .join(",") +
      "}"
    );
  return JSON.stringify(v);
}
export async function command<K extends CommandName>(
  a: Actor,
  name: K,
  input: unknown,
  key: string,
  opts: {
    failAfterPost?: boolean;
    requestId?: string;
    draftId?: string;
    draftVersion?: number;
  } = {},
) {
  ensure(
    key.length >= 16 && key.length <= 200,
    "A stable idempotency key is required",
  );
  const p = commands[name].parse(input) as Inputs[K];
  const hash = new Bun.CryptoHasher("sha256")
    .update(canonical({ name, p }))
    .digest("hex");
  return db.transaction(async (t) => {
    await lock(t, a.org);
    const [membership] = await rows<{
      active: boolean;
      role: Actor["role"];
      capabilities: Actor["capabilities"];
    }>(
      t,
      sql`select active,role,capabilities from members where org=${a.org} and user_id=${a.id}`,
    );
    ensure(membership?.active, "Access revoked", "FORBIDDEN", 403);
    a = { ...a, role: membership.role, capabilities: membership.capabilities };
    const ownerCommands: CommandName[] = [
      "refund",
      "opening",
      "openingBatch",
      "loan",
      "repay",
      "owner",
      "reverse",
      "reopen",
      "adjustment",
      "resolveCloseException",
    ];
    if (ownerCommands.includes(name)) owner(a);
    const payload = p as unknown as {
      method?: string;
      verified?: boolean;
      receipts?: { method: string; verified: boolean }[];
    };
    if (
      name === "verify" ||
      name === "reject" ||
      name === "confirmCashHandover" ||
      name === "receiveSalesmanCash"
    )
      ensure(
        a.role === "owner" || a.capabilities.verifyOnline !== false,
        "Online verification permission revoked",
        "FORBIDDEN",
        403,
      );
    if (name === "bill")
      ensure(
        !billPricingNeedsApproval(a, (p as Inputs["bill"]).lines),
        "Owner approval or explicit bill-pricing permission is required for rate, basis or discount edits",
        "FORBIDDEN",
        403,
      );
    const [old] = await rows<{ hash: string; result: Row }>(
      t,
      sql`select hash,result from idempotency where org=${a.org} and key=${key}`,
    );
    if (old) {
      ensure(
        old.hash === hash,
        "Idempotency key was already used with different input",
        "IDEMPOTENCY_CONFLICT",
        409,
      );
      return old.result;
    }
    if (opts.requestId) {
      owner(a);
      const [request] = await rows<{
        state: string;
        payload: { command: string; payload: unknown };
      }>(
        t,
        sql`select state,payload from requests where org=${a.org} and id=${opts.requestId} for update`,
      );
      ensure(request?.state === "pending", "Request is no longer pending");
      ensure(
        request.payload.command === name &&
        canonical(commands[name].parse(request.payload.payload)) ===
        canonical(p),
        "Approval payload changed",
      );
    }
    if (opts.draftId) {
      const [draft] = await rows<{ version: number }>(
        t,
        sql`select version from drafts where org=${a.org} and actor=${a.id} and id=${opts.draftId} for update`,
      );
      ensure(
        draft && draft.version === opts.draftVersion,
        "Draft changed or was already consumed",
        "DRAFT_CONFLICT",
        409,
      );
    }
    const [org] = await rows<{
      mode: string;
      setup: { liveApproved?: boolean };
    }>(t, sql`select mode,setup from organizations where id=${a.org}`);
    ensure(
      org.mode !== "live" || org.setup.liveApproved === true,
      "Live posting is blocked pending setup and independent acceptance review",
      "LIVE_SETUP_REQUIRED",
      409,
    );
    const date = "date" in p ? String(p.date) : businessDate();
    if (
      name !== "reopen" &&
      name !== "reject" &&
      name !== "resolveCloseException"
    )
      await checkDate(t, a, date);
    const result = await execute(t, a, name, p, date);
    if (opts.requestId) {
      await t.execute(
        sql`update requests set state='approved' where org=${a.org} and id=${opts.requestId}`,
      );
      await auditEvent(t, a, "approve", opts.requestId, { result });
    }
    if (opts.draftId)
      await t.execute(
        sql`delete from drafts where org=${a.org} and actor=${a.id} and id=${opts.draftId}`,
      );
    if (opts.failAfterPost) throw new Error("Injected rollback");
    // No money account may spend funds that do not exist. Historical outflows also check every subsequent running balance.
    const negative = await rows(
      t,
      sql`with running as(select m.id,m.type,m.allow_overdraft,d.id doc,sum(j.debit-j.credit) over(partition by m.id order by d.business_date,d.created_at,d.id rows unbounded preceding) bal from money_accounts m join journal j on j.account='money:'||m.id::text and j.org=m.org join documents d on d.id=j.document_id where m.org=${a.org}) select id from running where bal<0 and (type='cash' or not allow_overdraft) limit 1`,
    );
    ensure(
      !negative.length,
      "Insufficient book money. Check opening balances and earlier entries.",
    );
    await t.execute(
      sql`insert into idempotency(org,key,hash,result) values(${a.org},${key},${hash},${JSON.stringify(result)}::jsonb)`,
    );
    return result;
  });
}
async function execute<K extends CommandName>(
  t: Tx,
  a: Actor,
  name: K,
  p: Inputs[K],
  date: string,
): Promise<Row> {
  switch (name) {
    case "bill": {
      const b = p as Inputs["bill"];
      const salesman = await scoped(t, a, "salesmen", b.salesmanId);
      ensure(salesman.active, "Inactive salesman cannot receive new bills");
      let total = D(0);
      const lines = [];
      for (const l of b.lines) {
        if (l.productId) {
          const [prod] = await rows<{
            id: string;
            name: string;
            code: string;
            category: string;
            active: boolean;
            unit: string;
            base_unit: string;
            conversion: string;
            basis: string;
            rate: string;
            fractional: boolean;
            confirmed: boolean;
            configuration_id: string;
          }>(
            t,
            sql`select p.id,c.id configuration_id,p.name,p.code,p.category,p.active,c.unit,c.base_unit,c.conversion,c.basis,c.rate,c.fractional,c.confirmed from products p join product_configurations c on c.product_id=p.id and c.org=p.org where p.id=${l.productId} and p.org=${a.org} and c.effective_date<=${date} order by c.effective_date desc,c.created_at desc limit 1`,
          );
          ensure(
            prod?.active && prod.confirmed,
            "Product unit and rate must be confirmed and active",
          );
          const pricing = billLinePricing(l, prod);
          total = total.plus(pricing.amount);
          lines.push({
            ...l,
            amount: pricing.amount,
            snapshot: {
              ...prod,
              masterRate: prod.rate,
              masterBasis: prod.basis,
              rate: pricing.rate,
              basis: pricing.basis,
              grossAmount: pricing.gross,
              discountAmount: pricing.discount,
              discountType: pricing.discountType,
              discountInput: pricing.discountInput,
            },
          });
          // If this is a confectionery product and rate was changed while billing,
          // update the default selling rate in product_configurations for the master table
          if (
            (prod.category === "CF-05 CONFECTIONERY" || prod.category === "confectionery" || l.category === "CF-05 CONFECTIONERY" || l.category === "confectionery") &&
            l.rate &&
            !D(l.rate).eq(prod.rate)
          ) {
            await t.execute(
              sql`insert into product_configurations(org,product_id,effective_date,unit,base_unit,conversion,basis,rate,fractional,confirmed) values(${a.org},${prod.id},${date},${prod.unit},${prod.base_unit},${prod.conversion},${prod.basis},${l.rate},${prod.fractional},true)`,
            );
            await auditEvent(t, a, "product_configuration", prod.id, {
              reason: "rate_updated_from_confectionery_bill",
              rate: l.rate,
              previousRate: prod.rate,
            });
          }
        } else {
          // One-time manual product entry (e.g. ad-hoc confectionery item)
          ensure(
            Boolean(l.name && l.rate),
            "Manual product line must have a name and rate",
          );
          ensure(D(l.quantity).gt(0), "Line quantity must be positive");
          ensure(D(l.rate!).gt(0), "Line rate must be positive");
          const gross = money(D(l.quantity).times(l.rate!));
          let discountAmt = "0.00";
          let discountType = "fixed";
          let discountInput = "0";
          if (l.discount) {
            discountType = l.discount.type;
            discountInput = l.discount.value;
            discountAmt =
              l.discount.type === "percent"
                ? money(D(gross).times(l.discount.value).div(100))
                : money(l.discount.value);
          }
          const netAmt = money(D(gross).minus(discountAmt));
          total = total.plus(netAmt);
          lines.push({
            ...l,
            amount: netAmt,
            snapshot: {
              id: null,
              name: l.name!,
              code: l.code || "MANUAL",
              category: l.category || "CF-05 CONFECTIONERY",
              active: true,
              unit: "piece",
              base_unit: "piece",
              conversion: "1",
              basis: "1",
              rate: l.rate!,
              masterRate: l.rate!,
              masterBasis: "1",
              fractional: false,
              confirmed: true,
              grossAmount: gross,
              discountAmount: discountAmt,
              discountType,
              discountInput,
              configuration_id: null,
            },
          });
        }
      }
      const rawDiscount = b.discount ? D(b.discount) : D(0);
      ensure(
        !rawDiscount.isNegative(),
        "Bill discount cannot be negative",
      );
      ensure(
        total.gt(rawDiscount),
        "Bill discount cannot be greater than or equal to the total bill amount",
      );
      const subtotal = total;
      total = total.minus(rawDiscount);
      ensure(total.gt(0), "Bill must have a positive total");
      const [business] = await rows<{ name: string; setup: Row }>(
        t,
        sql`select name,setup from organizations where id=${a.org}`,
      );
      const salesmanPrevious = await balance(t, a.org, trade(b.salesmanId), date);
      const previous = b.customerId
        ? await customerBalance(t, a.org, b.customerId, date)
        : salesmanPrevious;
      const fingerprint = quoteFingerprint(
        date,
        b.salesmanId,
        previous,
        money(total),
        salesman.credit_limit === null ? null : String(salesman.credit_limit),
        lines.map((l) => ({
          productId: l.productId,
          name: l.snapshot.name,
          configurationId: l.snapshot.configuration_id,
          quantity: l.quantity,
          ...(l.rate !== undefined ? { rate: l.rate } : {}),
          ...(l.basis !== undefined ? { basis: l.basis } : {}),
          ...(l.discount !== undefined ? { discount: l.discount } : {}),
        })),
        b.receipts,
        b.discount ? money(b.discount) : "0.00",
      );
      if (b.expectedQuoteHash)
        ensure(
          b.expectedQuoteHash === fingerprint,
          "Prices, credit policy or account balance changed. Go back and review this bill again.",
          "STALE_REVIEW",
          409,
        );
      const confirmed = b.receipts
        .reduce((s, r) => s.plus(r.amount), D(0));
      const cashConfirmed = b.receipts
        .filter((r) => r.method === "cash")
        .reduce((s, r) => s.plus(r.amount), D(0));
      const onlineConfirmed = b.receipts
        .filter((r) => r.method === "online")
        .reduce((s, r) => s.plus(r.amount), D(0));
      const projected = D(previous).plus(total).minus(confirmed);
      const salesmanProjected = D(salesmanPrevious).plus(total).minus(confirmed);
      if (
        salesman.credit_limit !== null &&
        salesmanProjected.gt(String(salesman.credit_limit))
      ) {
        owner(a);
        ensure(
          b.overrideReason.length >= 3,
          "Credit-limit override requires a reason",
        );
      }
      let customerName: string | undefined;
      let customerRef: string | undefined;
      if (b.customerId) {
        const [cRow] = await rows<{ customer_name: string; customer_id: string }>(
          t,
          sql`select customer_name, customer_id from itc_customers where org=${a.org} and id=${b.customerId}`,
        );
        if (cRow) {
          customerName = cRow.customer_name;
          customerRef = cRow.customer_id;
        }
      }
      const r = await post(
        t,
        a,
        "bill",
        date,
        money(total),
        {
          ...b,
          customerName,
          customerRef,
          subtotal: money(subtotal),
          billDiscount: b.discount ? money(b.discount) : "0.00",
          previousBalance: previous,
          confirmed: money(confirmed),
          cashConfirmed: money(cashConfirmed),
          onlineConfirmed: money(onlineConfirmed),
          issueBalance: money(projected),
          salesmanPrevious,
          salesmanIssueBalance: money(salesmanProjected),
          salesmanName: salesman.name,
          businessName: business.name,
          businessProfile: business.setup,
          pendingAtIssue: "0.00",
        },
        [
          { account: trade(b.salesmanId), debit: money(total) },
          { account: "control:sales", credit: money(total) },
        ],
        b.salesmanId,
      );
      for (const l of lines)
        await t.execute(
          sql`insert into bill_lines(org,document_id,product_id,quantity,amount,snapshot) values(${a.org},${r.id},${l.productId ?? null},${l.quantity},${l.amount},${JSON.stringify(l.snapshot)}::jsonb)`,
        );
      const receipts = [];
      for (const child of b.receipts)
        receipts.push(
          await receive(
            t,
            a,
            { ...child, salesmanId: b.salesmanId, customerId: child.customerId ?? b.customerId, date, note: b.note },
            r.id,
          ),
        );
      await allocate(t, a, b.salesmanId);
      return { ...r, receipts };
    }
    case "receiptBatch": {
      const r = p as Inputs["receiptBatch"];
      const batchId = crypto.randomUUID(),
        saved = [];
      for (const child of r.receipts)
        saved.push(
          await receive(
            t,
            a,
            { ...child, salesmanId: r.salesmanId, customerId: child.customerId ?? r.customerId, date, note: r.note },
            undefined,
            batchId,
          ),
        );
      await allocate(t, a, r.salesmanId);
      await auditEvent(t, a, "receipt_batch", batchId, { receipts: saved });
      return { id: batchId, receipts: saved };
    }
    case "adjustment": {
      owner(a);
      const v = p as Inputs["adjustment"];
      positive(v.amount);
      if (v.target === "trade") {
        await scoped(t, a, "salesmen", v.targetId);
        ensure(
          v.category !== "cash_over_short",
          "Cash adjustment requires a money account",
        );
      } else {
        await account(t, a, v.targetId);
        ensure(
          v.category === "cash_over_short" ||
          v.category === "opening_correction",
          "Use a specific money correction category",
        );
      }
      const target = (v.target === "trade" ? "trade:" : "money:") + v.targetId,
        amount = money(v.amount);
      const saved = await post(
        t,
        a,
        "adjustment",
        date,
        amount,
        v,
        v.direction === "increase"
          ? [
            { account: target, debit: amount },
            { account: "adjustment:" + v.category, credit: amount },
          ]
          : [
            { account: "adjustment:" + v.category, debit: amount },
            { account: target, credit: amount },
          ],
        v.target === "trade" ? v.targetId : undefined,
      );
      if (v.target === "trade") await allocate(t, a, v.targetId);
      return saved;
    }
    case "receipt": {
      const r = p as Inputs["receipt"];
      const saved = await receive(t, a, r);
      await allocate(t, a, r.salesmanId);
      return saved;
    }
    case "verify": {
      const v = p as Inputs["verify"];
      ensure(
        a.role === "owner" || a.capabilities.verifyOnline !== false,
        "Verification permission revoked",
        "FORBIDDEN",
        403,
      );
      const c = await scoped(t, a, "receipt_claims", v.claimId);
      if (c.state === "confirmed") {
        return { id: String(c.document_id), state: "confirmed" };
      }
      ensure(c.state === "pending", "Only pending claims can be verified");

      let r: { id: string; amount: string; state?: string };
      if (c.foods_salesman_id) {
        // Verification of a foods online collection claim
        const [fsRow] = await rows<{ name: string }>(
          t,
          sql`select name from foods_salesmen where org=${a.org} and id=${c.foods_salesman_id}`,
        );
        const foodsName = fsRow?.name || "Foods";
        positive(String(c.amount));
        await account(t, a, String(c.account_id), "bank");

        r = await post(
          t,
          a,
          "foods_receipt",
          date,
          money(String(c.amount)),
          {
            foodsSalesman: foodsName,
            foodsSalesmanId: c.foods_salesman_id,
            billNo: c.reference || "",
            foodItems: "",
            method: "online",
            cashAmount: "0.00",
            bankAmount: money(String(c.amount)),
            claimId: v.claimId,
            note: v.evidence || "",
            verified: true,
          },
          [
            { account: cash(String(c.account_id)), debit: money(String(c.amount)) },
            { account: "revenue:foods", credit: money(String(c.amount)) },
          ],
        );
        await bankIdentity(t, a, String(c.account_id), v.bankIdentity, r.id);
        await t.execute(
          sql`update receipt_claims set state='confirmed',document_id=${r.id} where id=${v.claimId} and org=${a.org}`,
        );
      } else {
        r = await receive(t, a, {
          salesmanId: String(c.salesman_id),
          amount: String(c.amount),
          accountId: String(c.account_id),
          method: "online",
          actualDate: String(c.actual_date),
          reference: v.bankIdentity,
          verified: true,
          date,
          note: v.evidence,
        });
        await t.execute(
          sql`update receipt_claims set state='confirmed',document_id=${r.id} where id=${v.claimId} and org=${a.org}`,
        );
        await allocate(t, a, String(c.salesman_id));
      }
      await auditEvent(t, a, "verify", v.claimId, {
        ...v,
        verifiedAt: new Date().toISOString(),
      });
      return r;
    }
    case "reject": {
      const v = p as Inputs["reject"];
      ensure(
        a.role === "owner" || a.capabilities.verifyOnline !== false,
        "Verification permission revoked",
        "FORBIDDEN",
        403,
      );
      const c = await scoped(t, a, "receipt_claims", v.claimId);
      ensure(c.state === "pending", "Confirmed receipts require reversal");
      await t.execute(
        sql`update receipt_claims set state='rejected',reason=${v.reason} where id=${v.claimId}`,
      );
      await auditEvent(t, a, "reject", v.claimId, v);
      return { id: v.claimId, state: "rejected" };
    }
    case "return": {
      const r = p as Inputs["return"];
      const line = await scoped(t, a, "bill_lines", r.lineId);
      const bill = await effective(t, a, String(line.document_id));
      ensure(
        String(bill.business_date) <= date,
        "Return cannot precede its original bill",
      );
      const snap = line.snapshot as Row;
      ensure(
        Boolean(snap.fractional) || D(r.quantity).isInteger(),
        "This product requires whole quantities",
      );
      const [prior] = await rows<{ quantity: string; amount: string }>(
        t,
        sql`select coalesce(sum((d.data->>'quantity')::numeric),0)::text quantity,coalesce(sum(d.amount),0)::text amount from documents d where d.org=${a.org} and d.kind='return' and d.data->>'lineId'=${r.lineId} and not exists(select 1 from documents x where x.reverses=d.id and x.org=d.org)`,
      );
      const amount = returnAmount(
        String(line.quantity),
        String(line.amount),
        prior.quantity,
        prior.amount,
        r.quantity,
      );
      positive(amount);
      const saved = await post(
        t,
        a,
        "return",
        date,
        amount,
        {
          ...r,
          billId: bill.id,
          billNumber: bill.number,
          originalBillNumber: bill.number,
          salesmanName: (bill.data as Row)?.salesmanName,
          customerName: (bill.data as Row)?.customerName,
          snapshot: line.snapshot,
        },
        [
          { account: "control:returns", debit: amount },
          { account: trade(String(bill.salesman_id)), credit: amount },
        ],
        String(bill.salesman_id),
      );
      await allocate(t, a, String(bill.salesman_id));
      return saved;
    }
    case "refund": {
      owner(a);
      const r = p as Inputs["refund"];
      await scoped(t, a, "salesmen", r.salesmanId);
      await account(t, a, r.accountId);
      positive(r.amount);
      ensure(
        D(await balance(t, a.org, trade(r.salesmanId), date))
          .neg()
          .gte(r.amount),
        "Refund exceeds available credit",
      );
      const saved = await post(
        t,
        a,
        "refund",
        date,
        money(r.amount),
        r,
        [
          { account: trade(r.salesmanId), debit: r.amount },
          { account: cash(r.accountId), credit: r.amount },
        ],
        r.salesmanId,
      );
      await allocate(t, a, r.salesmanId);
      return saved;
    }
    case "openingBatch": {
      owner(a);
      const b = p as Inputs["openingBatch"];
      ensure(
        new Set(b.rows.map((r) => r.rowId)).size === b.rows.length,
        "Opening batch row IDs must be unique",
      );
      const records = [];
      for (const r of b.rows)
        records.push(
          await execute(
            t,
            a,
            "opening",
            { ...r, date, batchId: b.batchId, note: b.note },
            date,
          ),
        );
      return { id: b.batchId, records };
    }
    case "opening": {
      owner(a);
      const o = p as Inputs["opening"];
      ensure(!D(o.amount).isZero(), "Opening cannot be zero");
      ensure(
        o.legacyMode === "total",
        "Legacy item import is not enabled; use confirmed total mode with unknown legacy age",
      );
      const [old] = await rows(
        t,
        sql`select id,data,amount,number,business_date::text from documents where org=${a.org} and kind in ('opening','loan') and data->>'targetId'=${o.targetId} limit 1`,
      );
      if (old) {
        const data = old.data as Row;
        ensure(
          data.batchId === o.batchId &&
          data.rowId === o.rowId &&
          data.targetId === o.targetId &&
          String(old.business_date) === date &&
          D(String(data.amount)).eq(o.amount) &&
          data.legacyMode === o.legacyMode &&
          data.note === o.note &&
          data.counterparty === o.counterparty &&
          (data.openingTarget ??
            (data.opening === true
              ? data.direction === "given"
                ? "loan_given"
                : data.direction
              : data.target)) === o.target,
          "Opening already finalized; use a reviewed correction",
        );
        return {
          id: String(old.id),
          amount: String(old.amount),
          number: String(old.number),
        };
      }
      let target: string;
      let effectiveSalesmanId: string | undefined = undefined;
      if (o.target === "trade") {
        await scoped(t, a, "salesmen", o.targetId);
        target = trade(o.targetId);
        effectiveSalesmanId = o.targetId;
        const history = await rows(
          t,
          sql`select id from documents where org=${a.org} and salesman_id=${o.targetId} limit 1`,
        );
        ensure(
          !history.length,
          "Opening must precede operational history; legacy total and bills cannot both be loaded",
        );
      } else if (o.target === "customer") {
        const [cust] = await rows<{
          id: string;
          customer_id: string;
          customer_name: string;
          salesman_id: string | null;
        }>(
          t,
          sql`select id, customer_id, customer_name, salesman_id from itc_customers where org=${a.org} and id=${o.targetId}::uuid and active=true`,
        );
        ensure(cust, "Customer not found or inactive", "NOT_FOUND", 404);
        ensure(
          cust.salesman_id,
          "Customer must be assigned to a salesman to record opening balance",
        );
        await scoped(t, a, "salesmen", cust.salesman_id);
        target = trade(cust.salesman_id);
        effectiveSalesmanId = cust.salesman_id;
      } else if (o.target === "money") {
        await account(t, a, o.targetId);
        target = cash(o.targetId);
      } else if (
        o.target === "loan_given" ||
        o.target === "borrowed" ||
        o.target === "staff"
      ) {
        ensure(
          o.counterparty && o.counterparty.length >= 1,
          "Opening loan or staff balance requires a confirmed counterparty name",
        );
        ensure(
          o.target === "borrowed" ? D(o.amount).lt(0) : D(o.amount).gt(0),
          "Assets require a positive opening; borrowing a negative liability opening",
        );
        target =
          (o.target === "loan_given"
            ? "loan:"
            : o.target === "borrowed"
              ? "borrowed:"
              : "staff:") + o.targetId;
      } else {
        target =
          (o.target === "transit" ? "transit:" : "holding:") + o.targetId;
      }
      const abs = money(D(o.amount).abs());
      const openingLoan = ["loan_given", "borrowed", "staff"].includes(
        o.target,
      );
      const data: Row = {
        ...o,
        openingTarget: o.target,
        ...(o.target === "customer" ? { customerId: o.targetId } : {}),
        ...(openingLoan
          ? {
            direction:
              o.target === "loan_given"
                ? "given"
                : o.target === "borrowed"
                  ? "borrowed"
                  : "staff",
            target,
            loanId: o.targetId,
            opening: true,
          }
          : {}),
      };
      const saved = await post(
        t,
        a,
        openingLoan ? "loan" : "opening",
        date,
        abs,
        data,
        D(o.amount).gt(0)
          ? [
            { account: target, debit: abs },
            { account: "opening:clearing", credit: abs },
          ]
          : [
            { account: "opening:clearing", debit: abs },
            { account: target, credit: abs },
          ],
        effectiveSalesmanId,
      );
      if (effectiveSalesmanId) await allocate(t, a, effectiveSalesmanId);
      return saved;
    }
    case "expense": {
      const e = p as Inputs["expense"];
      positive(e.amount);
      ensure(
        e.legs.reduce((s, l) => s.plus(l.amount), D(0)).eq(e.amount),
        "Expense payment legs must equal the total",
      );
      const legs: Leg[] = [
        { account: "expense:" + e.category, debit: e.amount },
      ];
      for (const l of e.legs) {
        positive(l.amount);
        await account(t, a, l.accountId);
        legs.push({ account: cash(l.accountId), credit: l.amount });
      }
      return post(t, a, "expense", date, money(e.amount), e, legs);
    }
    case "transfer":
    case "deposit": {
      const v = p as Inputs["transfer"];
      positive(v.amount);
      ensure(
        v.sourceId !== v.destinationId,
        "Source and destination must differ",
      );
      await account(t, a, v.sourceId, name === "deposit" ? "cash" : undefined);
      await account(
        t,
        a,
        v.destinationId,
        name === "deposit" ? "bank" : undefined,
      );
      const transitId = crypto.randomUUID();
      return post(t, a, name, date, money(v.amount), { ...v, transitId }, [
        {
          account:
            name === "deposit" ? "transit:" + transitId : cash(v.destinationId),
          debit: v.amount,
        },
        { account: cash(v.sourceId), credit: v.amount },
      ]);
    }
    case "resolveDeposit": {
      const r = p as Inputs["resolveDeposit"];
      await rows(
        t,
        sql`select id from documents where org=${a.org} and id=${r.depositId} for update`,
      );
      const dep = await effective(t, a, r.depositId);
      ensure(dep.kind === "deposit", "Select a deposit");
      const data = dep.data as Row;
      positive(r.amount);
      const acc = await account(
        t,
        a,
        r.accountId,
        r.resolution === "credit" ? "bank" : "cash",
      );
      if (r.resolution === "credit")
        ensure(
          r.accountId === data.destinationId,
          "Deposit credit must use its designated bank",
        );
      const transit = "transit:" + String(data.transitId);
      ensure(
        D(await balance(t, a.org, transit, date)).gte(r.amount),
        "Deposit resolution exceeds transit remaining",
      );
      const saved = await post(
        t,
        a,
        "deposit_" + r.resolution,
        date,
        money(r.amount),
        { ...r, accountName: acc.name },
        [
          { account: cash(r.accountId), debit: r.amount },
          { account: transit, credit: r.amount },
        ],
      );
      if (r.resolution === "credit")
        await bankIdentity(t, a, r.accountId, r.bankIdentity, saved.id);
      return saved;
    }
    case "loan": {
      owner(a);
      const l = p as Inputs["loan"];
      await account(t, a, l.accountId);
      positive(l.amount);
      const loanId = crypto.randomUUID(),
        target =
          (l.direction === "borrowed"
            ? "borrowed:"
            : l.direction === "staff"
              ? "staff:"
              : "loan:") + loanId;
      return post(
        t,
        a,
        "loan",
        date,
        money(l.amount),
        { ...l, loanId, target },
        l.direction === "borrowed"
          ? [
            { account: cash(l.accountId), debit: l.amount },
            { account: target, credit: l.amount },
          ]
          : [
            { account: target, debit: l.amount },
            { account: cash(l.accountId), credit: l.amount },
          ],
      );
    }
    case "repay": {
      owner(a);
      const r = p as Inputs["repay"];
      const l = await effective(t, a, r.loanId);
      ensure(l.kind === "loan", "Select a loan");
      await account(t, a, r.accountId);
      positive(r.amount);
      const data = l.data as Row,
        target = String(data.target),
        borrowed = data.direction === "borrowed";
      const outstanding = D(await balance(t, a.org, target, date)).times(
        borrowed ? -1 : 1,
      );
      ensure(
        outstanding.gte(r.amount),
        "Principal repayment exceeds outstanding",
      );
      return post(
        t,
        a,
        "repay",
        date,
        money(r.amount),
        r,
        borrowed
          ? [
            { account: target, debit: r.amount },
            { account: cash(r.accountId), credit: r.amount },
          ]
          : [
            { account: cash(r.accountId), debit: r.amount },
            { account: target, credit: r.amount },
          ],
      );
    }
    case "salary": {
      const s = p as Inputs["salary"];
      positive(s.amount);
      await account(t, a, s.accountId);
      ensure(D(s.amount).gte(s.setoff), "Setoff exceeds salary");
      const legs: Leg[] = [{ account: "expense:salary", debit: s.amount }];
      if (D(s.setoff).gt(0)) {
        ensure(s.staffLoanId, "Select the staff advance");
        const loan = await effective(t, a, s.staffLoanId);
        const data = loan.data as Row;
        ensure(
          loan.kind === "loan" && data.direction === "staff",
          "Select a staff advance",
        );
        ensure(
          data.counterparty === s.payee,
          "Salary payee must match the staff advance",
        );
        ensure(
          D(await balance(t, a.org, String(data.target), date)).gte(s.setoff),
          "Setoff exceeds advance",
        );
        legs.push({ account: String(data.target), credit: s.setoff });
      }
      if (D(s.amount).gt(s.setoff))
        legs.push({
          account: cash(s.accountId),
          credit: money(D(s.amount).minus(s.setoff)),
        });
      return post(t, a, "salary", date, money(s.amount), s, legs);
    }
    case "owner": {
      owner(a);
      const o = p as Inputs["owner"];
      positive(o.amount);
      await account(t, a, o.accountId);
      const incoming =
        o.classification === "contribution" ||
        o.classification === "owner_advance";
      const target =
        o.classification === "owner_advance" ||
          o.classification === "owner_advance_repayment"
          ? "owner:payable"
          : "owner:capital";
      if (o.classification === "owner_advance_repayment")
        ensure(
          D(await balance(t, a.org, target, date))
            .neg()
            .gte(o.amount),
          "Owner advance repayment exceeds outstanding",
        );
      return post(
        t,
        a,
        "owner",
        date,
        money(o.amount),
        o,
        incoming
          ? [
            { account: cash(o.accountId), debit: o.amount },
            { account: target, credit: o.amount },
          ]
          : [
            { account: target, debit: o.amount },
            { account: cash(o.accountId), credit: o.amount },
          ],
      );
    }
    case "unidentified": {
      const u = p as Inputs["unidentified"];
      await account(t, a, u.accountId, "bank");
      positive(u.amount);
      const holdingId = crypto.randomUUID();
      const saved = await post(
        t,
        a,
        "unidentified",
        date,
        money(u.amount),
        { ...u, holdingId },
        [
          { account: cash(u.accountId), debit: u.amount },
          { account: "holding:" + holdingId, credit: u.amount },
        ],
      );
      await bankIdentity(t, a, u.accountId, u.bankIdentity, saved.id);
      return saved;
    }
    case "identify": {
      const i = p as Inputs["identify"];
      const u = await effective(t, a, i.receiptId);
      ensure(u.kind === "unidentified", "Select an unidentified receipt");
      const target = "holding:" + String((u.data as Row).holdingId);
      const total = i.assignments.reduce(
        (s, x) => s.plus(positive(x.amount)),
        D(0),
      );
      ensure(
        D(await balance(t, a.org, target, date))
          .neg()
          .gte(total),
        "Assignments exceed unidentified remaining credit",
      );
      const legs: Leg[] = [{ account: target, debit: money(total) }];
      for (const x of i.assignments) {
        await scoped(t, a, "salesmen", x.salesmanId);
        legs.push({ account: trade(x.salesmanId), credit: x.amount });
      }
      const saved = await post(t, a, "identify", date, money(total), i, legs);
      for (const x of i.assignments) await allocate(t, a, x.salesmanId);
      return saved;
    }
    case "reverse": {
      owner(a);
      const r = p as Inputs["reverse"];
      const original = await effective(t, a, r.documentId);
      ensure(
        String(original.business_date) <= date,
        "Reversal cannot precede the original posting",
      );
      if (original.kind === "return" && original.salesman_id) {
        const refunds = await rows(
          t,
          sql`select id from documents d where d.org=${a.org} and d.kind='refund' and d.salesman_id=${String(original.salesman_id)} and not exists(select 1 from documents r where r.reverses=d.id and r.org=d.org) limit 1`,
        );
        if (refunds.length)
          ensure(
            D(
              await balance(
                t,
                a.org,
                trade(String(original.salesman_id)),
                date,
              ),
            )
              .plus(String(original.amount))
              .lte(0),
            "Reverse the dependent credit refund before this return correction",
          );
      }
      const dependents = await rows(
        t,
        sql`select id from documents d where d.org=${a.org} and (d.data->>'billId'=${r.documentId} and d.kind='return' or d.data->>'depositId'=${r.documentId} or d.data->>'loanId'=${r.documentId} or d.data->>'receiptId'=${r.documentId} or d.data->>'staffLoanId'=${r.documentId}) and not exists(select 1 from documents x where x.reverses=d.id and x.org=d.org)`,
      );
      ensure(
        !dependents.length,
        "Reverse dependent returns, loan/deposit movements or assignments first",
      );
      const entries = await rows<{
        account: string;
        debit: string;
        credit: string;
      }>(
        t,
        sql`select account,debit,credit from journal where org=${a.org} and document_id=${r.documentId}`,
      );
      const saved = await post(
        t,
        a,
        "reversal",
        date,
        String(original.amount),
        r,
        entries.map((l) => ({
          account: l.account,
          debit: l.credit,
          credit: l.debit,
        })),
        original.salesman_id ? String(original.salesman_id) : undefined,
        r.documentId,
      );
      if (original.kind === "receipt" || original.kind === "foods_receipt") {
        await t.execute(
          sql`update receipt_claims set state='reversed', reason=coalesce(reason || ' · ', '') || 'Reversed: ' || ${r.reason} where org=${a.org} and document_id=${r.documentId}`,
        );
        if (original.kind === "receipt") {
          await t.execute(
            sql`update cash_handovers set status='reversed', manager_note=coalesce(manager_note || ' · ', '') || 'Reversed: ' || ${r.reason} where org=${a.org} and document_id=${r.documentId}`,
          );
        }
      }
      const trades = entries
        .filter((l) => l.account.startsWith("trade:"))
        .map((l) => l.account.slice(6));
      for (const id of new Set(trades)) await allocate(t, a, id);
      return saved;
    }
    case "resolveCloseException": {
      owner(a);
      const r = p as Inputs["resolveCloseException"];
      const [close] = await rows<{ account_id: string; difference: string }>(
        t,
        sql`select account_id,difference from closes where org=${a.org} and id=${r.closeId} and state='closed'`,
      );
      ensure(
        close && !D(close.difference).isZero(),
        "Select an effective cash difference",
      );
      const prior = await rows(
        t,
        sql`select u.id from audit u where u.org=${a.org} and u.action='close_exception_resolved' and u.target=${r.closeId} and (u.data->>'resolution'='recount_confirmed' or not exists(select 1 from documents d where d.org=u.org and d.reverses=(u.data->>'documentId')::uuid))`,
      );
      ensure(!prior.length, "This exception already has an owner resolution");
      if (r.resolution === "linked_correction") {
        ensure(r.documentId, "Select the real correcting document");
        await effective(t, a, r.documentId);
        const [effect] = await rows<{ amount: string }>(
          t,
          sql`select coalesce(sum(debit-credit),0)::text amount from journal where org=${a.org} and document_id=${r.documentId} and account=${cash(close.account_id)}`,
        );
        ensure(
          D(effect.amount).eq(close.difference),
          "Correction must match the cash difference in this custody account",
        );
      }
      await auditEvent(t, a, "close_exception_resolved", r.closeId, r);
      return { id: r.closeId, state: "owner_resolution_recorded" };
    }
    case "close": {
      const c = p as Inputs["close"];
      const cashAccounts = await rows<{ id: string }>(
        t,
        sql`select id from money_accounts where org=${a.org} and type='cash' and active=true and (name not ilike '%mudhasir%' and name not ilike '%mubashir%')`,
      );
      // Validate that all active cash accounts are counted
      ensure(
        cashAccounts.every((x) => c.counts.some((y) => y.accountId === x.id)),
        "Count each active physical cash account exactly once",
      );
      ensure(
        new Set(c.counts.map((x) => x.accountId)).size === c.counts.length,
        "Duplicate account in close counts",
      );

      const id = crypto.randomUUID();
      for (const x of c.counts) {
        // Validate account belongs to this org (cash or bank)
        const [acc] = await rows<{ id: string; type: string }>(
          t,
          sql`select id, type from money_accounts where org=${a.org} and id=${x.accountId} and active=true`,
        );
        ensure(acc, `Account ${x.accountId} not found or inactive`);

        const expected = await balance(t, a.org, cash(x.accountId), date),
          difference = money(D(x.counted).minus(expected));
        ensure(
          D(difference).isZero() || x.reason.length >= 3,
          `${acc.type === 'cash' ? 'Cash' : 'Bank'} difference requires an explanation (min 3 chars)`,
        );
        await t.execute(
          sql`insert into closes(org,date,account_id,expected,counted,difference,reason,state,actor) values(${a.org},${date},${x.accountId},${expected},${x.counted},${difference},${x.reason},'closed',${a.id})`,
        );
      }
      await t.execute(
        sql`insert into periods(org,date,closed) values(${a.org},${date},true) on conflict(org,date) do update set closed=true`,
      );
      await auditEvent(t, a, "close", id, c);
      return { id, state: "closed" };
    }
    case "reopen": {
      owner(a);
      const r = p as Inputs["reopen"];
      ensure(date <= businessDate(), "Cannot reopen a future date");
      await t.execute(
        sql`update periods set closed=false where org=${a.org} and date>=${date}`,
      );
      await t.execute(
        sql`update closes set state='stale' where org=${a.org} and date>=${date} and state='closed'`,
      );
      await t.execute(
        sql`update reconciliations set state='stale' where org=${a.org} and date>=${date}`,
      );
      await auditEvent(t, a, "reopen", date, r);
      return { id: date, state: "reopened" };
    }
    case "reconcile": {
      const r = p as Inputs["reconcile"];
      await account(t, a, r.accountId, "bank");
      for (const id of r.matches) {
        const matches = await rows(
          t,
          sql`select j.id from journal j join documents d on d.id=j.document_id where j.org=${a.org} and j.document_id=${id} and j.account=${cash(r.accountId)} and d.business_date<=${date}`,
        );
        ensure(
          matches.length,
          "Matched record does not belong to this bank/date",
        );
      }
      const book = await balance(t, a.org, cash(r.accountId), date);
      const [saved] = await rows(
        t,
        sql`insert into reconciliations(org,account_id,date,statement,book,matches,actor) values(${a.org},${r.accountId},${date},${r.statement},${book},${JSON.stringify(r.matches)}::jsonb,${a.id}) returning id`,
      );
      await auditEvent(t, a, "reconcile", String(saved.id), r);
      return { ...saved, book, difference: money(D(r.statement).minus(book)) };
    }
    case "reallocate": {
      const r = p as Inputs["reallocate"];
      await scoped(t, a, "salesmen", r.salesmanId);
      await allocate(t, a, r.salesmanId, r.preferredChargeIds);
      return { id: r.salesmanId };
    }
    case "foodsReceipt": {
      const r = p as Inputs["foodsReceipt"];
      const cashAmt = D(r.cashAmount || "0");

      // Handle split online amounts if provided, or single bankAmount
      const splitBankAmounts = (r.bankAmounts && r.bankAmounts.length > 0)
        ? r.bankAmounts.map((x) => D(x))
        : (r.bankAmount && D(r.bankAmount).gt(0) ? [D(r.bankAmount)] : []);
      const bankAmt = splitBankAmounts.reduce((acc, curr) => acc.plus(curr), D(0));

      const total = cashAmt.plus(bankAmt);
      ensure(total.gt(0), "At least one amount (cash or bank) must be greater than zero");

      let cashAccId = r.cashAccountId;
      if (cashAmt.gt(0)) {
        if (!cashAccId) {
          const [cashAcc] = await rows(
            t,
            sql`select id from money_accounts where org=${a.org} and type='cash' and active order by name limit 1`,
          );
          ensure(cashAcc, "No active cash account configured");
          cashAccId = String(cashAcc.id);
        } else {
          await account(t, a, cashAccId, "cash");
        }
      }

      let bankAccId = r.bankAccountId;
      if (bankAmt.gt(0)) {
        if (!bankAccId) {
          const [bankAcc] = await rows(
            t,
            sql`select id from money_accounts where org=${a.org} and type='bank' and active order by name limit 1`,
          );
          ensure(bankAcc, "No active bank account configured");
          bankAccId = String(bankAcc.id);
        } else {
          await account(t, a, bankAccId, "bank");
        }
      }

      const legs: Leg[] = [];
      if (cashAmt.gt(0) && cashAccId) {
        legs.push({ account: cash(cashAccId), debit: money(cashAmt) });
      }
      if (bankAmt.gt(0) && bankAccId) {
        legs.push({ account: cash(bankAccId), debit: money(bankAmt) });
      }
      legs.push({ account: "revenue:foods", credit: money(total) });

      const doc = await post(
        t,
        a,
        "foods_receipt",
        date,
        money(total),
        {
          foodsSalesman: r.foodsSalesman,
          foodsSalesmanId: r.foodsSalesmanId,
          billNo: r.billNo || "",
          foodItems: r.foodItems || "",
          method: r.method || (cashAmt.gt(0) && bankAmt.lte(0) ? "cash" : bankAmt.gt(0) && cashAmt.lte(0) ? "online" : undefined),
          cashAmount: money(cashAmt),
          bankAmount: money(bankAmt),
          unverifiedOnlineAmount: "0.00",
          note: r.note || "",
        },
        legs,
      );

      return doc;
    }
    case "employeeReceipt": {
      const r = p as Inputs["employeeReceipt"];
      positive(r.amount);
      await account(t, a, r.accountId);
      return post(
        t,
        a,
        "employee_receipt",
        date,
        money(r.amount),
        r,
        [
          { account: cash(r.accountId), debit: r.amount },
          { account: "liability:staff", credit: r.amount },
        ],
      );
    }
    case "initiateCashHandover": {
      const h = p as Inputs["initiateCashHandover"];
      positive(h.amount);
      const salesman = await scoped(t, a, "salesmen", h.salesmanId);
      ensure(salesman.active, "Salesman is inactive");
      const id = crypto.randomUUID();
      await t.execute(
        sql`insert into cash_handovers(id, org, salesman_id, amount, date, status, salesman_note, actor) values(${id}, ${a.org}, ${h.salesmanId}, ${h.amount}, ${date}, 'pending', ${h.salesmanNote ?? null}, ${a.id})`,
      );
      await auditEvent(t, a, "cash_handover_initiated", id, {
        salesmanId: h.salesmanId,
        amount: h.amount,
        note: h.salesmanNote,
      });
      return { id, amount: money(h.amount), status: "pending" };
    }
    case "confirmCashHandover": {
      const c = p as Inputs["confirmCashHandover"];
      positive(c.acceptedAmount);
      ensure(
        a.role === "owner" || a.capabilities.verifyOnline !== false,
        "Manager or Owner permission required to confirm handovers",
        "FORBIDDEN",
        403,
      );

      const isOnline = c.method === "online";
      const acc = await account(t, a, c.accountId, isOnline ? "bank" : "cash");

      // Support direct salesmanId acceptance as well as handoverId acceptance
      let salesmanId = c.salesmanId;
      let handoverRecordId = c.handoverId;
      let originalHandoverAmount = c.acceptedAmount;

      if (c.handoverId && !c.handoverId.startsWith("online-")) {
        const [existingHandover] = await rows(
          t,
          sql`select * from cash_handovers where org=${a.org} and id=${c.handoverId} limit 1`,
        );
        if (existingHandover) {
          if (existingHandover.status === "confirmed") {
            return { id: String(existingHandover.document_id), status: "confirmed" };
          }
          salesmanId = String(existingHandover.salesman_id);
          originalHandoverAmount = String(existingHandover.amount);
          ensure(
            existingHandover.status === "pending",
            "Only pending handovers can be confirmed",
          );
          ensure(
            D(c.acceptedAmount).lte(D(String(existingHandover.amount))),
            "Accepted amount cannot exceed the handed over amount",
          );
        } else {
          // If c.handoverId matches a salesman ID, treat it as salesmanId directly
          const [salesmanCheck] = await rows(
            t,
            sql`select id from salesmen where org=${a.org} and id=${c.handoverId} limit 1`,
          );
          if (salesmanCheck) {
            salesmanId = String(salesmanCheck.id);
            handoverRecordId = crypto.randomUUID();
          }
        }
      }

      if (!handoverRecordId || handoverRecordId.startsWith("online-")) {
        handoverRecordId = crypto.randomUUID();
      }

      ensure(salesmanId, "Salesman ID is required to accept handover");
      const salesman = await scoped(t, a, "salesmen", salesmanId);

      let creditAccount: string;
      let debitAccount = cash(c.accountId);
      let sourceAccName = "";

      let resolvedSourceId = c.sourceAccountId;
      if (isOnline) {
        if (!resolvedSourceId) {
          const [mudhasirBank] = await rows<{ id: string; name: string }>(
            t,
            sql`select id, name from money_accounts where org=${a.org} and active=true and type='bank' and (name ilike '%mudhasir%' or name ilike '%mubashir%' or holder ilike '%mudhasir%' or holder ilike '%mubashir%') limit 1`,
          );
          if (mudhasirBank) resolvedSourceId = mudhasirBank.id;
        }
        ensure(resolvedSourceId, "Source bank account is required for online handover");
        const srcAcc = await account(t, a, resolvedSourceId, "bank");
        sourceAccName = srcAcc.name;
        creditAccount = cash(resolvedSourceId);
      } else {
        const isDirect = isDirectRouteSalesman(salesman as { name?: string | null; details?: unknown });
        if (isDirect) {
          if (!resolvedSourceId) {
            const [mudhasirCash] = await rows<{ id: string; name: string }>(
              t,
              sql`select id, name from money_accounts where org=${a.org} and active=true and type='cash' and (name ilike '%mudhasir%' or name ilike '%mubashir%' or holder ilike '%mudhasir%' or holder ilike '%mubashir%') limit 1`,
            );
            if (mudhasirCash) {
              const [cashBal] = await rows<{ bal: string }>(
                t,
                sql`select coalesce(sum(debit - credit), 0)::text as bal from journal where org=${a.org} and account=${'money:' + mudhasirCash.id}`,
              );
              if (D(cashBal?.bal ?? "0").gt(0)) {
                resolvedSourceId = mudhasirCash.id;
              }
            }
          }
          if (resolvedSourceId) {
            const [cashBal] = await rows<{ bal: string }>(
              t,
              sql`select coalesce(sum(debit - credit), 0)::text as bal from journal where org=${a.org} and account=${'money:' + resolvedSourceId}`,
            );
            if (D(cashBal?.bal ?? "0").gte(D(c.acceptedAmount))) {
              const srcAcc = await account(t, a, resolvedSourceId, "cash");
              sourceAccName = srcAcc.name;
              creditAccount = cash(resolvedSourceId);
            } else {
              creditAccount = `transit:salesman:${salesmanId}`;
              resolvedSourceId = undefined;
            }
          } else {
            creditAccount = `transit:salesman:${salesmanId}`;
          }
        } else {
          creditAccount = trade(salesmanId);
        }
      }

      const isTransfer = isOnline || Boolean(sourceAccName);
      const r = await post(
        t,
        a,
        isTransfer ? "transfer" : "receipt",
        date,
        money(c.acceptedAmount),
        {
          handoverId: handoverRecordId,
          isHandoverConfirmation: true,
          salesmanId,
          accountId: c.accountId,
          sourceAccountId: resolvedSourceId || undefined,
          sourceId: resolvedSourceId || undefined,
          destinationId: isTransfer ? c.accountId : undefined,
          method: isOnline ? "online" : "cash",
          actualDate: date,
          reference: isOnline
            ? `Route online collection transfer confirmed (₹${money(c.acceptedAmount)})`
            : `Cash handover confirmed (₹${money(c.acceptedAmount)})`,
          accountName: acc.name,
          sourceAccountName: sourceAccName || undefined,
          salesmanName: salesman.name,
          managerNote: c.managerNote,
          originalHandoverAmount,
          isPartial: D(c.acceptedAmount).lt(D(originalHandoverAmount)),
        },
        [
          { account: debitAccount, debit: c.acceptedAmount },
          { account: creditAccount, credit: c.acceptedAmount },
        ],
        salesmanId,
      );

      if (!isOnline) {
        const [existingRecord] = await rows(
          t,
          sql`select id from cash_handovers where id=${handoverRecordId} and org=${a.org} limit 1`,
        );

        if (existingRecord) {
          await t.execute(
            sql`update cash_handovers set status='confirmed', accepted_amount=${c.acceptedAmount}, document_id=${r.id}, manager_note=${c.managerNote ?? null}, verified_by=${a.id}, verified_at=now() where id=${handoverRecordId} and org=${a.org}`,
          );
        } else {
          await t.execute(
            sql`insert into cash_handovers(id, org, salesman_id, amount, accepted_amount, date, status, manager_note, document_id, actor, verified_by, verified_at)
                values(${handoverRecordId}, ${a.org}, ${salesmanId}, ${c.acceptedAmount}, ${c.acceptedAmount}, ${date}, 'confirmed', ${c.managerNote ?? null}, ${r.id}, ${a.id}, ${a.id}, now())`,
          );
        }
      }

      await allocate(t, a, salesmanId);
      await auditEvent(t, a, "cash_handover_confirmed", handoverRecordId ?? r.id, {
        ...c,
        salesmanId,
        documentId: r.id,
        verifiedAt: new Date().toISOString(),
      });
      return { id: r.id, handoverId: handoverRecordId, status: "confirmed", acceptedAmount: money(c.acceptedAmount) };
    }
    case "rejectCashHandover": {
      const v = p as Inputs["rejectCashHandover"];
      ensure(
        a.role === "owner" || a.capabilities.verifyOnline !== false,
        "Manager or Owner permission required to reject cash handovers",
        "FORBIDDEN",
        403,
      );
      const handover = await scoped(t, a, "cash_handovers", v.handoverId);
      ensure(handover.status === "pending", "Only pending handovers can be rejected");
      await t.execute(
        sql`update cash_handovers set status='rejected', manager_note=${v.reason}, verified_by=${a.id}, verified_at=now() where id=${v.handoverId} and org=${a.org}`,
      );
      await auditEvent(t, a, "cash_handover_rejected", v.handoverId, v);
      return { id: v.handoverId, status: "rejected" };
    }
    case "receiveSalesmanCash": {
      const r = p as Inputs["receiveSalesmanCash"];
      return execute(
        t,
        a,
        "confirmCashHandover",
        {
          salesmanId: r.salesmanId,
          acceptedAmount: r.amount,
          accountId: r.accountId,
          managerNote: r.managerNote,
          date: r.date,
          note: r.note,
        },
        date,
      );
    }
    default:
      throw new DomainError("UNSUPPORTED", "Unsupported command");
  }
}
