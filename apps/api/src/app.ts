import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { bodyLimit } from "hono/body-limit";
import { sql } from "drizzle-orm";
import { ZodError, z } from "zod";
import { db } from "@ledger/db";
import {
  commands,
  salesmanSchema,
  productSchema,
  accountSchema,
  id,
  date as dateSchema,
} from "@ledger/contracts";
import { auth } from "./auth";
import {
  rows,
  command,
  DomainError,
  ensure,
  owner,
  ownerOrManager,
  auditEvent,
  lock,
  balance,
  type Actor,
} from "./engine";
import {
  businessDate,
  money,
  D,
  csvCell,
  MoneyError,
  quoteFingerprint,
} from "./money";
import Decimal from "decimal.js";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
export const app = new Hono<{ Variables: { actor: Actor } }>();
app.use("*", secureHeaders());
app.use("*", bodyLimit({ maxSize: 11 * 1024 * 1024 }));
app.onError((e, c) => {
  if (e instanceof MoneyError)
    return c.json({ code: "FINANCIAL_VALIDATION", message: e.message }, 422);
  if (e instanceof ZodError)
    return c.json(
      {
        code: "VALIDATION",
        message: "Please check the entered fields",
        fields: e.issues,
      },
      400,
    );
  if (e instanceof DomainError)
    return c.json({ code: e.code, message: e.message }, e.status as 403);
  const code =
    (e as { code?: string }).code ??
    (e.cause as { code?: string } | undefined)?.code;
  if (code === "23505")
    return c.json(
      {
        code: "DUPLICATE",
        message: "This record, bank identity or posting already exists",
      },
      409,
    );
  if (code === "23503" || code === "23514")
    return c.json(
      {
        code: "INVALID_REFERENCE",
        message: "Invalid record relationship or financial constraint",
      },
      422,
    );
  console.error("API error", e.name, code ?? "internal", (e as Error).message, (e as Error).stack);
  return c.json(
    {
      code: "INTERNAL",
      message:
        (e as Error).message || "Unable to save. Your draft is unchanged; retry with the same action key.",
    },
    500,
  );
});
app.get("/api/v1/health", async (c) => {
  await db.execute(sql`select 1`);
  return c.json({ status: "ok" });
});
// Public registration/reset endpoints are deliberately not exposed. Owner provisioning uses server commands.
app.on(["GET", "POST"], "/api/v1/auth/*", async (c) => {
  const allowed = ["sign-in/email", "sign-out", "get-session"];
  const suffix = c.req.path.replace("/api/v1/auth/", "");
  if (!allowed.includes(suffix)) return c.json({ code: "NOT_FOUND" }, 404);
  return auth.handler(c.req.raw);
});
app.use("/api/v1/*", async (c, next) => {
  if (!["GET", "HEAD"].includes(c.req.method))
    ensure(
      c.req.header("origin") ===
      (process.env.APP_ORIGIN ?? "http://localhost:5173"),
      "Request origin is not allowed",
      "ORIGIN",
      403,
    );
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  ensure(session, "Please sign in", "UNAUTHORIZED", 401);
  const [m] = await rows<{
    org: string;
    role: "owner" | "manager" | "salesman";
    active: boolean;
    capabilities: Record<string, boolean>;
  }>(
    db,
    sql`select org,role,active,capabilities from members where user_id=${session.user.id}`,
  );
  ensure(m?.active, "Access revoked", "FORBIDDEN", 403);
  const salesmanId =
    m?.role === "salesman"
      ? (m.capabilities as unknown as Record<string, unknown>)?.salesmanId as string | undefined
      : undefined;
  // Salesman-role users may only access their own read-only data
  if (m?.role === "salesman") {
    const path = c.req.path;
    const allowed =
      path === "/api/v1/me" ||
      path === "/api/v1/masters" ||
      path.startsWith("/api/v1/statements/");
    ensure(allowed, "Access restricted", "FORBIDDEN", 403);
    // Only allow GET for salesman role
    ensure(
      ["GET", "HEAD"].includes(c.req.method),
      "Read-only access",
      "FORBIDDEN",
      403,
    );
    // Restrict salesman statement to own account only
    if (path.startsWith("/api/v1/statements/")) {
      const urlSalesmanId = path.split("/")[4];
      ensure(
        urlSalesmanId === salesmanId,
        "Access restricted to own account",
        "FORBIDDEN",
        403,
      );
    }
  }
  c.set("actor", { id: session.user.id, ...m, salesmanId });
  await next();
});
app.get("/api/v1/me", async (c) => {
  const a = c.get("actor");
  const [org] = await rows(
    db,
    sql`select id,name,mode,setup from organizations where id=${a.org}`,
  );
  return c.json({ ...a, business: org, date: businessDate() });
});
app.get("/api/v1/masters", async (c) => {
  const a = c.get("actor");
  const [salesmen, products, accounts] = await Promise.all([
    rows(db, sql`select * from salesmen where org=${a.org} order by code`),
    rows(
      db,
      sql`select p.*,c.id configuration_id,c.unit,c.base_unit,c.conversion,c.basis,c.rate,c.fractional,c.confirmed,c.effective_date from products p left join lateral(select * from product_configurations x where x.org=p.org and x.product_id=p.id and x.effective_date<=${businessDate()} order by effective_date desc,created_at desc limit 1)c on true where p.org=${a.org} and p.code not in ('DEMO-A', 'DEMO-B', 'DEMO-C') order by p.code`,
    ),
    rows(
      db,
      sql`select * from money_accounts where org=${a.org} order by type,name`,
    ),
  ]);
  return c.json({ salesmen, products, accounts });
});
app.post("/api/v1/salesmen", async (c) => {
  const a = c.get("actor"),
    p = salesmanSchema.parse(await c.req.json());
  if (a.role !== "owner")
    ensure(
      p.creditLimit === null,
      "Only owner sets credit limits",
      "FORBIDDEN",
      403,
    );
  const result = await db.transaction(async (t) => {
    await lock(t, a.org);
    const [r] = await rows(
      t,
      sql`insert into salesmen(org,code,name,active,credit_limit,details) values(${a.org},${p.code},${p.name},${p.active},${p.creditLimit},${JSON.stringify(p.details)}::jsonb) returning *`,
    );
    await auditEvent(t, a, "salesman_created", String(r.id), p);
    return r;
  });
  return c.json(result, 201);
});
app.post("/api/v1/products", async (c) => {
  const a = c.get("actor");
  ownerOrManager(a);
  const p = productSchema.parse(await c.req.json());
  ensure(
    D(p.conversion).gt(0) && D(p.basis).gt(0),
    "Conversion and basis must be positive",
  );
  const r = await db.transaction(async (t) => {
    await lock(t, a.org);
    let productId = p.id;
    if (productId) {
      const [existingById] = await rows<{ id: string; code: string }>(
        t,
        sql`select id, code from products where org=${a.org} and id=${productId}`,
      );
      ensure(existingById, "Product not found", "NOT_FOUND", 404);
      if (p.code !== existingById.code) {
        const [conflict] = await rows<{ id: string }>(
          t,
          sql`select id from products where org=${a.org} and code=${p.code} and id != ${productId}`,
        );
        ensure(!conflict, `Product code "${p.code}" is already in use`, "CONFLICT", 409);
      }
      await t.execute(
        sql`update products set code=${p.code}, name=${p.name}, barcode=${p.barcode !== undefined ? p.barcode : sql`barcode`}, itc_multiple=${p.itcMultiple !== undefined ? p.itcMultiple : sql`itc_multiple`}, is_focus_brand=${p.isFocusBrand !== undefined ? p.isFocusBrand : sql`is_focus_brand`}, category=${p.category !== undefined ? p.category : sql`category`} where org=${a.org} and id=${productId}`,
      );
    } else {
      const [existing] = await rows<{ id: string }>(
        t,
        sql`select id from products where org=${a.org} and code=${p.code}`,
      );
      productId = existing?.id ?? crypto.randomUUID();
      if (!existing)
        await t.execute(
          sql`insert into products(id,org,code,name,barcode,itc_multiple,is_focus_brand,category) values(${productId},${a.org},${p.code},${p.name},${p.barcode ?? null},${p.itcMultiple ?? null},${p.isFocusBrand ?? false},${p.category ?? 'CG-01 CIGARETTE'})`,
        );
      else
        await t.execute(
          sql`update products set name=${p.name}, barcode=${p.barcode !== undefined ? p.barcode : sql`barcode`}, itc_multiple=${p.itcMultiple !== undefined ? p.itcMultiple : sql`itc_multiple`}, is_focus_brand=${p.isFocusBrand !== undefined ? p.isFocusBrand : sql`is_focus_brand`}, category=${p.category !== undefined ? p.category : sql`category`} where org=${a.org} and id=${productId}`,
        );
    }
    await t.execute(
      sql`insert into product_configurations(org,product_id,effective_date,unit,base_unit,conversion,basis,rate,fractional,confirmed) values(${a.org},${productId},${p.effectiveDate},${p.unit},${p.baseUnit},${p.conversion},${p.basis},${p.rate},${p.fractional},${p.confirmed})`,
    );
    await auditEvent(t, a, "product_configuration", productId, p);
    return { id: productId };
  });
  return c.json(r, 201);
});
app.post("/api/v1/accounts", async (c) => {
  const a = c.get("actor");
  ownerOrManager(a);
  const p = accountSchema.parse(await c.req.json());
  ensure(
    p.type !== "cash" || !p.allowOverdraft,
    "Physical cash cannot allow overdraft",
  );
  const r = await db.transaction(async (t) => {
    await lock(t, a.org);
    const [r] = await rows(
      t,
      sql`insert into money_accounts(org,name,type,holder,allow_overdraft) values(${a.org},${p.name},${p.type},${p.holder},${p.allowOverdraft}) returning *`,
    );
    await auditEvent(t, a, "account_created", String(r.id), p);
    return r;
  });
  return c.json(r, 201);
});
app.patch("/api/v1/masters/:type/:id", async (c) => {
  const a = c.get("actor");
  ownerOrManager(a);
  const type = z
    .enum(["salesmen", "products", "money_accounts"])
    .parse(c.req.param("type")),
    recordId = id.parse(c.req.param("id"));
  const p = z
    .object({ active: z.boolean() })
    .strict()
    .parse(await c.req.json());
  const result = await db.transaction(async (t) => {
    await lock(t, a.org);
    if (type === "money_accounts" && !p.active)
      ensure(
        D(await balance(t, a.org, "money:" + recordId)).isZero(),
        "Transfer or correct the remaining book money before deactivating this account",
      );
    const [r] = await rows(
      t,
      sql`update ${sql.identifier(type)} set active=${p.active} where org=${a.org} and id=${recordId} returning id`,
    );
    ensure(r, "Record not found", "NOT_FOUND", 404);
    await auditEvent(t, a, "deactivate", recordId, p);
    return r;
  });
  return c.json(result);
});
app.patch("/api/v1/products/:id/focus", async (c) => {
  const a = c.get("actor");
  ownerOrManager(a);
  const productId = id.parse(c.req.param("id"));
  const p = z.object({ isFocusBrand: z.boolean() }).parse(await c.req.json());
  const [updated] = await rows(
    db,
    sql`update products set is_focus_brand=${p.isFocusBrand} where org=${a.org} and id=${productId} returning id, code, name, is_focus_brand`,
  );
  ensure(updated, "Product not found", "NOT_FOUND", 404);
  await db.transaction((t) => auditEvent(t, a, "product_focus_toggle", productId, p));
  return c.json(updated);
});
app.patch("/api/v1/products/:id/barcode", async (c) => {
  const a = c.get("actor");
  ownerOrManager(a);
  const productId = id.parse(c.req.param("id"));
  const p = z.object({ barcode: z.string().max(500).nullable() }).parse(await c.req.json());
  const [updated] = await rows(
    db,
    sql`update products set barcode=${p.barcode} where org=${a.org} and id=${productId} returning id, code, name, barcode`,
  );
  ensure(updated, "Product not found", "NOT_FOUND", 404);
  await db.transaction((t) => auditEvent(t, a, "product_barcode_update", productId, p));
  return c.json(updated);
});
app.patch("/api/v1/members/:id", async (c) => {
  const a = c.get("actor");
  owner(a);
  const p = z
    .object({
      active: z.boolean(),
      verifyOnline: z.boolean(),
      editBillPrices: z.boolean().optional(),
      applyBillDiscounts: z.boolean().optional(),
    })
    .strict()
    .parse(await c.req.json());
  const userId = c.req.param("id");
  ensure(userId !== a.id, "Cannot revoke your own owner access");
  await db.transaction(async (t) => {
    await lock(t, a.org);
    const [r] = await rows(
      t,
      sql`update members set active=${p.active},capabilities=capabilities || ${JSON.stringify({ verifyOnline: p.verifyOnline, ...(p.editBillPrices !== undefined ? { editBillPrices: p.editBillPrices } : {}), ...(p.applyBillDiscounts !== undefined ? { applyBillDiscounts: p.applyBillDiscounts } : {}) })}::jsonb where org=${a.org} and user_id=${userId} returning id`,
    );
    ensure(r, "Member not found", "NOT_FOUND", 404);
    if (!p.active)
      await t.execute(sql`delete from session where "userId"=${userId}`);
    await auditEvent(t, a, "permission_change", userId, p);
  });
  return c.json({ id: userId });
});
// Expose explicit reviewed commands only, never arbitrary journal lines.
for (const name of Object.keys(commands) as (keyof typeof commands)[])
  app.post("/api/v1/commands/" + name, async (c) => {
    const input = commands[name].parse(await c.req.json());
    if (name === "bill")
      ensure(
        "expectedQuoteHash" in input && input.expectedQuoteHash,
        "Review the server bill quote before posting",
        "STALE_REVIEW",
        409,
      );
    return c.json(
      await command(
        c.get("actor"),
        name,
        input,
        c.req.header("idempotency-key") ?? "",
        c.req.header("x-draft-id")
          ? {
            draftId: id.parse(c.req.header("x-draft-id")),
            draftVersion: z.coerce
              .number()
              .int()
              .positive()
              .parse(c.req.header("x-draft-version")),
          }
          : {},
      ),
      201,
    );
  });
app.get("/api/v1/dashboard", async (c) =>
  db.transaction(async (t) => {
    await t.execute(
      sql`set transaction isolation level repeatable read read only`,
    );
    const a = c.get("actor"),
      date = dateSchema.parse(c.req.query("asOf") ?? businessDate());
    const [people, accounts, activity, claims, transit, loans, closes, pendingHandovers] =
      await Promise.all([
        rows(
          t,
          sql`with totals as materialized(select j.account,sum(j.debit-j.credit)::numeric(18,2) balance from journal j join documents d on d.id=j.document_id where j.org=${a.org} and j.account like 'trade:%' and d.business_date<=${date}::date group by j.account) select s.id,s.code,s.name,s.active,coalesce(t.balance,0)::numeric(18,2)::text balance from salesmen s left join totals t on t.account='trade:'||s.id::text where s.org=${a.org} order by s.code`,
        ),
        rows(
          t,
          sql`with totals as materialized(select j.account,sum(j.debit-j.credit)::numeric(18,2) balance from journal j join documents d on d.id=j.document_id where j.org=${a.org} and j.account like 'money:%' and d.business_date<=${date}::date group by j.account) select m.*,coalesce(t.balance,0)::numeric(18,2)::text balance from money_accounts m left join totals t on t.account='money:'||m.id::text where m.org=${a.org} order by m.type,m.name`,
        ),
        rows(
          t,
          sql`with events as (select kind,coalesce(data->>'method','') method,amount,data from documents where org=${a.org} and business_date=${date} and reverses is null union all select o.kind,coalesce(o.data->>'method','') method,-d.amount,o.data from documents d join lateral(select kind,data from documents x where x.id=d.reverses limit 1)o on true where d.org=${a.org} and d.business_date=${date} and d.reverses is not null) select kind,method,sum(amount)::numeric(18,2)::text amount,count(*)::text count from events where coalesce(data->>'isHandoverConfirmation', 'false') != 'true' and not (data ? 'reference' and data->>'reference' like 'Cash handover confirmed%') group by kind,method order by kind`,
        ),
        rows(
          t,
          sql`select p.*,s.name salesman_name,m.name account_name from receipt_claims p join salesmen s on s.id=p.salesman_id join money_accounts m on m.id=p.account_id where p.org=${a.org} and p.state='pending' order by p.created_at limit 100`,
        ),
        rows(
          t,
          sql`select j.account,sum(j.debit-j.credit)::numeric(18,2)::text balance from journal j join documents d on d.id=j.document_id where j.org=${a.org} and j.account like 'transit:%' and d.business_date<=${date} group by j.account having sum(j.debit-j.credit)<>0`,
        ),
        rows(
          t,
          sql`select j.account,sum(j.debit-j.credit)::numeric(18,2)::text balance from journal j join documents d on d.id=j.document_id where j.org=${a.org} and (j.account like 'loan:%' or j.account like 'borrowed:%' or j.account like 'staff:%') and d.business_date<=${date} group by j.account`,
        ),
        rows(
          t,
          sql`select c.*,m.name account_name from closes c join money_accounts m on m.id=c.account_id where c.org=${a.org} and c.date=${date} order by c.created_at desc`,
        ),
        rows(
          t,
          sql`
            with mudashir_salesman as (
              select id from salesmen 
              where org = ${a.org} 
                and (
                  coalesce(details->>'is_direct_route', '') = 'true'
                  or coalesce(details->>'direct_route', '') = 'true'
                  or coalesce(details->>'isDirectRoute', '') = 'true'
                  or name ilike '%mubashir%' 
                  or name ilike '%mudashir%'
                ) 
              limit 1
            ),
            collections as (
              select 
                d.salesman_id,
                sum(case when d.reverses is null then d.amount else -d.amount end) as amt,
                max(d.created_at) as last_collected_at
              from documents d
              where d.org = ${a.org}
                and d.salesman_id in (select id from mudashir_salesman)
                and d.kind = 'receipt'
                and coalesce(d.data->>'method', 'cash') = 'cash'
                and d.data->>'handoverId' is null
                and coalesce(d.data->>'isHandoverConfirmation', 'false') != 'true'
                and not (d.data ? 'reference' and d.data->>'reference' like 'Cash handover confirmed%')
              group by d.salesman_id
            ),
            confirmed as (
              select 
                salesman_id,
                sum(coalesce(accepted_amount, amount)) as amt
              from cash_handovers
              where org = ${a.org} 
                and salesman_id in (select id from mudashir_salesman)
                and status = 'confirmed'
              group by salesman_id
            )
            select 
              s.id as id,
              s.id as salesman_id,
              s.name as salesman_name,
              s.code as salesman_code,
              (coalesce(c.amt, 0) - coalesce(h.amt, 0))::numeric(18,2)::text as amount,
              'pending' as status,
              'Route cash collected by Mudhasir awaiting manager confirmation into till' as salesman_note,
              c.last_collected_at::text as created_at,
              ${date}::text as date
            from salesmen s
            join mudashir_salesman m on m.id = s.id
            left join collections c on c.salesman_id = s.id
            left join confirmed h on h.salesman_id = s.id
            where s.org = ${a.org} and s.active = true
              and (coalesce(c.amt, 0) - coalesce(h.amt, 0)) > 0
            order by (coalesce(c.amt, 0) - coalesce(h.amt, 0)) desc limit 100
          `,
        ),
      ]);
    let due = D(0),
      credit = D(0);
    for (const p of people) {
      const b = D(String(p.balance));
      if (b.gt(0)) due = due.plus(b);
      else credit = credit.minus(b);
    }
    const [summary] = await rows(
      t,
      sql`with events as (select kind,coalesce(data->>'method','') method,amount,data from documents where org=${a.org} and business_date=${date} and reverses is null union all select o.kind,coalesce(o.data->>'method','') method,-d.amount,o.data from documents d join lateral(select kind,data from documents x where x.id=d.reverses limit 1)o on true where d.org=${a.org} and d.business_date=${date} and d.reverses is not null) select coalesce(sum(amount) filter(where kind in ('receipt','identify') and coalesce(data->>'isHandoverConfirmation', 'false') != 'true' and not (data ? 'reference' and data->>'reference' like 'Cash handover confirmed%')),0)::numeric(18,2)::text collections,coalesce(sum(amount) filter(where kind='receipt' and method='cash' and coalesce(data->>'isHandoverConfirmation', 'false') != 'true' and not (data ? 'reference' and data->>'reference' like 'Cash handover confirmed%')),0)::numeric(18,2)::text cash_collections,coalesce(sum(amount) filter(where (kind='receipt' and method='online') or kind='identify'),0)::numeric(18,2)::text online_collections,coalesce(sum(amount) filter(where kind in ('expense','salary')),0)::numeric(18,2)::text expenses,coalesce(sum(amount) filter(where kind='loan'),0)::numeric(18,2)::text loans,coalesce(sum(amount) filter(where kind in ('expense','salary','loan')),0)::numeric(18,2)::text expenses_and_loans,coalesce(sum(amount) filter(where kind='return'),0)::numeric(18,2)::text returns from events`,
    );
    const cashSummary = await rows(
      t,
      sql`select m.id,m.name,m.holder,coalesce(sum(j.debit-j.credit) filter(where d.business_date<${date}::date),0)::numeric(18,2)::text opening,coalesce(sum(j.debit) filter(where d.business_date=${date}::date),0)::numeric(18,2)::text inflows,coalesce(sum(j.credit) filter(where d.business_date=${date}::date),0)::numeric(18,2)::text outflows,coalesce(sum(j.debit-j.credit) filter(where d.business_date<=${date}::date),0)::numeric(18,2)::text expected from money_accounts m left join journal j on j.org=m.org and j.account='money:'||m.id::text left join documents d on d.id=j.document_id where m.org=${a.org} and m.type='cash' group by m.id order by m.name`,
    );
    const [period] = await rows<{ closed: boolean }>(
      t,
      sql`select closed from periods where org=${a.org} and date=${date}`,
    );
    const exceptions = await rows(
      t,
      sql`select c.id,c.date::text date,m.name account,c.expected,c.counted,c.difference,c.reason from closes c join money_accounts m on m.id=c.account_id and m.org=c.org where c.org=${a.org} and c.state='closed' and c.difference<>0 and c.date<=${date} and not exists(select 1 from audit u where u.org=c.org and u.action='close_exception_resolved' and u.target=c.id::text and ((u.data->>'resolution'='recount_confirmed') or (u.data->>'resolution'='linked_correction' and not exists(select 1 from documents r where r.org=c.org and r.reverses=(u.data->>'documentId')::uuid)))) order by c.date,c.created_at limit 100`,
    );
    const [otherBalances] = await rows(
      t,
      sql`select coalesce(sum(j.debit-j.credit) filter(where j.account like 'loan:%'),0)::numeric(18,2)::text loans_given,coalesce(sum(j.credit-j.debit) filter(where j.account like 'borrowed:%'),0)::numeric(18,2)::text borrowings,coalesce(sum(j.debit-j.credit) filter(where j.account like 'staff:%'),0)::numeric(18,2)::text staff_advances,coalesce(sum(j.debit-j.credit) filter(where j.account like 'transit:%'),0)::numeric(18,2)::text transit from journal j join documents d on d.id=j.document_id where j.org=${a.org} and d.business_date<=${date}`,
    );
    const [segments] = await rows(
      t,
      sql`with mubashir as (
        select id from salesmen 
        where org=${a.org} 
          and (
            coalesce(details->>'is_direct_route', '') = 'true'
            or coalesce(details->>'direct_route', '') = 'true'
            or coalesce(details->>'isDirectRoute', '') = 'true'
            or name ilike '%mubashir%' 
            or name ilike '%mudashir%'
          ) 
        limit 1
      ),
      non_mubashir as (
        select id from salesmen where org=${a.org} and active = true and id != (select id from mubashir)
      ),
      totals as (
        select
          j.account,
          sum(j.debit - j.credit)::numeric(18,2) as balance
        from journal j
        join documents d on d.id = j.document_id
        where j.org=${a.org} and j.account like 'trade:%' and d.business_date <= ${date}::date
        group by j.account
      ),
      dues_calc as (
        select
          coalesce(sum(case when s.id not in (select id from mubashir) and coalesce(t.balance,0) > 0 then t.balance else 0 end), 0)::numeric(18,2) as retail_dues,
          coalesce(sum(case when s.id in (select id from mubashir) and coalesce(t.balance,0) > 0 then t.balance else 0 end), 0)::numeric(18,2) as mubashir_dues,
          coalesce(sum(case when coalesce(t.balance,0) > 0 then t.balance else 0 end), 0)::numeric(18,2) as total_dues
        from salesmen s
        left join totals t on t.account = 'trade:' || s.id::text
        where s.org = ${a.org} and s.active = true
      )
      select
        coalesce(sum(case when d.kind = 'bill' then (case when d.reverses is null then d.amount else -d.amount end) else 0 end), 0)::numeric(18,2)::text total_billed,
        coalesce(sum(case when d.kind = 'bill' and d.salesman_id in (select id from non_mubashir) then (case when d.reverses is null then d.amount else -d.amount end) else 0 end), 0)::numeric(18,2)::text retail_billed,
        coalesce(sum(case when d.kind = 'bill' and d.salesman_id in (select id from mubashir) then (case when d.reverses is null then d.amount else -d.amount end) else 0 end), 0)::numeric(18,2)::text mubashir_billed,
        coalesce(sum(case when d.kind in ('receipt', 'identify') and coalesce(d.data->>'isHandoverConfirmation', 'false') != 'true' and not (d.data ? 'reference' and d.data->>'reference' like 'Cash handover confirmed%') then (case when d.reverses is null then d.amount else -d.amount end) else 0 end), 0)::numeric(18,2)::text total_collections,
        coalesce(sum(case when d.kind in ('receipt', 'identify') and coalesce(d.data->>'isHandoverConfirmation', 'false') != 'true' and not (d.data ? 'reference' and d.data->>'reference' like 'Cash handover confirmed%') and d.salesman_id in (select id from non_mubashir) then (case when d.reverses is null then d.amount else -d.amount end) else 0 end), 0)::numeric(18,2)::text retail_collections,
        coalesce(sum(case when d.kind in ('receipt', 'identify') and coalesce(d.data->>'isHandoverConfirmation', 'false') != 'true' and not (d.data ? 'reference' and d.data->>'reference' like 'Cash handover confirmed%') and d.salesman_id in (select id from mubashir) then (case when d.reverses is null then d.amount else -d.amount end) else 0 end), 0)::numeric(18,2)::text mubashir_collections,
        coalesce(sum(case when d.kind = 'bill' and d.business_date = ${date}::date then (case when d.reverses is null then d.amount else -d.amount end) else 0 end), 0)::numeric(18,2)::text today_billed,
        coalesce(sum(case when d.kind = 'bill' and d.salesman_id in (select id from non_mubashir) and d.business_date = ${date}::date then (case when d.reverses is null then d.amount else -d.amount end) else 0 end), 0)::numeric(18,2)::text today_retail_billed,
        coalesce(sum(case when d.kind = 'bill' and d.salesman_id in (select id from mubashir) and d.business_date = ${date}::date then (case when d.reverses is null then d.amount else -d.amount end) else 0 end), 0)::numeric(18,2)::text today_mubashir_billed,
        (select retail_dues::text from dues_calc) as retail_dues,
        (select mubashir_dues::text from dues_calc) as mubashir_dues,
        (select total_dues::text from dues_calc) as total_dues
      from documents d
      where d.org = ${a.org} and d.business_date <= ${date}::date`,
    );
    return c.json({
      date,
      refreshedAt: new Date().toISOString(),
      due: money(due),
      credit: money(credit),
      people,
      accounts,
      activity,
      claims,
      transit,
      loans,
      closes,
      pendingHandovers,
      summary,
      cashSummary,
      dayClosed: period?.closed ?? false,
      backupStatus: "Not connected",
      exceptions,
      otherBalances,
      segments: segments ?? {
        total_billed: "0.00",
        retail_billed: "0.00",
        mubashir_billed: "0.00",
        total_collections: "0.00",
        retail_collections: "0.00",
        mubashir_collections: "0.00",
        today_billed: "0.00",
        today_retail_billed: "0.00",
        today_mubashir_billed: "0.00",
        retail_dues: "0.00",
        mubashir_dues: "0.00",
        total_dues: "0.00",
      },
    });
  }),
);
const page = (value: string | undefined) =>
  Math.max(0, Math.min(100000, Number(value ?? 0) || 0));
app.get("/api/v1/documents", async (c) => {
  const a = c.get("actor"),
    offset = page(c.req.query("offset")),
    limitParam = Math.max(1, Math.min(1000, Number(c.req.query("limit") ?? 50) || 50)),
    search = (c.req.query("search") ?? "").trim().slice(0, 200),
    kind = c.req.query("kind"),
    fromDate = (c.req.query("from") ?? "").trim(),
    toDate = (c.req.query("to") ?? "").trim(),
    salesmanId = c.req.query("salesmanId"),
    excludeSalesmanId = c.req.query("excludeSalesmanId"),
    requireSalesman = c.req.query("requireSalesman") === "true";

  const conditions = [sql`d.org = ${a.org}`];
  if (salesmanId) {
    conditions.push(sql`d.salesman_id = ${salesmanId}`);
  }
  if (excludeSalesmanId) {
    if (requireSalesman) {
      conditions.push(sql`d.salesman_id is not null and d.salesman_id != ${excludeSalesmanId}`);
    } else {
      conditions.push(sql`(d.salesman_id is null or d.salesman_id != ${excludeSalesmanId})`);
    }
  } else if (requireSalesman) {
    conditions.push(sql`d.salesman_id is not null`);
  }
  if (kind) {
    if (kind.includes(",")) {
      const kinds = kind.split(",").map((k) => k.trim());
      conditions.push(
        sql`d.kind in (${sql.join(kinds.map((k) => sql`${k}`), sql`, `)})`,
      );
    } else {
      conditions.push(sql`d.kind = ${kind}`);
    }
  }
  if (fromDate) {
    conditions.push(sql`d.business_date >= ${fromDate}`);
  }
  if (toDate) {
    conditions.push(sql`d.business_date <= ${toDate}`);
  }
  if (search) {
    const s = "%" + search.replace(/[%_\\]/g, "\\$&") + "%";
    conditions.push(
      sql`(d.number ilike ${s} or s.name ilike ${s} or d.data->>'customerName' ilike ${s} or d.data->>'customerRef' ilike ${s} or d.data->>'paperReference' ilike ${s} or d.data->>'reference' ilike ${s} or d.data->>'payee' ilike ${s} or d.data->>'category' ilike ${s} or d.data->>'foodsSalesman' ilike ${s} or d.data->>'foodItems' ilike ${s} or d.data->>'billNo' ilike ${s} or d.data->>'note' ilike ${s})`,
    );
  }

  const whereClause = sql.join(conditions, sql` and `);

  const result = await rows(
    db,
    sql`
      select 
        d.*,
        coalesce(s.name, d.data->>'foodsSalesman', d.data->>'payee', d.data->>'counterparty', d.data->>'employeeName') salesman_name,
        case 
          when d.kind<>'bill' then null 
          when coalesce(ap.applied,0)>=d.amount then 'Settled' 
          when coalesce(ap.applied,0)>0 then 'Part-paid / credited' 
          else 'Unpaid' 
        end settlement,
        exists(select 1 from documents r where r.org=d.org and r.reverses=d.id) reversed,
        case 
          when d.kind = 'bill' then exists(
            select 1 from documents ret 
            where ret.org = d.org 
              and ret.kind = 'return' 
              and (
                ret.data->>'billId' = d.id::text 
                or exists(
                  select 1 from bill_lines bl 
                  where bl.org = d.org and bl.document_id = d.id and bl.id = ret.return_line_id
                )
              )
              and not exists(select 1 from documents rev where rev.org = ret.org and rev.reverses = ret.id)
          )
          else false 
        end returned,
        coalesce(qty.total_quantity, 0)::text total_quantity,
        coalesce(qty.lines_count, 0)::int lines_count
      from documents d 
      left join salesmen s on s.id=d.salesman_id 
      left join lateral (
        select sum(x.amount) applied 
        from allocations x 
        join allocation_heads h on h.salesman_id=x.salesman_id and h.generation=x.generation 
        where x.org=d.org and x.charge_id=d.id
      ) ap on true 
      left join lateral (
        select sum(l.quantity) total_quantity, count(l.id) lines_count 
        from bill_lines l 
        where l.org=d.org and l.document_id=d.id
      ) qty on true
      where ${whereClause} 
      order by d.business_date desc, d.created_at desc 
      limit ${limitParam} offset ${offset}
    `,
  );
  return c.json(result);
});
app.post("/api/v1/documents/lines", async (c) => {
  const a = c.get("actor");
  const body = (await c.req.json().catch(() => ({}))) as { documentIds?: unknown };
  const docIds = z.array(z.string().uuid()).safeParse(body.documentIds);
  if (!docIds.success || docIds.data.length === 0) {
    return c.json([]);
  }
  const result = await rows(
    db,
    sql`select 
          l.id,
          l.document_id,
          l.product_id,
          l.quantity,
          l.amount,
          coalesce(sum((ret.data->>'quantity')::numeric), 0)::text returned_quantity,
          l.snapshot,
          d.number document_number,
          d.business_date,
          coalesce(d.data->>'customerName', d.data->>'customerRef', '') customer_name
        from bill_lines l
        join documents d on d.id = l.document_id
        left join documents ret on ret.org = l.org
          and ret.kind = 'return'
          and ret.return_line_id = l.id
          and not exists(select 1 from documents rev where rev.org = ret.org and rev.reverses = ret.id)
        where l.org = ${a.org}
          and d.kind = 'bill'
          and not exists(select 1 from documents rev where rev.org = d.org and rev.reverses = d.id)
          and l.document_id in (${sql.join(docIds.data.map((did) => sql`${did}`), sql`, `)})
        group by l.id, d.id
        order by d.business_date desc, d.number desc, l.id asc`,
  );
  return c.json(result);
});
app.get("/api/v1/documents/:id", async (c) =>
  db.transaction(async (t) => {
    await t.execute(
      sql`set transaction isolation level repeatable read read only`,
    );
    const a = c.get("actor"),
      recordId = id.parse(c.req.param("id"));
    const [d] = await rows(
      t,
      sql`select d.*,
        exists(select 1 from documents r where r.reverses=d.id and r.org=d.org) reversed,
        (select r.id from documents r where r.reverses=d.id and r.org=d.org limit 1) reversal_id,
        (select r.number from documents r where r.reverses=d.id and r.org=d.org limit 1) reversal_number,
        (select orig.number from documents orig where orig.id=d.reverses and orig.org=d.org limit 1) original_number,
        case 
          when d.kind<>'bill' then null 
          when coalesce((select sum(x.amount) from allocations x join allocation_heads h on h.salesman_id=x.salesman_id and h.generation=x.generation where x.org=d.org and x.charge_id=d.id),0)>=d.amount then 'Settled' 
          when coalesce((select sum(x.amount) from allocations x join allocation_heads h on h.salesman_id=x.salesman_id and h.generation=x.generation where x.org=d.org and x.charge_id=d.id),0)>0 then 'Part-paid / credited' 
          else 'Unpaid' 
        end settlement,
        case 
          when d.kind = 'bill' then exists(
            select 1 from documents ret 
            where ret.org = d.org 
              and ret.kind = 'return' 
              and (
                ret.data->>'billId' = d.id::text 
                or exists(
                  select 1 from bill_lines bl 
                  where bl.org = d.org and bl.document_id = d.id and bl.id = ret.return_line_id
                )
              )
              and not exists(select 1 from documents rev where rev.org = ret.org and rev.reverses = ret.id)
          )
          else false 
        end returned
      from documents d where d.org=${a.org} and d.id=${recordId}`,
    );
    ensure(d, "Record not found", "NOT_FOUND", 404);
    const [fetchedLines, entries, allocations, attachments] = await Promise.all([
      rows(
        t,
        sql`select l.*,coalesce(sum((ret.data->>'quantity')::numeric),0)::text returned_quantity from bill_lines l left join documents ret on ret.org=l.org and ret.kind='return' and ret.return_line_id = l.id and not exists(select 1 from documents rev where rev.org=ret.org and rev.reverses=ret.id) where l.org=${a.org} and l.document_id=${recordId} group by l.id`,
      ),
      rows(
        t,
        sql`select account,debit,credit from journal where org=${a.org} and document_id=${recordId}`,
      ),
      rows(
        t,
        sql`select x.*,credit.kind credit_kind,credit.number credit_number,coalesce(credit.data->>'customerName','') credit_customer,charge.kind charge_kind,charge.number charge_number,coalesce(charge.data->>'customerName','') charge_customer from allocations x join allocation_heads h on h.salesman_id=x.salesman_id and h.generation=x.generation join documents credit on credit.id=x.credit_id join documents charge on charge.id=x.charge_id where x.org=${a.org} and (x.credit_id=${recordId} or x.charge_id=${recordId})`,
      ),
      rows(
        t,
        sql`select id,mime,size from attachments where org=${a.org} and document_id=${recordId}`,
      ),
    ]);
    let lines = fetchedLines;

    if (d.kind === "return") {
      const data = (d.data ?? {}) as Record<string, unknown>;
      if (data.billId) {
        const [origBill] = await rows<{ number: string; business_date: string; salesman_name: string | null; customer_name: string | null }>(
          t,
          sql`select d.number, d.business_date, s.name salesman_name, c.customer_name from documents d left join salesmen s on s.id=d.salesman_id left join itc_customers c on c.id=d.customer_id where d.org=${a.org} and d.id=${data.billId}`
        );
        if (origBill) {
          d.data = {
            ...data,
            originalBillNumber: origBill.number,
            originalBillDate: origBill.business_date,
            salesmanName: data.salesmanName || origBill.salesman_name,
            customerName: data.customerName || origBill.customer_name,
          };
        }
      }
      if (lines.length === 0 && data.snapshot) {
        lines = [
          {
            id: data.lineId || d.id,
            org: d.org,
            document_id: d.id,
            product_id: (data.snapshot as Record<string, unknown>).id || null,
            quantity: String(data.quantity || "1"),
            amount: d.amount,
            snapshot: data.snapshot,
          },
        ];
      }
    }
    if (d.kind === "receipt") {
      const data = (d.data ?? {}) as Record<string, unknown>;
      if (data.previousBalance === undefined) {
        const custId = d.customer_id || data.customerId;
        let prev = D(0);
        if (custId) {
          const custDocs = await rows<{ id: string; kind: string; amount: string; created_at: string; business_date: string }>(
            t,
            sql`select d.id, d.kind, d.amount::text, d.created_at::text, d.business_date::text from documents d left join documents orig on orig.id::text = d.data->>'billId' and orig.org = d.org where d.org=${a.org} and coalesce(d.customer_id, orig.customer_id) = ${custId}::uuid and d.kind in ('bill', 'receipt', 'return') and not exists(select 1 from documents rev where rev.org = ${a.org} and rev.reverses = d.id) order by d.business_date asc, d.created_at asc, case when d.kind in ('opening', 'bill') then 1 when d.kind = 'return' then 2 else 3 end asc, d.id asc`,
          );
          for (const cd of custDocs) {
            if (cd.id === d.id) break;
            if (cd.kind === "bill") prev = prev.plus(cd.amount);
            else prev = prev.minus(cd.amount);
          }
        } else if (d.salesman_id) {
          const [prevRow] = await rows<{ bal: string }>(
            t,
            sql`select coalesce(sum(j.debit - j.credit), 0)::text bal 
                from journal j 
                join documents doc on doc.id = j.document_id 
                where j.org=${a.org} 
                  and j.account=${"trade:" + d.salesman_id} 
                  and not exists(select 1 from documents rev where rev.org=${a.org} and rev.reverses=doc.id) 
                  and (
                    doc.id::text = ${(data.billId as string) || ""}
                    or doc.business_date < ${d.business_date} 
                    or (
                      doc.business_date = ${d.business_date} 
                      and (
                        doc.created_at < ${d.created_at}
                        or (
                          doc.created_at = ${d.created_at}
                          and (
                            case when doc.kind in ('opening', 'bill') then 1 when doc.kind = 'return' then 2 else 3 end
                            <
                            case when ${d.kind} in ('opening', 'bill') then 1 when ${d.kind} = 'return' then 2 else 3 end
                            or (
                              (case when doc.kind in ('opening', 'bill') then 1 when doc.kind = 'return' then 2 else 3 end)
                              =
                              (case when ${d.kind} in ('opening', 'bill') then 1 when ${d.kind} = 'return' then 2 else 3 end)
                              and doc.id < ${d.id}
                            )
                          )
                        )
                      )
                    )
                  )`,
          );
          prev = D(prevRow?.bal || "0");
        }
        const currentRcv = D(String(d.amount ?? "0"));
        const outstanding = prev.minus(currentRcv);
        d.data = {
          ...data,
          previousBalance: money(prev),
          currentAmountReceived: money(currentRcv),
          overallOutstanding: money(outstanding),
        };
      }
    }
    return c.json({ ...d, lines, entries, allocations, attachments });
  }),
);
app.get("/api/v1/statements/:id", async (c) =>
  db.transaction(async (t) => {
    await t.execute(
      sql`set transaction isolation level repeatable read read only`,
    );
    const a = c.get("actor"),
      salesmanId = id.parse(c.req.param("id")),
      from = dateSchema.parse(c.req.query("from") ?? "2000-01-01"),
      to = dateSchema.parse(c.req.query("to") ?? businessDate());
    ensure(from <= to, "Invalid date range");
    const [s] = await rows(
      t,
      sql`select * from salesmen where org=${a.org} and id=${salesmanId}`,
    );
    ensure(s, "Record not found", "NOT_FOUND", 404);
    const [opening] = await rows<{ amount: string }>(
      t,
      sql`select coalesce(sum(j.debit-j.credit),0)::numeric(18,2)::text amount from journal j join documents d on d.id=j.document_id where j.org=${a.org} and j.account=${"trade:" + salesmanId} and d.business_date<${from}`,
    );
    const result = await rows(
      t,
      sql`select d.id,d.number,d.kind,d.business_date::text date,d.created_at::text created_at,d.actual_date::text actual_date,d.data,sum(j.debit)::text debit,sum(j.credit)::text credit from documents d join journal j on j.document_id=d.id where j.org=${a.org} and j.account=${"trade:" + salesmanId} and d.business_date between ${from} and ${to} group by d.id order by d.business_date,d.created_at,d.id limit 1001`,
    );
    ensure(
      result.length <= 1000,
      "Narrow the date range to 1,000 statement entries",
    );
    let running = D(opening.amount);
    const entries = result.map((r) => {
      running = running.plus(String(r.debit)).minus(String(r.credit));
      return { ...r, balance: money(running) };
    });
    const pending = await rows(
      t,
      sql`select id,amount,state,actual_date,reference from receipt_claims where org=${a.org} and salesman_id=${salesmanId} and state<>'confirmed'`,
    );
    return c.json({
      salesman: s,
      from,
      to,
      opening: opening.amount,
      ending: money(running),
      entries,
      pending,
    });
  }),
);
app.get("/api/v1/audit", async (c) => {
  const a = c.get("actor");
  owner(a);
  return c.json(
    await rows(
      db,
      sql`select x.*,u.name actor_name,d.id document_id,coalesce(d.number,s.name,x.target) record_label,coalesce(x.data->>'reason',x.data->>'note','') reason from audit x left join "user" u on u.id=x.actor left join documents d on d.id::text=x.target and d.org=x.org left join salesmen s on s.id::text=x.target and s.org=x.org where x.org=${a.org} order by x.created_at desc limit 100 offset ${page(c.req.query("offset"))}`,
    ),
  );
});
app.get("/api/v1/diagnostics", async (c) => {
  const a = c.get("actor");
  owner(a);
  const unbalanced = await rows(
    db,
    sql`select d.id from documents d left join journal j on j.document_id=d.id where d.org=${a.org} group by d.id having coalesce(sum(j.debit-j.credit),0)<>0 or count(j.id)=0`,
  );
  const overallocated = await rows(
    db,
    sql`select x.credit_id from allocations x join allocation_heads h on h.salesman_id=x.salesman_id and h.generation=x.generation join documents d on d.id=x.credit_id where x.org=${a.org} group by x.credit_id,d.amount having sum(x.amount)>d.amount`,
  );
  return c.json({ unbalanced, overallocated });
});
app.post("/api/v1/drafts", async (c) => {
  const a = c.get("actor");
  const p = z
    .object({
      id: id.optional(),
      version: z.number().int().optional(),
      data: z.record(z.string(), z.unknown()),
    })
    .strict()
    .parse(await c.req.json());
  const [r] = p.id
    ? await rows(
      db,
      sql`update drafts set data=${JSON.stringify(p.data)}::jsonb,version=version+1 where id=${p.id} and org=${a.org} and actor=${a.id} and version=${p.version ?? 0} returning id,version`,
    )
    : await rows(
      db,
      sql`insert into drafts(org,actor,data) values(${a.org},${a.id},${JSON.stringify(p.data)}::jsonb) returning id,version`,
    );
  ensure(r, "Draft changed in another tab", "DRAFT_CONFLICT", 409);
  return c.json(r);
});
app.get("/api/v1/drafts", async (c) => {
  const a = c.get("actor");
  return c.json(
    await rows(
      db,
      sql`select * from drafts where org=${a.org} and actor=${a.id} order by created_at desc limit 50`,
    ),
  );
});
app.get("/api/v1/drafts/:id", async (c) => {
  const a = c.get("actor");
  const draftId = id.parse(c.req.param("id"));
  const [draft] = await rows(
    db,
    sql`select * from drafts where id=${draftId} and org=${a.org} and actor=${a.id}`,
  );
  if (!draft) {
    return c.json({ code: "NOT_FOUND", message: "Draft not found" }, 404);
  }
  return c.json(draft);
});
app.delete("/api/v1/drafts/:id", async (c) => {
  const a = c.get("actor");
  const draftId = id.parse(c.req.param("id"));
  await db.execute(
    sql`delete from drafts where id=${draftId} and org=${a.org} and actor=${a.id}`,
  );
  return c.json({ ok: true });
});
app.post("/api/v1/requests", async (c) => {
  const a = c.get("actor");
  const p = z
    .object({
      command: z.enum(Object.keys(commands) as [string, ...string[]]),
      payload: z.record(z.string(), z.unknown()),
      reason: z.string().min(3),
    })
    .strict()
    .parse(await c.req.json());
  const schema = commands[p.command as keyof typeof commands];
  const payload = schema.parse(p.payload);
  if (p.command === "bill")
    ensure(
      "expectedQuoteHash" in payload && payload.expectedQuoteHash,
      "Review the bill quote before requesting approval",
      "STALE_REVIEW",
      409,
    );
  const [r] = await rows(
    db,
    sql`insert into requests(org,actor,payload,reason) values(${a.org},${a.id},${JSON.stringify({ command: p.command, payload })}::jsonb,${p.reason}) returning id`,
  );
  return c.json(r, 201);
});
app.get("/api/v1/requests", async (c) => {
  const a = c.get("actor");
  return c.json(
    await rows(
      db,
      sql`select * from requests where org=${a.org} order by created_at desc limit 100`,
    ),
  );
});
app.post("/api/v1/attachments/:documentId", async (c) => {
  const a = c.get("actor"),
    documentId = id.parse(c.req.param("documentId"));
  const [d] = await rows(
    db,
    sql`select id from documents where org=${a.org} and id=${documentId}`,
  );
  ensure(d, "Record not found", "NOT_FOUND", 404);
  const form = await c.req.formData(),
    file = form.get("file");
  ensure(file instanceof File, "Select a file");
  ensure(
    file.size <= 10 * 1024 * 1024 && file.size > 0,
    "File must be at most 10 MB",
  );
  const bytes = new Uint8Array(await file.arrayBuffer());
  const head = Array.from(bytes.slice(0, 8))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
  const mime = head.startsWith("255044462d")
    ? "application/pdf"
    : head.startsWith("89504e470d0a1a0a")
      ? "image/png"
      : head.startsWith("ffd8ff")
        ? "image/jpeg"
        : null;
  ensure(
    mime && mime === file.type,
    "Only verified PDF, PNG or JPEG file signatures accepted",
  );
  const key = crypto.randomUUID(),
    dir = resolve(process.env.ATTACHMENT_DIR ?? "private-files");
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(resolve(dir, key), bytes, { mode: 0o600, flag: "wx" });
  const r = await db.transaction(async (t) => {
    await lock(t, a.org);
    const [r] = await rows(
      t,
      sql`insert into attachments(org,document_id,key,mime,size,hash,actor) values(${a.org},${documentId},${key},${mime},${file.size},${new Bun.CryptoHasher("sha256").update(bytes).digest("hex")},${a.id}) returning id`,
    );
    await auditEvent(t, a, "attach", String(r.id), { documentId });
    return r;
  });
  return c.json({ ...r, scanStatus: "Not configured" }, 201);
});
app.get("/api/v1/attachments/:id", async (c) => {
  const a = c.get("actor"),
    attachmentId = id.parse(c.req.param("id"));
  const [r] = await rows<{ key: string; mime: string }>(
    db,
    sql`select key,mime from attachments where org=${a.org} and id=${attachmentId}`,
  );
  ensure(r, "Attachment not found", "NOT_FOUND", 404);
  c.header("Cache-Control", "no-store");
  c.header("Content-Type", r.mime);
  c.header("Content-Disposition", 'attachment; filename="evidence"');
  return c.body(
    await Bun.file(
      resolve(process.env.ATTACHMENT_DIR ?? "private-files", r.key),
    ).arrayBuffer(),
  );
});
app.get("/api/v1/export", async (c) => {
  const a = c.get("actor");
  const result = await rows(
    db,
    sql`select number,kind,business_date,amount,salesman_id,data->>'note' note from documents where org=${a.org} order by business_date,created_at limit 10001`,
  );
  ensure(
    result.length <= 10000,
    "Narrow export via report filters before exporting more than 10,000 records",
  );
  await db.transaction((t) =>
    auditEvent(t, a, "export", "documents", { count: result.length }),
  );
  const fields = [
    "number",
    "kind",
    "business_date",
    "amount",
    "salesman_id",
    "note",
  ];
  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header("Content-Disposition", 'attachment; filename="ledger.csv"');
  return c.body(
    "\uFEFF" +
    [fields, ...result.map((r) => fields.map((f) => r[f]))]
      .map((r) => r.map(csvCell).join(","))
      .join("\r\n"),
  );
});
app.get("/api/v1/export/itc", async (c) => {
  const a = c.get("actor");
  const targetDate = c.req.query("date") ?? businessDate();
  const selectedBillsParam = c.req.query("bills"); // comma-separated document IDs

  const selectedIds = selectedBillsParam
    ? selectedBillsParam
      .split(",")
      .map((s) => s.trim())
      .filter((s) => Boolean(s) && z.string().uuid().safeParse(s).success)
    : null;

  // 1. Fetch bills for the businessDate (optionally filtered by selectedIds)
  const bills = await rows<{
    id: string;
    number: string;
    salesman_id: string;
    amount: string;
    salesman_name: string;
    salesman_itc_id: string | null;
    salesman_itc_name: string | null;
    beat_code: string | null;
    beat_name: string | null;
    customer_id: string | null;
    customer_name: string | null;
    customer_ref: string | null;
  }>(
    db,
    sql`
      select 
        d.id,
        d.number,
        d.salesman_id,
        d.amount,
        s.name salesman_name,
        s.itc_id salesman_itc_id,
        s.name salesman_itc_name,
        s.beat_code beat_code,
        s.beat_name beat_name,
        d.customer_id::text customer_id,
        d.data->>'customerName' customer_name,
        d.data->>'customerRef' customer_ref
      from documents d
      join salesmen s on s.id = d.salesman_id
      where d.org = ${a.org}
        and d.kind = 'bill'
        and d.business_date = ${targetDate}
        and (${selectedIds === null} or d.id in ${selectedIds && selectedIds.length > 0 ? sql`(${sql.join(selectedIds.map((id) => sql`${id}`), sql`, `)})` : sql`(null)`})
        and not exists(select 1 from documents r where r.org = d.org and r.reverses = d.id)
      order by d.created_at asc
    `,
  );

  // 2. Fetch bill lines with product codes and names
  const billLinesList = await rows<{
    id: string;
    document_id: string;
    product_id: string;
    quantity: string;
    amount: string;
    returned_quantity: string;
    product_code: string;
    product_name: string;
    product_category: string | null;
    itc_multiple: string | null;
    is_focus_brand: boolean | null;
    unit: string | null;
  }>(
    db,
    sql`
      select 
        l.id,
        l.document_id,
        l.product_id,
        l.quantity,
        l.amount,
        coalesce(sum((ret.data->>'quantity')::numeric), 0)::text returned_quantity,
        p.code product_code,
        p.name product_name,
        p.category product_category,
        p.itc_multiple,
        p.is_focus_brand,
        c.unit
      from bill_lines l
      join documents d on d.id = l.document_id
      join products p on p.id = l.product_id
      left join documents ret on ret.org = l.org
        and ret.kind = 'return'
        and ret.return_line_id = l.id
        and not exists(select 1 from documents rev where rev.org = ret.org and rev.reverses = ret.id)
      left join lateral (
        select unit from product_configurations cfg
        where cfg.product_id = p.id and cfg.org = p.org
        order by cfg.effective_date desc, cfg.created_at desc
        limit 1
      ) c on true
      where l.org = ${a.org}
        and d.kind = 'bill'
        and d.business_date = ${targetDate}
        and (${selectedIds === null} or d.id in ${selectedIds && selectedIds.length > 0 ? sql`(${sql.join(selectedIds.map((id) => sql`${id}`), sql`, `)})` : sql`(null)`})
        and not exists(select 1 from documents r where r.org = d.org and r.reverses = d.id)
      group by l.id, d.id, p.id, c.unit
      order by d.created_at asc, l.id asc
    `,
  );

  // Group lines by document_id
  const linesByDoc = new Map<string, typeof billLinesList>();
  for (const line of billLinesList) {
    if (!linesByDoc.has(line.document_id)) {
      linesByDoc.set(line.document_id, []);
    }
    linesByDoc.get(line.document_id)!.push(line);
  }

  // 3. Fetch all active ITC customers for the org
  const customerList = await rows<{
    id: string;
    customer_id: string;
    customer_name: string;
    salesman_itc_id: string;
    salesman_name: string;
    beat_code: string;
    beat_name: string;
    salesman_id: string | null;
    is_gst: boolean;
  }>(
    db,
    sql`
      select 
        c.id,
        c.customer_id,
        c.customer_name,
        coalesce(nullif(c.salesman_itc_id, ''), s.itc_id, '') salesman_itc_id,
        coalesce(nullif(c.salesman_name, ''), s.name, '') salesman_name,
        coalesce(nullif(c.beat_code, ''), s.beat_code, '') beat_code,
        coalesce(nullif(c.beat_name, ''), s.beat_name, '') beat_name,
        c.salesman_id,
        coalesce(c.is_gst, false) is_gst
      from itc_customers c
      left join salesmen s on s.id = c.salesman_id
      where c.org = ${a.org} and c.active = true
      order by c.customer_name asc
    `,
  );

  // Fast lookup map for ITC customers by ID or customer_id code
  const customerByIdOrCode = new Map<string, (typeof customerList)[0]>();
  for (const cust of customerList) {
    customerByIdOrCode.set(cust.id, cust);
    customerByIdOrCode.set(cust.customer_id, cust);
  }

  // Group customers by salesman_id (and fallback by salesman name)
  const customersBySalesman = new Map<string, typeof customerList>();
  for (const cust of customerList) {
    const key = cust.salesman_id ?? cust.salesman_name.replace(/\s+/g, " ").trim().toUpperCase();
    if (!customersBySalesman.has(key)) {
      customersBySalesman.set(key, []);
    }
    customersBySalesman.get(key)!.push(cust);
  }

  // Collect customer IDs already billed across selected bills (or targetDate bills)
  // so spillover avoids customers who already have their own direct bill
  const billedCustomerIdsToday = new Set<string>();
  for (const b of bills) {
    if (b.customer_id) {
      billedCustomerIdsToday.add(String(b.customer_id));
    }
  }

  // Group bills by salesman and customer to consolidate multiple bills for the same customer
  type BillGroup = {
    groupKey: string;
    is_gst: boolean;
    salesman_id: string;
    salesman_name: string;
    salesman_itc_id: string | null;
    salesman_itc_name: string | null;
    beat_code: string | null;
    beat_name: string | null;
    customer_id: string | null;
    customer_name: string | null;
    customer_ref: string | null;
    lines: typeof billLinesList;
  };

  const groupsMap = new Map<string, BillGroup>();
  for (const b of bills) {
    const cust = b.customer_id ? customerByIdOrCode.get(b.customer_id) : undefined;
    const isGstBill = cust?.is_gst === true;

    // Unique key per salesman and customer.
    // For GST bills, separate each GST customer cleanly into its own group.
    // If retail/bulk bill without customer_id, group by salesman alone so multiple retail bills
    // for the same salesman merge into a single consolidated pool instead of splitting.
    const custKey = b.customer_id ? `cust_${b.customer_id}` : `retail_pool`;
    const groupKey = isGstBill ? `gst_${b.salesman_id}__${custKey}` : `${b.salesman_id}__${custKey}`;

    let grp = groupsMap.get(groupKey);
    if (!grp) {
      grp = {
        groupKey,
        is_gst: isGstBill,
        salesman_id: b.salesman_id,
        salesman_name: b.salesman_name,
        salesman_itc_id: b.salesman_itc_id,
        salesman_itc_name: b.salesman_itc_name,
        beat_code: b.beat_code,
        beat_name: b.beat_name,
        customer_id: b.customer_id,
        customer_name: b.customer_name,
        customer_ref: b.customer_ref,
        lines: [],
      };
      groupsMap.set(groupKey, grp);
    }
    const docLines = linesByDoc.get(b.id) ?? [];
    grp.lines.push(...docLines);
  }

  // Track customer IDs used across the export to prevent cross-bill spillover collisions
  const usedCustomerIdsInExport = new Set<string>();

  // Build ITC rows
  // Columns:
  // Customer ID, Customer Name, Salesman ID, Salesman Name, Beat Code, Beat Name, Category, Product Code, Product Desc, UOM (CFC/PAC/BaseUOM), Product Order QTY, Order Reference No, Cust Discount %
  const itcRows: (string | number)[][] = [];

  for (const grp of groupsMap.values()) {
    if (grp.lines.length === 0) continue;

    // Consolidate lines with the same product code within the group
    const mergedLinesMap = new Map<string, {
      product_id: string;
      product_code: string;
      product_name: string;
      category: string;
      totalQty: Decimal;
      totalAmt: Decimal;
      itc_multiple: string | null;
      is_focus_brand: boolean | null;
    }>();

    for (const line of grp.lines) {
      const pCode = String(line.product_code || "").trim();
      const lineQty = D(line.quantity || "0");
      const retQty = D(line.returned_quantity || "0");
      const netQty = Decimal.max(0, lineQty.minus(retQty));
      if (netQty.lte(0)) {
        continue;
      }
      const unitRate = lineQty.gt(0) ? D(line.amount || "0").div(lineQty) : D(0);
      const netAmt = unitRate.times(netQty);

      const existing = mergedLinesMap.get(pCode);
      if (existing) {
        existing.totalQty = existing.totalQty.plus(netQty);
        existing.totalAmt = existing.totalAmt.plus(netAmt);
      } else {
        mergedLinesMap.set(pCode, {
          product_id: line.product_id,
          product_code: line.product_code,
          product_name: line.product_name,
          category: line.product_category || "CG-01 CIGARETTE",
          totalQty: netQty,
          totalAmt: netAmt,
          itc_multiple: line.itc_multiple,
          is_focus_brand: line.is_focus_brand,
        });
      }
    }

    const consolidatedLines = Array.from(mergedLinesMap.values());
    if (consolidatedLines.length === 0) continue;
    const targetCustomer = grp.customer_id ? customerByIdOrCode.get(grp.customer_id) : undefined;

    // === CASE 1: GST BILL ===
    // GST bills stay clean and un-divided for the GST customer.
    // They are NOT split, NOT capped, and NOT spilled over into other customers.
    if (grp.is_gst && targetCustomer) {
      usedCustomerIdsInExport.add(targetCustomer.customer_id);
      usedCustomerIdsInExport.add(targetCustomer.id);

      for (const line of consolidatedLines) {
        const qty = line.totalQty;
        itcRows.push([
          targetCustomer.customer_id,
          targetCustomer.customer_name,
          targetCustomer.salesman_itc_id || grp.salesman_itc_id || "",
          targetCustomer.salesman_name || grp.salesman_itc_name || grp.salesman_name,
          targetCustomer.beat_code || grp.beat_code || "",
          targetCustomer.beat_name || grp.beat_name || "",
          line.category || "CG-01 CIGARETTE",
          line.product_code,
          line.product_name,
          "BaseUOM",
          qty.isInteger() ? qty.toFixed(0) : qty.toFixed(2),
          "",
          "1.00",
        ]);
      }
      continue;
    }

    // === CASE 2: NON-GST BILL ===
    // Prioritize focus brand products first so first customer receives focus brands first
    const prioritizedLines = [...consolidatedLines].sort((a, b) => {
      const aFocus = a.is_focus_brand === true ? 1 : 0;
      const bFocus = b.is_focus_brand === true ? 1 : 0;
      return bFocus - aFocus;
    });

    // Available customers for this salesman (strictly NON-GST customers)
    const normName = grp.salesman_name.replace(/\s+/g, " ").trim().toUpperCase();
    const salesmanCustomers =
      customersBySalesman.get(grp.salesman_id) ??
      customersBySalesman.get(normName) ??
      customerList; // fallback to any if none matched

    // STRICT RULE: While dividing non-GST bills, do NOT consider GST customers/bills.
    // Only Non-GST customers are candidate recipients for divided non-GST bills.
    let candidateCustomers = salesmanCustomers.filter((c) => !c.is_gst);
    if (candidateCustomers.length === 0) {
      candidateCustomers = customerList.filter((c) => !c.is_gst);
    }
    if (candidateCustomers.length === 0) continue;

    let orderedCustomers: typeof candidateCustomers;

    if (grp.customer_id && targetCustomer && !targetCustomer.is_gst) {
      // Direct Non-GST bill:
      // 1. First assign to that specific Non-GST customer
      // Find spillover customers under the same salesman that are Non-GST,
      // were NOT billed today, and have not been used by spillover in earlier groups of this export
      const unbilledOthers = candidateCustomers.filter(
        (c) =>
          c.customer_id !== targetCustomer.customer_id &&
          c.id !== targetCustomer.id &&
          !c.is_gst &&
          !billedCustomerIdsToday.has(c.customer_id) &&
          !billedCustomerIdsToday.has(c.id) &&
          !usedCustomerIdsInExport.has(c.customer_id) &&
          !usedCustomerIdsInExport.has(c.id),
      );

      // Prioritize same beat first, then other beats
      const sameBeat = unbilledOthers
        .filter((c) => c.beat_code && targetCustomer.beat_code && c.beat_code === targetCustomer.beat_code)
        .sort(() => Math.random() - 0.5);
      const otherBeats = unbilledOthers
        .filter((c) => !targetCustomer.beat_code || c.beat_code !== targetCustomer.beat_code)
        .sort(() => Math.random() - 0.5);

      // Fallback: if all other customers of that salesman were billed, allow candidate unbilled customers
      const spilloverList = [...sameBeat, ...otherBeats];
      if (spilloverList.length > 0) {
        orderedCustomers = [targetCustomer, ...spilloverList];
      } else {
        // If no unbilled customers remaining, fallback to candidateCustomers excluding targetCustomer
        const fallbackOthers = candidateCustomers
          .filter((c) => c.customer_id !== targetCustomer.customer_id && c.id !== targetCustomer.id && !c.is_gst)
          .sort(() => Math.random() - 0.5);
        orderedCustomers = [targetCustomer, ...fallbackOthers];
      }
    } else {
      // Retail / Wholesale bulk bill:
      // 1. Check for CDM / COUNTER WHOLESALE customer for this salesman as the first entry (must be Non-GST)
      const cdmCustomer = candidateCustomers.find((c) => {
        if (c.is_gst) return false;
        const cName = c.customer_name.toUpperCase();
        return cName.includes("CDM") || cName.includes("COUNTER WHOLESALE");
      });

      // 2. Separate remaining Non-GST customers and shuffle them for subsequent random choices
      const otherCustomers = candidateCustomers.filter(
        (c) =>
          (!cdmCustomer || c.id !== cdmCustomer.id) &&
          !c.is_gst &&
          !usedCustomerIdsInExport.has(c.customer_id) &&
          !usedCustomerIdsInExport.has(c.id),
      );
      const shuffledOthers = [...otherCustomers].sort(() => Math.random() - 0.5);

      orderedCustomers = cdmCustomer
        ? [cdmCustomer, ...shuffledOthers]
        : (shuffledOthers.length > 0 ? shuffledOthers : candidateCustomers.filter((c) => !c.is_gst));
    }

    let custIdx = 0;
    let currentCustomer = orderedCustomers[custIdx % orderedCustomers.length];
    if (currentCustomer) {
      usedCustomerIdsInExport.add(currentCustomer.customer_id);
      usedCustomerIdsInExport.add(currentCustomer.id);
    }

    // Cap between 48,000 and 49,000 for Non-GST customers
    const getRandomCap = (_c?: typeof currentCustomer) => D(48000 + Math.floor(Math.random() * 1001));
    let currentCap = getRandomCap(currentCustomer);
    let currentTotal = D(0);

    for (const line of prioritizedLines) {
      const totalLineAmt = line.totalAmt;
      const totalLineQty = line.totalQty;
      const unitRate = totalLineQty.gt(0) ? totalLineAmt.div(totalLineQty) : D(0);
      const isIntegerQty = totalLineQty.isInteger();
      const uom = "BaseUOM";

      // Step multiplier requirements:
      // Uses configured itc_multiple from product master, or defaults:
      // - 3531 -> multiple of 0.4
      // - 3692, 3624, 3757, 3759, 3053, 3752, 3652, 3653, 4546 -> multiple of 0.2
      // - others -> multiple of 0.1 (or 1 if integer quantity)
      const pCode = String(line.product_code || "").trim();
      const dbMultiple = line.itc_multiple ? D(line.itc_multiple) : null;
      const step: Decimal =
        dbMultiple && dbMultiple.gt(0)
          ? dbMultiple
          : pCode === "3531"
            ? D("0.4")
            : [
              "3692",
              "3624",
              "3757",
              "3759",
              "3053",
              "3752",
              "3652",
              "3653",
              "4546",
            ].includes(pCode)
              ? D("0.2")
              : isIntegerQty
                ? D("1")
                : D("0.1");

      let remainingQty = totalLineQty.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

      while (remainingQty.gt("0.0001")) {
        // Space available under current customer cap
        const availableSpace = currentCap.minus(currentTotal);

        if (availableSpace.lte(0) && currentTotal.gt(0)) {
          // Current customer is full, move to next customer (randomized others)
          custIdx++;
          currentCustomer = orderedCustomers[custIdx % orderedCustomers.length];
          if (currentCustomer) {
            usedCustomerIdsInExport.add(currentCustomer.customer_id);
            usedCustomerIdsInExport.add(currentCustomer.id);
          }
          currentCap = getRandomCap(currentCustomer);
          currentTotal = D(0);
          continue;
        }

        if (unitRate.lte(0)) {
          // If no price/rate, assign all remaining quantity
          itcRows.push([
            currentCustomer.customer_id,
            currentCustomer.customer_name,
            currentCustomer.salesman_itc_id || grp.salesman_itc_id || "",
            currentCustomer.salesman_name || grp.salesman_itc_name || grp.salesman_name,
            currentCustomer.beat_code || grp.beat_code || "",
            currentCustomer.beat_name || grp.beat_name || "",
            line.category || "CG-01 CIGARETTE",
            line.product_code,
            line.product_name,
            uom,
            remainingQty.isInteger() ? remainingQty.toFixed(0) : remainingQty.toFixed(2),
            "",
            "1.00",
          ]);
          break;
        }

        // How much quantity can fit in availableSpace in multiples of step
        const stepCost = unitRate.times(step);
        const fitSteps = stepCost.gt(0) ? availableSpace.div(stepCost).floor() : D(0);
        const fitQty = fitSteps.times(step).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

        // If even 1 step cannot fit and customer already has items, switch customer
        if (fitQty.lte(0) && currentTotal.gt(0)) {
          custIdx++;
          currentCustomer = orderedCustomers[custIdx % orderedCustomers.length];
          if (currentCustomer) {
            usedCustomerIdsInExport.add(currentCustomer.customer_id);
            usedCustomerIdsInExport.add(currentCustomer.id);
          }
          currentCap = getRandomCap(currentCustomer);
          currentTotal = D(0);
          continue;
        }

        // Allocate at least 1 step if customer is fresh/empty, otherwise cap at fitQty
        let allocQty = Decimal.min(
          remainingQty,
          Decimal.max(step, fitQty),
        ).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
        // Ensure allocQty does not exceed remainingQty
        if (allocQty.gt(remainingQty)) allocQty = remainingQty;

        const allocAmt = allocQty.times(unitRate);
        currentTotal = currentTotal.plus(allocAmt);
        remainingQty = remainingQty.minus(allocQty).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

        itcRows.push([
          currentCustomer.customer_id,
          currentCustomer.customer_name,
          currentCustomer.salesman_itc_id || grp.salesman_itc_id || "",
          currentCustomer.salesman_name || grp.salesman_itc_name || grp.salesman_name,
          currentCustomer.beat_code || grp.beat_code || "",
          currentCustomer.beat_name || grp.beat_name || "",
          line.category || "CG-01 CIGARETTE",
          line.product_code,
          line.product_name,
          uom,
          allocQty.isInteger() ? allocQty.toFixed(0) : allocQty.toFixed(2),
          "",
          "1.00",
        ]);

        if (currentTotal.gte(currentCap)) {
          custIdx++;
          currentCustomer = orderedCustomers[custIdx % orderedCustomers.length];
          if (currentCustomer) {
            usedCustomerIdsInExport.add(currentCustomer.customer_id);
            usedCustomerIdsInExport.add(currentCustomer.id);
          }
          currentCap = getRandomCap(currentCustomer);
          currentTotal = D(0);
        }
      }
    }
  }

  const itcHeaders = [
    "Customer ID",
    "Customer Name",
    "Salesman ID",
    "Salesman Name",
    "Beat Code",
    "Beat Name",
    "Category",
    "Product Code",
    "Product Desc",
    "UOM (CFC/PAC/BaseUOM)",
    "Product Order QTY",
    "Order Reference No",
    "Cust Discount %",
  ];

  await db.transaction((t) =>
    auditEvent(t, a, "export", "itc_excel", {
      date: targetDate,
      billsCount: bills.length,
      linesCount: itcRows.length,
    }),
  );

  // Generate .xlsx workbook
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([itcHeaders, ...itcRows]);
  XLSX.utils.book_append_sheet(wb, ws, "ITC_Upload");
  const xlsxBuffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  // Compress .xlsx into a .zip file
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { mkdtemp, rm, readFile, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");

  const exec = promisify(execFile);
  const tempDir = await mkdtemp(join(tmpdir(), "itc-export-"));

  // Format timestamp in Asia/Kolkata timezone: YYYY-MM-DD_HH-mm-ss
  const kolkataNow = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const getPart = (type: string) => kolkataNow.find((p) => p.type === type)?.value ?? "";
  const timeStr = `${getPart("year")}-${getPart("month")}-${getPart("day")}_${getPart("hour")}-${getPart("minute")}-${getPart("second")}`;

  const xlsxFilename = `ITC_Upload_${targetDate}_${timeStr}.xlsx`;
  const zipFilename = `ITC_Upload_${targetDate}_${timeStr}.zip`;
  const xlsxFilePath = join(tempDir, xlsxFilename);
  const zipFilePath = join(tempDir, zipFilename);

  try {
    await writeFile(xlsxFilePath, xlsxBuffer);
    await exec("/usr/bin/zip", ["-j", zipFilePath, xlsxFilePath]);
    const zipData = await readFile(zipFilePath);

    c.header("Content-Type", "application/zip");
    c.header("Content-Disposition", `attachment; filename="${zipFilename}"`);
    return c.body(zipData);
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => { });
  }
});
app.get("/api/v1/itc/bills", async (c) => {
  const a = c.get("actor");
  const targetDate = c.req.query("date") ?? businessDate();

  const bills = await rows(
    db,
    sql`
      select 
        d.id,
        d.number,
        d.business_date,
        d.created_at::text created_at,
        d.amount,
        d.salesman_id,
        s.code salesman_code,
        s.name salesman_name,
        s.itc_id salesman_itc_id,
        s.beat_name beat_name,
        d.data->>'note' note,
        d.customer_id::text customer_id,
        d.data->>'customerName' customer_name,
        d.data->>'customerRef' customer_ref,
        coalesce(cust.is_gst, false) is_gst,
        case 
          when coalesce(cust.is_gst, false) = true then 'GST Bill'
          when d.customer_id is not null then 'Mubashir / Direct'
          else 'Retail'
        end bill_type,
        case 
          when d.kind = 'bill' then exists(
            select 1 from documents ret 
            where ret.org = d.org 
              and ret.kind = 'return' 
              and (
                ret.data->>'billId' = d.id::text 
                or exists(
                  select 1 from bill_lines bl 
                  where bl.org = d.org and bl.document_id = d.id and bl.id = ret.return_line_id
                )
              )
              and not exists(select 1 from documents rev where rev.org = ret.org and rev.reverses = ret.id)
          )
          else false 
        end returned,
        count(l.id)::int as lines_count
      from documents d
      join salesmen s on s.id = d.salesman_id
      left join itc_customers cust on cust.org = d.org and cust.id = d.customer_id
      left join bill_lines l on l.document_id = d.id
      where d.org = ${a.org}
        and d.kind = 'bill'
        and d.business_date = ${targetDate}
        and not exists(select 1 from documents r where r.org = d.org and r.reverses = d.id)
      group by d.id, s.id, cust.is_gst
      order by d.created_at asc
    `,
  );
  return c.json(bills);
});
app.get("/api/v1/itc/customers", async (c) => {
  const a = c.get("actor");
  const salesmanId = c.req.query("salesmanId");
  const customers = await rows(
    db,
    sql`
      select 
        c.id, c.customer_id, c.customer_name,
        coalesce(nullif(c.salesman_itc_id, ''), s.itc_id, '') salesman_itc_id,
        coalesce(nullif(c.salesman_name, ''), s.name, '') salesman_name,
        coalesce(nullif(c.beat_code, ''), s.beat_code, '') beat_code,
        coalesce(nullif(c.beat_name, ''), s.beat_name, '') beat_name,
        c.salesman_id, c.active, coalesce(c.is_gst, false) is_gst
      from itc_customers c
      left join salesmen s on s.id = c.salesman_id
      where c.org = ${a.org}
        and (${salesmanId === undefined || salesmanId === ""} or c.salesman_id = ${salesmanId ?? null})
      order by salesman_itc_id, c.customer_name
    `,
  );
  return c.json(customers);
});
app.post("/api/v1/itc/customers", async (c) => {
  const a = c.get("actor");
  ownerOrManager(a);
  const p = z
    .object({
      customerId: z.string().min(1).max(100),
      customerName: z.string().min(1).max(200),
      salesmanId: id,
      beatCode: z.string().default(""),
      beatName: z.string().default(""),
      isGst: z.boolean().default(false),
    })
    .parse(await c.req.json());

  const [salesman] = await rows<{
    id: string;
    name: string;
    details: { itc_id?: string; itc_name?: string; beat_code?: string; beat_name?: string };
  }>(db, sql`select id, name, details from salesmen where org=${a.org} and id=${p.salesmanId}`);

  ensure(salesman, "Salesman not found", "NOT_FOUND", 404);

  const salesmanItcId = salesman.details?.itc_id || salesman.name;
  const salesmanName = salesman.details?.itc_name || salesman.name;
  const beatCode = p.beatCode || salesman.details?.beat_code || "";
  const beatName = p.beatName || salesman.details?.beat_name || "";

  const [newCust] = await rows(
    db,
    sql`
      insert into itc_customers (org, customer_id, customer_name, salesman_itc_id, salesman_name, beat_code, beat_name, salesman_id, is_gst)
      values (${a.org}, ${p.customerId}, ${p.customerName}, ${salesmanItcId}, ${salesmanName}, ${beatCode}, ${beatName}, ${p.salesmanId}, ${p.isGst})
      returning id, customer_id, customer_name, is_gst
    `,
  );

  return c.json(newCust);
});
app.patch("/api/v1/itc/customers/:id", async (c) => {
  const a = c.get("actor");
  ownerOrManager(a);
  const custId = id.parse(c.req.param("id"));
  const p = z
    .object({
      customerId: z.string().min(1).max(100).optional(),
      customerName: z.string().min(1).max(200).optional(),
      salesmanId: id.optional(),
      beatCode: z.string().optional(),
      beatName: z.string().optional(),
      isGst: z.boolean().optional(),
      active: z.boolean().optional(),
    })
    .parse(await c.req.json());

  const sets: ReturnType<typeof sql>[] = [];
  if (p.customerId !== undefined) sets.push(sql`customer_id = ${p.customerId}`);
  if (p.customerName !== undefined) sets.push(sql`customer_name = ${p.customerName}`);
  if (p.salesmanId !== undefined) {
    sets.push(sql`salesman_id = ${p.salesmanId}`);
    const [s] = await rows<{ name: string; itc_id?: string; details?: { itc_id?: string; itc_name?: string } }>(
      db,
      sql`select name, itc_id, details from salesmen where org=${a.org} and id=${p.salesmanId}`,
    );
    if (s) {
      sets.push(sql`salesman_name = ${s.name}`);
      sets.push(sql`salesman_itc_id = ${s.itc_id || s.details?.itc_id || s.name}`);
    }
  }
  if (p.beatCode !== undefined) sets.push(sql`beat_code = ${p.beatCode}`);
  if (p.beatName !== undefined) sets.push(sql`beat_name = ${p.beatName}`);
  if (p.isGst !== undefined) sets.push(sql`is_gst = ${p.isGst}`);
  if (p.active !== undefined) sets.push(sql`active = ${p.active}`);

  if (sets.length > 0) {
    await db.execute(
      sql`update itc_customers set ${sql.join(sets, sql`, `)} where org=${a.org} and id=${custId}`,
    );
  }
  return c.json({ id: custId, ...p });
});
app.get("/api/v1/direct-cig/summary", async (c) => {
  const a = c.get("actor");
  const salesmanId = c.req.query("salesmanId") ?? "";
  const beat = c.req.query("beat") ?? "";
  const date = c.req.query("date") ?? businessDate();
  const search = (c.req.query("search") ?? "").trim().toLowerCase();

  // Operational customer-level projection: legal trade debtors are salesmen (trade:<salesmanId>).
  // Customer balances are operational subledger projections derived from non-reversed customer-tagged documents, returns, and receipts.
  const customerRows = await rows<{
    id: string;
    customer_id: string;
    customer_name: string;
    salesman_itc_id: string;
    salesman_name: string;
    beat_code: string;
    beat_name: string;
    salesman_id: string | null;
    is_gst: boolean;
    billed: string;
    received: string;
    balance: string;
    last_bill_date: string | null;
    last_receipt_date: string | null;
  }>(
    db,
    sql`
      select 
        c.id,
        c.customer_id,
        c.customer_name,
        c.salesman_itc_id,
        c.salesman_name,
        c.beat_code,
        c.beat_name,
        c.salesman_id,
        coalesce(c.is_gst, false) is_gst,
        coalesce(b.billed, 0)::text billed,
        coalesce(r.received, 0)::text received,
        (coalesce(b.billed, 0) - coalesce(ret.returned, 0) - coalesce(r.received, 0))::text balance,
        b.last_bill_date,
        r.last_receipt_date
      from itc_customers c
      left join (
        select 
          d.customer_id as cust_id,
          sum(d.amount::numeric) billed,
          max(d.business_date::text) last_bill_date
        from documents d
        where d.org = ${a.org}
          and d.kind = 'bill'
          and d.customer_id is not null
          and not exists(select 1 from documents rev where rev.org = d.org and rev.reverses = d.id)
        group by d.customer_id
      ) b on b.cust_id = c.id
      left join (
        select 
          coalesce(d.customer_id, orig.customer_id) as cust_id,
          sum(d.amount::numeric) returned
        from documents d
        left join documents orig on orig.id::text = d.data->>'billId' and orig.org = d.org
        where d.org = ${a.org}
          and d.kind = 'return'
          and coalesce(d.customer_id, orig.customer_id) is not null
          and not exists(select 1 from documents rev where rev.org = d.org and rev.reverses = d.id)
        group by coalesce(d.customer_id, orig.customer_id)
      ) ret on ret.cust_id = c.id
      left join (
        select 
          d.customer_id as cust_id,
          sum(d.amount::numeric) received,
          max(d.business_date::text) last_receipt_date
        from documents d
        where d.org = ${a.org}
          and d.kind in ('receipt', 'identify')
          and d.customer_id is not null
          and not exists(select 1 from documents rev where rev.org = d.org and rev.reverses = d.id)
        group by d.customer_id
      ) r on r.cust_id = c.id
      where c.org = ${a.org}
        and c.active = true
        and (${salesmanId === ""} or c.salesman_id = ${salesmanId || null})
        and (${beat === ""} or c.beat_code = ${beat} or c.beat_name = ${beat})
      order by (coalesce(b.billed, 0) - coalesce(ret.returned, 0) - coalesce(r.received, 0)) desc, c.customer_name
    `,
  );

  const filtered = search
    ? customerRows.filter(
      (r) =>
        r.customer_name.toLowerCase().includes(search) ||
        r.customer_id.toLowerCase().includes(search) ||
        r.beat_name.toLowerCase().includes(search),
    )
    : customerRows;

  // Compute total billed, total received, total outstanding
  let totalBilled = D(0);
  let totalReceived = D(0);
  let totalBalance = D(0);
  const beatsSet = new Map<string, string>();

  for (const r of customerRows) {
    totalBilled = totalBilled.plus(r.billed);
    totalReceived = totalReceived.plus(r.received);
    totalBalance = totalBalance.plus(r.balance);
    if (r.beat_code || r.beat_name) {
      beatsSet.set(r.beat_code, r.beat_name);
    }
  }

  const beats = Array.from(beatsSet.entries()).map(([code, name]) => ({
    code,
    name,
  }));

  // Direct Cig (Mudashir) product quantities and today stats
  const [docStats] = await rows<{
    today_billed: string;
    today_gross_billed: string;
    today_reversed: string;
    today_returned: string;
    today_received: string;
    total_qty: string;
    today_qty: string;
  }>(
    db,
    sql`
      with direct_docs as (
        select d.*
        from documents d
        where d.org = ${a.org}
          and d.customer_id is not null
          and (${salesmanId === ""} or d.salesman_id = ${salesmanId || null})
      ),
      today_bills as (
        select
          coalesce(sum(amount), 0) as gross_billed,
          coalesce(sum(case when exists(select 1 from documents rev where rev.org = d.org and rev.reverses = d.id) then amount else 0 end), 0) as reversed_billed
        from direct_docs d
        where d.kind = 'bill'
          and d.business_date = ${date}::date
      ),
      today_prior_reversals as (
        select coalesce(sum(rev.amount), 0) as prior_reversed
        from documents rev
        join documents orig on orig.id = rev.reverses and orig.org = rev.org
        where rev.org = ${a.org}
          and rev.kind = 'reversal'
          and orig.kind = 'bill'
          and orig.customer_id is not null
          and (${salesmanId === ""} or orig.salesman_id = ${salesmanId || null})
          and rev.business_date = ${date}::date
          and orig.business_date <> ${date}::date
      ),
      today_returns as (
        select
          coalesce(sum(d.amount), 0) as returned_amount,
          coalesce(sum(coalesce((d.data->>'quantity')::numeric, 0)), 0) as returned_qty
        from documents d
        left join documents orig on orig.id::text = d.data->>'billId' and orig.org = d.org
        where d.org = ${a.org}
          and d.kind = 'return'
          and d.business_date = ${date}::date
          and coalesce(d.customer_id, orig.customer_id) is not null
          and (${salesmanId === ""} or coalesce(d.salesman_id, orig.salesman_id) = ${salesmanId || null})
          and not exists(select 1 from documents rev where rev.org = d.org and rev.reverses = d.id)
      )
      select
        (tb.gross_billed - (tb.reversed_billed + tpr.prior_reversed) - tr.returned_amount)::numeric(18,2)::text as today_billed,
        tb.gross_billed::numeric(18,2)::text as today_gross_billed,
        (tb.reversed_billed + tpr.prior_reversed)::numeric(18,2)::text as today_reversed,
        tr.returned_amount::numeric(18,2)::text as today_returned,
        (
          select coalesce(sum(
            case when d.kind in ('receipt', 'identify')
              and coalesce(d.data->>'isHandoverConfirmation', 'false') != 'true'
              and not (d.data ? 'reference' and d.data->>'reference' like 'Cash handover confirmed%')
              and d.business_date = ${date}::date
              and not exists(select 1 from documents rev where rev.org = d.org and rev.reverses = d.id)
            then d.amount else 0 end
          ), 0)::numeric(18,2)::text
          from direct_docs d
        ) as today_received,
        (
          select coalesce(sum(
            case when d.kind = 'bill' and not exists(select 1 from documents rev where rev.org = d.org and rev.reverses = d.id) then
              coalesce((
                select sum((elem->>'quantity')::numeric)
                from jsonb_array_elements(
                  case jsonb_typeof(d.data->'lines')
                    when 'array' then d.data->'lines'
                    else '[]'::jsonb
                  end
                ) as elem
              ), 0)
            else 0 end
          ), 0)::numeric(18,2)::text
          from direct_docs d
        ) as total_qty,
        (
          select (
            coalesce(sum(
              case when d.kind = 'bill' and d.business_date = ${date}::date and not exists(select 1 from documents rev where rev.org = d.org and rev.reverses = d.id) then
                coalesce((
                  select sum((elem->>'quantity')::numeric)
                  from jsonb_array_elements(
                    case jsonb_typeof(d.data->'lines')
                      when 'array' then d.data->'lines'
                      else '[]'::jsonb
                    end
                  ) as elem
                ), 0)
              else 0 end
            ), 0) - tr.returned_qty
          )::numeric(18,2)::text
          from direct_docs d
        ) as today_qty
      from today_bills tb
      cross join today_prior_reversals tpr
      cross join today_returns tr
    `,
  );

  // Calculate cash currently in hand with this salesman:
  // Total cash collected from customers minus total cash handed over & confirmed to manager
  let cashInHand = "0.00";
  let pendingHandoverAmount = "0.00";
  let handoversList: Array<{
    id: string;
    amount: string;
    accepted_amount: string | null;
    date: string;
    status: string;
    salesman_note: string | null;
    manager_note: string | null;
    created_at: string;
    verified_at: string | null;
  }> = [];

  if (salesmanId) {
    const [cashSummary] = await rows<{
      total_cash_collected: string;
      total_cash_confirmed: string;
    }>(
      db,
      sql`
        with collections as (
          select coalesce(sum(
            case when d.reverses is null then d.amount else -d.amount end
          ), 0) as amt
          from documents d
          where d.org = ${a.org}
            and d.salesman_id = ${salesmanId}
            and d.kind = 'receipt'
            and coalesce(d.data->>'method', 'cash') = 'cash'
            and d.data->>'handoverId' is null
            and coalesce(d.data->>'isHandoverConfirmation', 'false') != 'true'
            and not (d.data ? 'reference' and d.data->>'reference' like 'Cash handover confirmed%')
        ),
        confirmed_handovers as (
          select coalesce(sum(coalesce(accepted_amount, amount)), 0) as amt
          from cash_handovers
          where org = ${a.org}
            and salesman_id = ${salesmanId}
            and status = 'confirmed'
        )
        select 
          (select amt::numeric(18,2)::text from collections) as total_cash_collected,
          (select amt::numeric(18,2)::text from confirmed_handovers) as total_cash_confirmed
      `,
    );

    const collected = D(cashSummary?.total_cash_collected ?? "0");
    const confirmed = D(cashSummary?.total_cash_confirmed ?? "0");
    const netInHand = collected.minus(confirmed);
    cashInHand = netInHand.gte(0) ? money(netInHand) : "0.00";
    pendingHandoverAmount = "0.00";

    handoversList = await rows(
      db,
      sql`
        select id, amount, accepted_amount, date::text, status, salesman_note, manager_note, created_at::text, verified_at::text
        from cash_handovers
        where org = ${a.org}
          and salesman_id = ${salesmanId}
        order by created_at desc
        limit 50
      `,
    );
  }

  return c.json({
    customers: filtered,
    stats: {
      totalCustomers: customerRows.length,
      totalBilled: money(totalBilled),
      totalReceived: money(totalReceived),
      totalBalance: money(totalBalance),
      customerDues: money(totalBalance),
      todayBilled: docStats?.today_billed ?? "0.00",
      todayGrossBilled: docStats?.today_gross_billed ?? "0.00",
      todayReversed: docStats?.today_reversed ?? "0.00",
      todayReturned: docStats?.today_returned ?? "0.00",
      todayReceived: docStats?.today_received ?? "0.00",
      totalQty: docStats?.total_qty ?? "0",
      todayQty: docStats?.today_qty ?? "0",
      cashInHand,
      pendingHandoverAmount,
    },
    handovers: handoversList,
    beats,
  });
});

app.get("/api/v1/retail-cig/summary", async (c) => {
  const a = c.get("actor");
  const excludeSalesmanId = c.req.query("excludeSalesmanId") ?? "";
  const date = c.req.query("date") ?? businessDate();

  const [totals] = await rows<{
    total_billed: string;
    total_received: string;
    today_billed: string;
    today_gross_billed: string;
    today_reversed: string;
    today_returned: string;
    today_received: string;
    total_qty: string;
    today_qty: string;
    total_due: string;
    active_salesmen: string;
  }>(
    db,
    sql`
      with filtered_salesmen as (
        select id from salesmen 
        where org = ${a.org}
          and active = true
          and (${excludeSalesmanId === ""} or id != ${excludeSalesmanId || null})
      ),
      salesman_balances as (
        select 
          s.id,
          coalesce(sum(j.debit - j.credit), 0) bal
        from filtered_salesmen s
        left join journal j on j.org = ${a.org} and j.account = 'trade:' || s.id::text
        group by s.id
      ),
      retail_docs as (
        select d.*
        from documents d
        join filtered_salesmen s on s.id = d.salesman_id
        where d.org = ${a.org}
      ),
      today_bills as (
        select
          coalesce(sum(amount), 0) as gross_billed,
          coalesce(sum(case when exists(select 1 from documents rev where rev.org = d.org and rev.reverses = d.id) then amount else 0 end), 0) as reversed_billed
        from retail_docs d
        where d.kind = 'bill'
          and d.business_date = ${date}::date
      ),
      today_prior_reversals as (
        select coalesce(sum(rev.amount), 0) as prior_reversed
        from documents rev
        join documents orig on orig.id = rev.reverses and orig.org = rev.org
        where rev.org = ${a.org}
          and rev.kind = 'reversal'
          and orig.kind = 'bill'
          and orig.salesman_id in (select id from filtered_salesmen)
          and rev.business_date = ${date}::date
          and orig.business_date <> ${date}::date
      ),
      today_returns as (
        select
          coalesce(sum(d.amount), 0) as returned_amount,
          coalesce(sum(coalesce((d.data->>'quantity')::numeric, 0)), 0) as returned_qty
        from retail_docs d
        where d.kind = 'return'
          and d.business_date = ${date}::date
          and not exists(select 1 from documents rev where rev.org = d.org and rev.reverses = d.id)
      ),
      doc_totals as (
        select
          coalesce(sum(case when d.kind = 'bill' and not exists(select 1 from documents rev where rev.org = d.org and rev.reverses = d.id) then d.amount else 0 end), 0) total_billed,
          coalesce(sum(case when d.kind in ('receipt', 'identify') and coalesce(d.data->>'isHandoverConfirmation', 'false') != 'true' and not (d.data ? 'reference' and d.data->>'reference' like 'Cash handover confirmed%') and not exists(select 1 from documents rev where rev.org = d.org and rev.reverses = d.id) then d.amount else 0 end), 0) total_received,
          coalesce(sum(case when d.kind in ('receipt', 'identify') and coalesce(d.data->>'isHandoverConfirmation', 'false') != 'true' and not (d.data ? 'reference' and d.data->>'reference' like 'Cash handover confirmed%') and d.business_date = ${date}::date and not exists(select 1 from documents rev where rev.org = d.org and rev.reverses = d.id) then d.amount else 0 end), 0) today_received,
          coalesce(sum(
            case when d.kind = 'bill' and not exists(select 1 from documents rev where rev.org = d.org and rev.reverses = d.id) then
              coalesce((
                select sum((elem->>'quantity')::numeric)
                from jsonb_array_elements(
                  case jsonb_typeof(d.data->'lines')
                    when 'array' then d.data->'lines'
                    else '[]'::jsonb
                  end
                ) as elem
              ), 0)
            else 0 end
          ), 0) total_qty,
          (
            coalesce(sum(
              case when d.kind = 'bill' and d.business_date = ${date}::date and not exists(select 1 from documents rev where rev.org = d.org and rev.reverses = d.id) then
                coalesce((
                  select sum((elem->>'quantity')::numeric)
                  from jsonb_array_elements(
                    case jsonb_typeof(d.data->'lines')
                      when 'array' then d.data->'lines'
                      else '[]'::jsonb
                    end
                  ) as elem
                ), 0)
              else 0 end
            ), 0) - (select returned_qty from today_returns)
          ) today_qty
        from retail_docs d
      )
      select
        (select count(*)::text from filtered_salesmen) active_salesmen,
        (select total_billed::numeric(18,2)::text from doc_totals) total_billed,
        (select total_received::numeric(18,2)::text from doc_totals) total_received,
        (tb.gross_billed - (tb.reversed_billed + tpr.prior_reversed) - tr.returned_amount)::numeric(18,2)::text today_billed,
        tb.gross_billed::numeric(18,2)::text today_gross_billed,
        (tb.reversed_billed + tpr.prior_reversed)::numeric(18,2)::text today_reversed,
        tr.returned_amount::numeric(18,2)::text today_returned,
        (select today_received::numeric(18,2)::text from doc_totals) today_received,
        (select total_qty::numeric(18,2)::text from doc_totals) total_qty,
        (select today_qty::numeric(18,2)::text from doc_totals) today_qty,
        coalesce((select sum(case when bal > 0 then bal else 0 end) from salesman_balances), 0)::numeric(18,2)::text total_due
      from today_bills tb
      cross join today_prior_reversals tpr
      cross join today_returns tr
    `,
  );

  return c.json({
    activeSalesmen: totals?.active_salesmen ?? "0",
    totalBilled: totals?.total_billed ?? "0.00",
    totalReceived: totals?.total_received ?? "0.00",
    customerDues: totals?.total_due ?? "0.00",
    todayBilled: totals?.today_billed ?? "0.00",
    todayGrossBilled: totals?.today_gross_billed ?? "0.00",
    todayReversed: totals?.today_reversed ?? "0.00",
    todayReturned: totals?.today_returned ?? "0.00",
    todayReceived: totals?.today_received ?? "0.00",
    totalQty: totals?.total_qty ?? "0",
    todayQty: totals?.today_qty ?? "0",
  });
});

app.get("/api/v1/direct-cig/statement/:customerId", async (c) => {
  const a = c.get("actor");
  const custId = c.req.param("customerId");

  const [customer] = await rows<{
    id: string;
    customer_id: string;
    customer_name: string;
    beat_code: string;
    beat_name: string;
    salesman_name: string;
    salesman_id: string;
  }>(
    db,
    sql`select id, customer_id, customer_name, beat_code, beat_name, salesman_name, salesman_id from itc_customers where org=${a.org} and id=${custId}`,
  );

  ensure(customer, "Customer not found", "NOT_FOUND", 404);

  const docs = await rows<{
    id: string;
    number: string;
    kind: string;
    business_date: string;
    amount: string;
    data: Record<string, unknown>;
    created_at: string;
  }>(
    db,
    sql`
      select 
        d.id, 
        d.number, 
        d.kind, 
        d.business_date::text, 
        d.amount::text, 
        d.data, 
        d.created_at::text
      from documents d
      left join documents orig on orig.id::text = d.data->>'billId' and orig.org = d.org
      where d.org=${a.org}
        and coalesce(d.customer_id, orig.customer_id) = ${custId}::uuid
        and d.kind in ('bill', 'receipt', 'return')
        and not exists(select 1 from documents rev where rev.org = ${a.org} and rev.reverses = d.id)
      order by d.business_date asc, d.created_at asc
    `,
  );

  let runningBalance = D(0);
  const ledger = docs.map((d) => {
    const isBill = d.kind === "bill";
    const debit = isBill ? d.amount : "0.00";
    const credit = !isBill ? d.amount : "0.00";
    if (isBill) runningBalance = runningBalance.plus(d.amount);
    else runningBalance = runningBalance.minus(d.amount);
    return {
      id: d.id,
      number: d.number,
      kind: d.kind,
      date: d.business_date,
      created_at: d.created_at,
      debit,
      credit,
      balance: money(runningBalance),
      note: String(d.data?.note ?? ""),
      details: d.data,
    };
  });

  return c.json({
    customer,
    ledger,
    currentBalance: money(runningBalance),
  });
});

app.delete("/api/v1/itc/customers/:id", async (c) => {
  const a = c.get("actor");
  owner(a);
  const custId = id.parse(c.req.param("id"));
  await db.execute(
    sql`delete from itc_customers where org=${a.org} and id=${custId}`,
  );
  return c.json({ id: custId });
});
app.get("/api/v1/bill-lines", async (c) => {
  const a = c.get("actor"),
    search = (c.req.query("search") ?? "").slice(0, 200);
  return c.json(
    await rows(
      db,
      sql`select l.id,d.number||' · '||(l.snapshot->>'name') label,l.quantity,l.amount from bill_lines l join documents d on d.id=l.document_id where l.org=${a.org} and (${search}='' or d.number ilike ${"%" + search + "%"} or l.snapshot->>'name' ilike ${"%" + search + "%"} or l.snapshot->>'code' ilike ${"%" + search + "%"} or d.data->>'paperReference' ilike ${"%" + search + "%"}) and not exists(select 1 from documents r where r.org=d.org and r.reverses=d.id) order by d.created_at desc limit 200`,
    ),
  );
});
app.post("/api/v1/preview/bill", async (c) =>
  db.transaction(async (t) => {
    await t.execute(
      sql`set transaction isolation level repeatable read read only`,
    );
    const a = c.get("actor"),
      p = commands.bill.parse(await c.req.json());
    const { billLinePricing, billPricingNeedsApproval } =
      await import("./money");
    const [salesman] = await rows<{
      credit_limit: string | null;
      active: boolean;
    }>(
      t,
      sql`select credit_limit,active from salesmen where org=${a.org} and id=${p.salesmanId}`,
    );
    ensure(
      salesman?.active,
      "Select an active salesman in this business",
      "NOT_FOUND",
      404,
    );
    let total = D(0);
    const lines = [];
    for (const l of p.lines) {
      const [config] = await rows<{
        id: string;
        conversion: string;
        basis: string;
        rate: string;
        fractional: boolean;
        confirmed: boolean;
        active: boolean;
        unit: string;
        base_unit: string;
      }>(
        t,
        sql`select c.*,p.active from products p join product_configurations c on c.product_id=p.id and c.org=p.org where p.org=${a.org} and p.id=${l.productId} and c.effective_date<=${p.date} order by c.effective_date desc,c.created_at desc limit 1`,
      );
      ensure(
        config?.confirmed && config.active,
        "Confirm product units and pricing first",
      );
      const pricing = billLinePricing(l, config);
      total = total.plus(pricing.amount);
      lines.push({
        ...l,
        amount: pricing.amount,
        gross: pricing.gross,
        discountAmount: pricing.discount,
        effectiveRate: pricing.rate,
        effectiveBasis: pricing.basis,
        unit: config.unit,
        baseUnit: config.base_unit,
        configurationId: config.id,
      });
    }
    const subtotal = total;
    const rawDiscount = p.discount ? D(p.discount) : D(0);
    ensure(!rawDiscount.isNegative(), "Bill discount cannot be negative");
    ensure(
      total.gt(rawDiscount),
      "Bill discount cannot be greater than or equal to the total bill amount",
    );
    total = total.minus(rawDiscount);
    const previous = await balance(t, a.org, "trade:" + p.salesmanId, p.date),
      confirmed = p.receipts
        .filter((r) => r.method === "cash" || r.verified)
        .reduce((s, r) => s.plus(r.amount), D(0)),
      pending = p.receipts
        .filter((r) => r.method === "online" && !r.verified)
        .reduce((s, r) => s.plus(r.amount), D(0));
    return c.json({
      quoteHash: quoteFingerprint(
        p.date,
        p.salesmanId,
        previous,
        money(total),
        salesman.credit_limit,
        lines,
        p.receipts,
        p.discount ? money(p.discount) : "0.00",
      ),
      needsOwnerApproval:
        billPricingNeedsApproval(a, p.lines) ||
        (salesman.credit_limit !== null &&
          D(previous).plus(total).minus(confirmed).gt(salesman.credit_limit)),
      lines,
      subtotal: money(subtotal),
      discount: p.discount ? money(p.discount) : "0.00",
      total: money(total),
      previous,
      confirmed: money(confirmed),
      pending: money(pending),
      projected: money(D(previous).plus(total).minus(confirmed)),
    });
  }),
);
app.post("/api/v1/requests/:id/approve", async (c) => {
  const a = c.get("actor");
  owner(a);
  const requestId = id.parse(c.req.param("id"));
  const [r] = await rows<{
    payload: { command: keyof typeof commands; payload: unknown };
    state: string;
  }>(
    db,
    sql`select payload,state from requests where org=${a.org} and id=${requestId}`,
  );
  ensure(r, "Request not found", "NOT_FOUND", 404);
  const result = await command(
    a,
    r.payload.command,
    r.payload.payload,
    "approval-" + requestId,
    { requestId },
  );
  return c.json(result);
});
app.get("/api/v1/reports/:name", async (c) => {
  const a = c.get("actor"),
    name = z
      .enum([
        "transactions",
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
        "manager_cash",
      ])
      .parse(c.req.param("name")),
    from = dateSchema.parse(
      c.req.query("from") ?? businessDate().slice(0, 7) + "-01",
    ),
    to = dateSchema.parse(c.req.query("to") ?? businessDate()),
    offset = page(c.req.query("offset")),
    limit = z.coerce
      .number()
      .int()
      .min(1)
      .max(50000)
      .default(5000)
      .parse(c.req.query("limit") ?? "5000"),
    accountId = z.string().uuid().optional().safeParse(c.req.query("accountId")).data;
  ensure(from <= to, "From must be before to");
  let result: Record<string, unknown>[];
  switch (name) {
    case "transactions":
      result = await rows(
        db,
        sql`select 
          d.id,
          d.number as "no",
          d.business_date::text as "date",
          d.created_at::text as "created_at",
          case 
            when d.kind = 'bill' then 'bill'
            when d.kind = 'receipt' and (coalesce(d.data->>'isHandoverConfirmation', 'false') = 'true' or (d.data ? 'reference' and d.data->>'reference' like 'Cash handover confirmed%')) then 'cash_handover'
            when d.kind = 'receipt' and coalesce(d.data->>'method', 'cash') = 'online' then 'receipt_online'
            when d.kind = 'receipt' then 'receipt_cash'
            when d.kind = 'identify' then 'receipt_online'
            when d.kind = 'foods_receipt' then 'foods_receipt'
            when d.kind = 'expense' then 'expense'
            when d.kind = 'salary' then 'salary'
            when d.kind = 'employee_receipt' then 'employee_receipt'
            when d.kind = 'deposit' then 'bank_deposit'
            when d.kind = 'transfer' then 'cash_transfer'
            when d.kind = 'loan' then coalesce(d.data->>'direction', 'loan')
            when d.kind = 'return' then 'sales_return'
            else d.kind
          end as "type",
          case 
            when d.kind = 'bill' then coalesce(s.name, '—')
            when d.kind in ('receipt', 'identify') and (coalesce(d.data->>'isHandoverConfirmation', 'false') = 'true' or (d.data ? 'reference' and d.data->>'reference' like 'Cash handover confirmed%')) then coalesce(s.name, d.data->>'salesmanName', 'Salesman') || ' (Cash Handover)'
            when d.kind in ('receipt', 'identify') then coalesce(s.name, '—')
            when d.kind = 'foods_receipt' then coalesce(d.data->>'foodsSalesman', 'Foods')
            when d.kind = 'salary' then coalesce(d.data->>'payee', d.data->>'employeeName', 'Staff')
            when d.kind = 'employee_receipt' then coalesce(d.data->>'employeeName', d.data->>'payee', 'Staff')
            when d.kind = 'expense' then coalesce(d.data->>'category', 'Operating expense')
            when d.kind = 'deposit' then '—'
            when d.kind = 'transfer' then '—'
            when d.kind = 'loan' then coalesce(d.data->>'counterparty', '—')
            when d.kind = 'return' then coalesce(s.name, '—')
            else coalesce(s.name, d.data->>'category', d.data->>'payee', '—')
          end as "category",
          (case when d.reverses is null then d.amount else -d.amount end)::numeric(18,2)::text as "amount",
          case 
            when d.kind<>'bill' then null 
            when coalesce(ap.applied,0)>=d.amount then 'Settled' 
            when coalesce(ap.applied,0)>0 then 'Part-paid / credited' 
            else 'Unpaid' 
          end settlement,
          exists(select 1 from documents r where r.org=d.org and r.reverses=d.id) reversed,
          case 
            when d.kind = 'bill' then exists(
              select 1 from documents ret 
              where ret.org = d.org 
                and ret.kind = 'return' 
                and (
                  ret.data->>'billId' = d.id::text 
                  or exists(
                    select 1 from bill_lines bl 
                    where bl.org = d.org and bl.document_id = d.id and bl.id = ret.return_line_id
                  )
                )
                and not exists(select 1 from documents rev where rev.org = ret.org and rev.reverses = ret.id)
            )
            else false 
          end returned,
          coalesce(
            d.data->>'note',
            d.data->>'notes',
            d.data->>'remarks',
            d.data->>'reference',
            d.data->>'paperReference',
            d.data->>'reason'
          ) as "note"
        from documents d
        left join salesmen s on s.id = d.salesman_id and s.org = d.org
        left join lateral (
          select sum(x.amount) applied 
          from allocations x 
          join allocation_heads h on h.salesman_id=x.salesman_id and h.generation=x.generation 
          where x.org=d.org and x.charge_id=d.id
        ) ap on true 
        where d.org = ${a.org}
          and d.business_date between ${from} and ${to}
        order by d.business_date desc, d.created_at desc
        limit ${limit} offset ${offset}`,
      );
      break;
    case "outstanding":
      result = await rows(
        db,
        sql`select s.id,s.code,s.name,coalesce(sum(j.debit-j.credit) filter(where d.business_date<=${to}::date),0)::numeric(18,2)::text signed_balance,greatest(coalesce(sum(j.debit-j.credit) filter(where d.business_date<=${to}::date),0),0)::numeric(18,2)::text due,greatest(-coalesce(sum(j.debit-j.credit) filter(where d.business_date<=${to}::date),0),0)::numeric(18,2)::text advance from salesmen s left join journal j on j.org=s.org and j.account='trade:'||s.id::text left join documents d on d.id=j.document_id where s.org=${a.org} group by s.id order by s.code limit 100 offset ${offset}`,
      );
      break;
    case "products":
      result = await rows(
        db,
        sql`with movements as (select d.id source_id,d.kind,d.data,d.return_line_id,1::numeric sign from documents d where d.org=${a.org} and d.kind in ('bill','return') and d.business_date between ${from} and ${to} union all select o.id,o.kind,o.data,o.return_line_id,-1::numeric from documents r join lateral(select id,kind,data,return_line_id from documents x where x.id=r.reverses and x.kind in ('bill','return') limit 1)o on true where r.org=${a.org} and r.reverses is not null and r.business_date between ${from} and ${to}), effective as (select l.product_id,l.snapshot,l.quantity*m.sign billed,0::numeric returned from movements m join bill_lines l on l.document_id=m.source_id and l.org=${a.org} where m.kind='bill' union all select l.product_id,l.snapshot,0::numeric,(m.data->>'quantity')::numeric*m.sign from movements m join bill_lines l on l.id=m.return_line_id and l.org=${a.org} where m.kind='return') select product_id,snapshot->>'name' product,snapshot->>'unit' unit,snapshot->>'conversion' conversion,snapshot->>'basis' basis,snapshot->>'rate' rate,sum(billed)::text billed_quantity,sum(returned)::text returned_quantity from effective group by product_id,snapshot->>'name',snapshot->>'unit',snapshot->>'conversion',snapshot->>'basis',snapshot->>'rate' order by product limit 100 offset ${offset}`,
      );
      break;
    case "collections":
      result = await rows(
        db,
        sql`select d.id,d.number,d.business_date::text date,d.created_at::text created_at,s.name salesman_name,coalesce(o.kind,d.kind) type,coalesce(o.data->>'method',d.data->>'method',case when coalesce(o.kind,d.kind)='identify' then 'identified bank credit' end) method,case when d.reverses is null then d.amount else -d.amount end::numeric(18,2)::text amount,d.salesman_id,coalesce(o.data->>'accountId',d.data->>'accountId') account_id from documents d left join documents o on o.id=d.reverses and o.org=d.org left join salesmen s on s.id=d.salesman_id and s.org=d.org where d.org=${a.org} and coalesce(o.kind,d.kind) in ('receipt','identify','refund') and coalesce(d.data->>'isHandoverConfirmation', o.data->>'isHandoverConfirmation', 'false') != 'true' and not (coalesce(d.data->>'reference', o.data->>'reference', '') like 'Cash handover confirmed%') and d.business_date between ${from} and ${to} order by d.business_date,d.created_at limit 100 offset ${offset}`,
      );
      break;
    case "expenses":
      result = await rows(
        db,
        sql`select substring(j.account from 9) category,sum(j.debit-j.credit)::numeric(18,2)::text expense from journal j join documents d on d.id=j.document_id where j.org=${a.org} and j.account like 'expense:%' and d.business_date between ${from} and ${to} group by j.account order by j.account limit 100 offset ${offset}`,
      );
      break;
    case "loans":
      result = await rows(
        db,
        sql`select d.id,d.number,d.data->>'direction' direction,d.data->>'counterparty' counterparty,d.business_date::text date,d.created_at::text created_at,d.amount principal,coalesce(sum(j.debit-j.credit) filter(where x.business_date<=${to}::date),0)::numeric(18,2)::text signed_outstanding from documents d left join journal j on j.org=d.org and j.account=d.data->>'target' left join documents x on x.id=j.document_id where d.org=${a.org} and d.kind='loan' and d.business_date<=${to}::date group by d.id order by d.created_at desc limit 100 offset ${offset}`,
      );
      break;
    case "deposits":
      result = await rows(
        db,
        sql`select d.id,d.number,d.business_date::text date,d.created_at::text created_at,d.amount handed_over,coalesce(sum(j.credit-j.debit) filter(where coalesce(o.kind,x.kind)='deposit_credit' and x.business_date<=${to}::date),0)::numeric(18,2)::text credited,coalesce(sum(j.credit-j.debit) filter(where coalesce(o.kind,x.kind)='deposit_return' and x.business_date<=${to}::date),0)::numeric(18,2)::text returned,coalesce(sum(j.debit-j.credit) filter(where x.business_date<=${to}::date),0)::numeric(18,2)::text in_transit from documents d left join journal j on j.org=d.org and j.account='transit:'||(d.data->>'transitId') left join documents x on x.id=j.document_id left join documents o on o.id=x.reverses where d.org=${a.org} and d.kind='deposit' and d.business_date<=${to}::date group by d.id order by d.created_at desc limit 100 offset ${offset}`,
      );
      break;
    case "closes":
      result = await rows(
        db,
        sql`select c.id,c.date::text,c.created_at::text created_at,m.name account,c.expected,c.counted,c.difference,c.reason,c.state from closes c join money_accounts m on m.id=c.account_id and m.org=c.org where c.org=${a.org} and c.date between ${from} and ${to} order by c.date desc,c.created_at desc limit 100 offset ${offset}`,
      );
      break;
    case "reconciliation":
      result = await rows(
        db,
        sql`select r.id,r.date::text,r.created_at::text created_at,m.name account,r.statement,r.book,r.state,(r.statement-r.book)::numeric(18,2)::text difference,r.matches from reconciliations r join money_accounts m on m.id=r.account_id and m.org=r.org where r.org=${a.org} and r.date between ${from} and ${to} order by r.date desc,r.created_at desc limit 100 offset ${offset}`,
      );
      break;
    case "claims":
      result = await rows(
        db,
        sql`select p.id,s.name salesman,p.actual_date::text reported_date,p.created_at::text created_at,p.amount,p.reference,p.state,p.reason from receipt_claims p join salesmen s on s.id=p.salesman_id and s.org=p.org where p.org=${a.org} and p.actual_date between ${from} and ${to} order by p.created_at desc limit 100 offset ${offset}`,
      );
      break;
    case "ageing":
      ensure(
        to === businessDate(),
        "Ageing allocation view currently supports today only; historic statement balances remain available",
      );
      result = await rows(
        db,
        sql`with applied as(select x.charge_id,sum(x.amount) amount from allocations x join allocation_heads h on h.salesman_id=x.salesman_id and h.generation=x.generation where x.org=${a.org} group by x.charge_id) select d.id,d.number,case when d.data->>'customerName' is not null and trim(d.data->>'customerName') != '' then s.name || ' / ' || (d.data->>'customerName') else s.name end salesman,d.business_date::text date,d.created_at::text created_at,case when d.kind='opening' then 'Unknown before cutover' else (${to}::date-d.business_date)::text||' days' end age,(d.amount-coalesce(applied.amount,0))::numeric(18,2)::text remaining from documents d join salesmen s on s.id=d.salesman_id and s.org=d.org left join applied on applied.charge_id=d.id where d.org=${a.org} and d.kind in ('bill','opening') and d.business_date<=${to}::date and exists(select 1 from journal j where j.document_id=d.id and j.account='trade:'||s.id::text and j.debit>0) and d.amount>coalesce(applied.amount,0) and not exists(select 1 from documents r where r.reverses=d.id) order by d.business_date,d.created_at limit 100 offset ${offset}`,
      );
      break;
    case "manager_cash":
      result = await rows(
        db,
        sql`select 
          d.id,
          d.number as "no",
          d.business_date::text as "date",
          d.created_at::text as "created_at",
          m.name as "account",
          case 
            when j.debit > 0 then 'IN'
            else 'OUT'
          end as "direction",
          case 
            when d.kind = 'receipt' and (coalesce(d.data->>'isHandoverConfirmation', 'false') = 'true' or (d.data ? 'reference' and d.data->>'reference' like 'Cash handover confirmed%')) then 'cash_handover'
            when d.kind = 'receipt' and coalesce(d.data->>'method', 'cash') = 'online' then 'receipt_online'
            when d.kind = 'receipt' then 'receipt_cash'
            when d.kind = 'identify' then 'receipt_online'
            when d.kind = 'foods_receipt' then 'foods_receipt'
            when d.kind = 'employee_receipt' then 'employee_receipt'
            when d.kind = 'deposit' then 'bank_deposit'
            when d.kind = 'transfer' then 'cash_transfer'
            when d.kind = 'expense' then 'expense'
            when d.kind = 'salary' then 'salary'
            when d.kind = 'loan' then coalesce(d.data->>'direction', 'loan')
            when d.kind = 'return' then 'sales_return'
            when d.kind = 'refund' then 'salesman_refund'
            when d.kind = 'owner' then coalesce(d.data->>'classification', 'owner')
            when d.kind = 'reversal' then 'reversal'
            else d.kind
          end as "type",
          case 
            when d.kind in ('receipt', 'identify') and (coalesce(d.data->>'isHandoverConfirmation', 'false') = 'true' or (d.data ? 'reference' and d.data->>'reference' like 'Cash handover confirmed%')) then coalesce(s.name, d.data->>'salesmanName', 'Salesman') || ' (Cash Handover)'
            when d.kind in ('receipt', 'identify') then coalesce(s.name, d.data->>'salesmanName', '—')
            when d.kind = 'foods_receipt' then coalesce(d.data->>'foodsSalesman', 'Foods')
            when d.kind = 'employee_receipt' then coalesce(d.data->>'employeeName', d.data->>'payee', 'Staff')
            when d.kind = 'expense' then coalesce(d.data->>'category', d.data->>'payee', 'Operating expense')
            when d.kind = 'salary' then coalesce(d.data->>'payee', d.data->>'employeeName', 'Staff')
            when d.kind = 'deposit' then coalesce(dest_m.name, 'Bank deposit')
            when d.kind = 'transfer' and j.debit > 0 then coalesce(src_m.name, 'Other cash/bank')
            when d.kind = 'transfer' and j.credit > 0 then coalesce(dest_m.name, 'Other cash/bank')
            when d.kind = 'loan' then coalesce(d.data->>'counterparty', '—')
            when d.kind = 'refund' then coalesce(s.name, 'Salesman')
            when d.kind = 'owner' then 'Owner'
            when d.kind = 'reversal' then coalesce(s.name, 'Reversal')
            else coalesce(s.name, d.data->>'category', d.data->>'payee', '—')
          end as "party_or_category",
          j.debit::numeric(18,2)::text as "inflow",
          j.credit::numeric(18,2)::text as "outflow",
          coalesce(d.data->>'reference', d.data->>'note', d.data->>'managerNote', '—') as "note"
        from journal j
        join documents d on d.id = j.document_id
        join money_accounts m on j.account = 'money:' || m.id::text and m.org = j.org
        left join salesmen s on s.id = d.salesman_id and s.org = d.org
        left join money_accounts src_m on src_m.id::text = (d.data->>'sourceId') and src_m.org = d.org
        left join money_accounts dest_m on dest_m.id::text = (d.data->>'destinationId') and dest_m.org = d.org
        where j.org = ${a.org}
          and (${accountId ? sql`m.id = ${accountId}` : sql`(m.name = 'Demo manager cash' or m.type = 'cash')`})
          and (j.debit > 0 or j.credit > 0)
          and d.business_date between ${from} and ${to}
        order by d.business_date desc, d.created_at desc
        limit 100 offset ${offset}`,
      );
      break;
  }
  if (c.req.query("format") === "csv") {
    await db.transaction((t) =>
      auditEvent(t, a, "export", name, {
        from,
        to,
        offset,
        count: result.length,
      }),
    );
    const fields = result.length ? Object.keys(result[0]) : ["No records"];
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header(
      "Content-Disposition",
      `attachment; filename="${name}-${from}-${to}.csv"`,
    );
    return c.body(
      "\uFEFF" +
      [
        fields,
        ...result.map((r) =>
          fields.map((f) =>
            typeof r[f] === "object" ? JSON.stringify(r[f]) : r[f],
          ),
        ),
      ]
        .map((r) => r.map(csvCell).join(","))
        .join("\r\n"),
    );
  }
  return c.json({ name, from, to, offset, rows: result, limit: 100 });
});
app.get("/api/v1/books/:id", async (c) =>
  db.transaction(async (t) => {
    await t.execute(
      sql`set transaction isolation level repeatable read read only`,
    );
    const a = c.get("actor"),
      accountId = id.parse(c.req.param("id")),
      from = dateSchema.parse(c.req.query("from") ?? businessDate()),
      to = dateSchema.parse(c.req.query("to") ?? businessDate()),
      offset = page(c.req.query("offset"));
    const [m] = await rows(
      t,
      sql`select * from money_accounts where org=${a.org} and id=${accountId}`,
    );
    ensure(m, "Account not found", "NOT_FOUND", 404);
    ensure(from <= to, "Invalid date range");
    const [opening] = await rows<{ amount: string }>(
      t,
      sql`select coalesce(sum(j.debit-j.credit),0)::numeric(18,2)::text amount from journal j join documents d on d.id=j.document_id where j.org=${a.org} and j.account=${"money:" + accountId} and d.business_date<${from}`,
    );
    const entries = await rows(
      t,
      sql`with grouped as(select d.id,d.number,d.kind,d.business_date::text date,d.created_at,sum(j.debit) inflow,sum(j.credit) outflow from documents d join journal j on j.document_id=d.id where j.org=${a.org} and j.account=${"money:" + accountId} and d.business_date between ${from} and ${to} group by d.id) select id,number,kind,date,created_at::text created_at,inflow::numeric(18,2)::text,outflow::numeric(18,2)::text,(${opening.amount}::numeric+sum(inflow-outflow) over(order by date,created_at,id))::numeric(18,2)::text balance from grouped order by date,created_at,id limit 100 offset ${offset}`,
    );
    return c.json({
      account: m,
      from,
      to,
      opening: opening.amount,
      ending: await balance(t, a.org, "money:" + accountId, to),
      entries,
    });
  }),
);
const liveChecks = z
  .object({
    identities: z.boolean(),
    unitsAndPrices: z.boolean(),
    openingBalances: z.boolean(),
    cashAndBankAccounts: z.boolean(),
    permissions: z.boolean(),
    printTrial: z.boolean(),
    accountantReview: z.boolean(),
    parallelTrial: z.boolean(),
    restoreDrill: z.boolean(),
    independentDeveloperReview: z.boolean(),
    hostingAndOffServerBackups: z.boolean(),
  })
  .strict();
app.patch("/api/v1/business", async (c) => {
  const a = c.get("actor");
  owner(a);
  const p = z
    .object({
      name: z.string().min(1).max(200),
      legalName: z.string().max(200).default(""),
      address: z.string().max(1000).default(""),
      contact: z.string().max(200).default(""),
      footer: z.string().max(1000).default(""),
      currency: z.literal("INR"),
      timezone: z.literal("Asia/Kolkata"),
      documentPrefix: z
        .string()
        .max(20)
        .regex(/^[A-Z0-9-]*$/)
        .default(""),
      documentStart: z
        .string()
        .regex(/^[1-9]\d{0,11}$/)
        .default("1"),
      readiness: liveChecks,
    })
    .strict()
    .parse(await c.req.json());
  await db.transaction(async (t) => {
    await lock(t, a.org);
    const [existing] = await rows<{
      setup: {
        documentBase?: string;
        documentPrefix?: string;
        documentStart?: string;
      };
    }>(t, sql`select setup from organizations where id=${a.org}`);
    if (existing.setup.documentBase) {
      ensure(
        p.documentPrefix === (existing.setup.documentPrefix ?? "") &&
        p.documentStart === (existing.setup.documentStart ?? "1"),
        "Document series is locked after first posting. Preserve issued numbers.",
      );
    }
    await t.execute(
      sql`update organizations set name=${p.name},setup=setup||${JSON.stringify({ ...p, liveApproved: false })}::jsonb where id=${a.org}`,
    );
    await auditEvent(t, a, "business_setup", a.org, p);
  });
  return c.json({ id: a.org });
});
app.post("/api/v1/business/approve-live", async (c) => {
  const a = c.get("actor");
  owner(a);
  await db.transaction(async (t) => {
    await lock(t, a.org);
    const [o] = await rows<{ mode: string; setup: { readiness: unknown } }>(
      t,
      sql`select mode,setup from organizations where id=${a.org}`,
    );
    ensure(
      o.mode === "live",
      "Demo and test organizations cannot be converted into live organizations",
    );
    const checks = liveChecks.parse(o.setup.readiness);
    ensure(
      Object.values(checks).every(Boolean),
      "Complete and independently review all live prerequisites",
    );
    const [count] = await rows<{ n: string }>(
      t,
      sql`select count(*)::text n from money_accounts where org=${a.org} and active and type='cash'`,
    );
    ensure(count.n !== "0", "Configure physical cash custody");
    const invalid = await rows(
      t,
      sql`select p.id from products p left join lateral(select confirmed from product_configurations x where x.org=p.org and x.product_id=p.id and x.effective_date<=${businessDate()} order by x.effective_date desc,x.created_at desc limit 1)c on true where p.org=${a.org} and p.active and c.confirmed is distinct from true`,
    );
    ensure(
      !invalid.length,
      "Confirm each active product unit, conversion and rate",
    );
    await t.execute(
      sql`update organizations set setup=jsonb_set(setup,'{liveApproved}','true') where id=${a.org}`,
    );
    await auditEvent(t, a, "live_setup_approval", a.org, { checks });
  });
  return c.json({ id: a.org, state: "approved" });
});
app.get("/api/v1/members", async (c) => {
  const a = c.get("actor");
  owner(a);
  return c.json(
    await rows(
      db,
      sql`select m.id,m.user_id,m.role,m.active,m.capabilities,u.name,u.email from members m join "user" u on u.id=m.user_id where m.org=${a.org} order by m.role,u.name`,
    ),
  );
});
app.post("/api/v1/members", async (c) => {
  const a = c.get("actor");
  owner(a);
  const p = z
    .object({
      name: z.string().min(1).max(200),
      email: z.email(),
      password: z.string().min(12).max(128),
      role: z.enum(["owner", "manager"]),
    })
    .strict()
    .parse(await c.req.json());
  const created = await auth.api.signUpEmail({
    body: { email: p.email, password: p.password, name: p.name },
  });
  await db.transaction(async (t) => {
    await lock(t, a.org);
    await t.execute(
      sql`insert into members(org,user_id,role) values(${a.org},${created.user.id},${p.role})`,
    );
    await auditEvent(t, a, "member_created", created.user.id, {
      email: p.email,
      role: p.role,
    });
  });
  return c.json({ id: created.user.id }, 201);
});
app.post("/api/v1/members/:id/reset-password", async (c) => {
  const a = c.get("actor");
  owner(a);
  const userId = c.req.param("id"),
    p = z
      .object({
        password: z.string().min(12).max(128),
        reason: z.string().min(3).max(1000),
      })
      .strict()
      .parse(await c.req.json());
  const { hashPassword } = await import("better-auth/crypto");
  const hash = await hashPassword(p.password);
  await db.transaction(async (t) => {
    await lock(t, a.org);
    const [member] = await rows(
      t,
      sql`select id from members where org=${a.org} and user_id=${userId}`,
    );
    ensure(member, "Member not found", "NOT_FOUND", 404);
    await t.execute(
      sql`update account set password=${hash} where "userId"=${userId} and "providerId"='credential'`,
    );
    await t.execute(sql`delete from session where "userId"=${userId}`);
    await auditEvent(t, a, "password_reset", userId, { reason: p.reason });
  });
  return c.json({ id: userId, sessionsRevoked: true });
});
app.get("/api/v1/portability-export", async (c) => {
  const a = c.get("actor");
  owner(a);
  const data: Record<string, unknown> = {
    currency: "INR",
    timezone: "Asia/Kolkata",
    exportedAt: new Date().toISOString(),
  };
  for (const table of [
    "organizations",
    "salesmen",
    "products",
    "product_configurations",
    "money_accounts",
    "documents",
    "bill_lines",
    "journal",
    "receipt_claims",
    "bank_identities",
    "allocations",
    "allocation_heads",
    "audit",
    "closes",
    "periods",
    "reconciliations",
    "requests",
  ]) {
    data[table] = await rows(
      db,
      table === "organizations"
        ? sql`select * from organizations where id=${a.org}`
        : sql`select * from ${sql.identifier(table)} where org=${a.org}`,
    );
  }
  data.members = await rows(
    db,
    sql`select m.user_id,m.role,m.active,m.capabilities,u.name,u.email from members m join "user" u on u.id=m.user_id where m.org=${a.org}`,
  );
  data.attachments = await rows(
    db,
    sql`select id,document_id,mime,size,hash,created_at from attachments where org=${a.org}`,
  );
  await db.transaction((t) =>
    auditEvent(t, a, "portability_export", a.org, {}),
  );
  c.header("Cache-Control", "no-store");
  c.header(
    "Content-Disposition",
    'attachment; filename="business-records.json"',
  );
  return c.json(data);
});
app.post("/api/v1/opening-import/preview", async (c) => {
  const a = c.get("actor");
  owner(a);
  const p = commands.openingBatch.parse(await c.req.json());
  const errors: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const r of p.rows) {
    if (seen.has(r.rowId))
      errors.push({ rowId: r.rowId, message: "Duplicate batch row ID" });
    seen.add(r.rowId);
    if (D(r.amount).isZero())
      errors.push({
        rowId: r.rowId,
        message:
          "Zero opening needs no financial posting; record its approval in setup notes",
      });
    if (r.legacyMode === "items")
      errors.push({
        rowId: r.rowId,
        message:
          "Legacy invoice detail import is not enabled; use approved total mode with unknown legacy age",
      });
    if (r.target === "trade" || r.target === "money") {
      const table = r.target === "trade" ? "salesmen" : "money_accounts";
      const [target] = await rows(
        db,
        sql`select id from ${sql.identifier(table)} where org=${a.org} and id=${r.targetId}`,
      );
      if (!target)
        errors.push({
          rowId: r.rowId,
          message: "Target is not in this business",
        });
    }
    const [existing] = await rows(
      db,
      sql`select id from documents where org=${a.org} and (data->>'targetId'=${r.targetId} or (data->>'batchId'=${p.batchId} and data->>'rowId'=${r.rowId})) and kind in ('opening','loan')`,
    );
    if (existing)
      errors.push({
        rowId: r.rowId,
        message:
          "Existing opening detected. Exact same batch/row retry is safe; changed rows require correction.",
      });
  }
  return c.json({
    id: p.batchId,
    rows: p.rows,
    errors,
    dryRun: true,
    canFinalize: errors.length === 0,
  });
});
app.patch("/api/v1/salesmen/:id", async (c) => {
  const a = c.get("actor");
  owner(a);
  const salesmanId = id.parse(c.req.param("id"));
  const p = salesmanSchema
    .pick({ name: true, creditLimit: true, details: true, active: true })
    .parse(await c.req.json());
  await db.transaction(async (t) => {
    await lock(t, a.org);
    const [before] = await rows(
      t,
      sql`select * from salesmen where org=${a.org} and id=${salesmanId}`,
    );
    ensure(before, "Salesman not found", "NOT_FOUND", 404);
    await t.execute(
      sql`update salesmen set name=${p.name},active=${p.active},credit_limit=${p.creditLimit},details=${JSON.stringify(p.details)}::jsonb where org=${a.org} and id=${salesmanId}`,
    );
    // Cascade to typed columns on salesmen
    await t.execute(
      sql`update salesmen set
        itc_id = ${(p.details as Record<string, string>)?.itc_id ?? null},
        beat_code = ${(p.details as Record<string, string>)?.beat_code ?? null},
        beat_name = ${(p.details as Record<string, string>)?.beat_name ?? null},
        route = ${(p.details as Record<string, string>)?.route ?? null}
        where org=${a.org} and id=${salesmanId}`,
    );
    // Cascade salesman name/itc changes to itc_customers (only cascade beat if non-empty and not wholesale)
    const newBeatCode = ((p.details as Record<string, string>)?.beat_code ?? "").trim();
    const newBeatName = ((p.details as Record<string, string>)?.beat_name ?? "").trim();
    const route = ((p.details as Record<string, string>)?.route ?? "").trim();
    const itcId = ((p.details as Record<string, string>)?.itc_id ?? "").trim();
    if (newBeatCode && route !== "Wholesale") {
      await t.execute(
        sql`update itc_customers set
          salesman_name = ${p.name},
          salesman_itc_id = coalesce(nullif(${itcId}, ''), salesman_itc_id),
          beat_code = ${newBeatCode},
          beat_name = ${newBeatName}
          where salesman_id = ${salesmanId} and org = ${a.org}`,
      );
    } else {
      await t.execute(
        sql`update itc_customers set
          salesman_name = ${p.name},
          salesman_itc_id = coalesce(nullif(${itcId}, ''), salesman_itc_id)
          where salesman_id = ${salesmanId} and org = ${a.org}`,
      );
    }
    await auditEvent(t, a, "salesman_policy", salesmanId, {
      before: {
        name: before.name,
        creditLimit: before.credit_limit,
        details: before.details,
      },
      after: p,
    });
  });
  return c.json({ id: salesmanId });
});

// ---- EMPLOYEES CRUD ----
app.get("/api/v1/employees", async (c) => {
  const a = c.get("actor");
  const list = await rows(db, sql`select id, name, role, phone, active, created_at from employees where org=${a.org} order by name asc`);
  return c.json(list);
});
app.post("/api/v1/employees", async (c) => {
  const a = c.get("actor");
  ownerOrManager(a);
  const p = z.object({
    name: z.string().min(1).max(200),
    role: z.string().default(""),
    phone: z.string().optional(),
  }).parse(await c.req.json());
  const [row] = await rows(db, sql`insert into employees (org, name, role, phone) values (${a.org}, ${p.name}, ${p.role}, ${p.phone ?? null}) returning id, name, role, phone, active`);
  return c.json(row, 201);
});
app.patch("/api/v1/employees/:id", async (c) => {
  const a = c.get("actor");
  ownerOrManager(a);
  const eid = id.parse(c.req.param("id"));
  const p = z.object({
    name: z.string().min(1).max(200).optional(),
    role: z.string().optional(),
    phone: z.string().optional(),
    active: z.boolean().optional(),
  }).parse(await c.req.json());
  await db.execute(sql`update employees set
    name = coalesce(${p.name ?? null}, name),
    role = coalesce(${p.role ?? null}, role),
    phone = coalesce(${p.phone ?? null}, phone),
    active = coalesce(${p.active ?? null}, active)
    where id=${eid} and org=${a.org}`);
  return c.json({ id: eid });
});

// ---- FOODS SALESMEN CRUD ----
app.get("/api/v1/foods-salesmen", async (c) => {
  const a = c.get("actor");
  const list = await rows(db, sql`select id, name, territory, phone, active, created_at from foods_salesmen where org=${a.org} order by name asc`);
  return c.json(list);
});
app.post("/api/v1/foods-salesmen", async (c) => {
  const a = c.get("actor");
  ownerOrManager(a);
  const p = z.object({
    name: z.string().min(1).max(200),
    territory: z.string().optional(),
    phone: z.string().optional(),
  }).parse(await c.req.json());
  const [row] = await rows(db, sql`insert into foods_salesmen (org, name, territory, phone) values (${a.org}, ${p.name}, ${p.territory ?? null}, ${p.phone ?? null}) returning id, name, territory, phone, active`);
  return c.json(row, 201);
});
app.patch("/api/v1/foods-salesmen/:id", async (c) => {
  const a = c.get("actor");
  ownerOrManager(a);
  const fid = id.parse(c.req.param("id"));
  const p = z.object({
    name: z.string().min(1).max(200).optional(),
    territory: z.string().optional(),
    phone: z.string().optional(),
    active: z.boolean().optional(),
  }).parse(await c.req.json());
  await db.execute(sql`update foods_salesmen set
    name = coalesce(${p.name ?? null}, name),
    territory = coalesce(${p.territory ?? null}, territory),
    phone = coalesce(${p.phone ?? null}, phone),
    active = coalesce(${p.active ?? null}, active)
    where id=${fid} and org=${a.org}`);
  return c.json({ id: fid });
});

// ---- PRODUCT PACK/PCS CRUD ----
app.get("/api/v1/product-pack-pcs", async (c) => {
  const a = c.get("actor");
  const list = await rows(db, sql`select id, product_id, pcs_per_pack, updated_at from product_pack_pcs where org=${a.org}`);
  return c.json(list);
});
app.post("/api/v1/product-pack-pcs", async (c) => {
  const a = c.get("actor");
  ownerOrManager(a);
  const p = z.object({
    productId: id,
    pcsPerPack: z.number().int().min(1).max(10000),
  }).parse(await c.req.json());
  const [row] = await rows(db, sql`
    insert into product_pack_pcs (org, product_id, pcs_per_pack)
    values (${a.org}, ${p.productId}, ${p.pcsPerPack})
    on conflict (org, product_id) do update set pcs_per_pack = excluded.pcs_per_pack, updated_at = now()
    returning id, product_id, pcs_per_pack`);
  return c.json(row);
});

app.post("/api/v1/report-export-audit", async (c) => {
  const a = c.get("actor");
  const p = z
    .object({
      name: z.enum([
        "transactions",
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
        "manager_cash",
      ]),
      from: dateSchema,
      to: dateSchema,
      offset: z.number().int().nonnegative(),
      count: z.number().int().min(0).max(100),
    })
    .strict()
    .parse(await c.req.json());
  await db.transaction((t) =>
    auditEvent(t, a, "displayed_page_export_requested", p.name, p),
  );
  return c.json({ id: crypto.randomUUID() });
});
