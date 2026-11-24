import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { db, pool } from "../packages/db/src";
import { rows } from "../apps/api/src/engine";

if (process.env.APP_MODE === "live" && process.env.APPROVED_IMPORT !== "yes") {
  throw new Error("Live import requires APPROVED_IMPORT=yes");
}

const [orgRow] = await rows<{ id: string; name: string }>(
  db,
  sql`select id, name from organizations limit 1`,
);
if (!orgRow) {
  throw new Error("No organization found. Please bootstrap owner first.");
}
const org = orgRow.id;
console.log(`Syncing exact master records for Organization: ${orgRow.name} (${org})`);

const filePath = path.resolve(process.cwd(), "exports/exact_master_records.json");
if (!fs.existsSync(filePath)) {
  throw new Error(`File not found: ${filePath}`);
}
const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));

await db.transaction(async (t) => {
  // 1. Money accounts
  if (Array.isArray(data.moneyAccounts)) {
    for (const a of data.moneyAccounts) {
      await t.execute(
        sql`insert into money_accounts(id, org, name, type, holder, active, allow_overdraft, details)
            values(${a.id}, ${org}, ${a.name}, ${a.type}, ${a.holder ?? "Annapurna"}, ${a.active ?? true}, ${a.allow_overdraft ?? false}, ${JSON.stringify(a.details ?? {})}::jsonb)
            on conflict (id) do update set
              name = excluded.name,
              type = excluded.type,
              holder = excluded.holder,
              active = excluded.active,
              allow_overdraft = excluded.allow_overdraft,
              details = excluded.details`,
      );
    }
    console.log(`✓ Synced ${data.moneyAccounts.length} money accounts`);
  }

  // 2. Salesmen
  if (Array.isArray(data.salesmen)) {
    for (const s of data.salesmen) {
      await t.execute(
        sql`insert into salesmen(id, org, code, name, active, credit_limit, details)
            values(${s.id}, ${org}, ${s.code}, ${s.name}, ${s.active ?? true}, ${s.credit_limit ?? null}, ${JSON.stringify(s.details ?? {})}::jsonb)
            on conflict (org, code) do update set
              name = excluded.name,
              active = excluded.active,
              credit_limit = excluded.credit_limit,
              details = excluded.details`,
      );
    }
    console.log(`✓ Synced ${data.salesmen.length} salesmen`);
  }

  // 3. Products
  if (Array.isArray(data.products)) {
    for (const p of data.products) {
      await t.execute(
        sql`insert into products(id, org, code, name, barcode, itc_multiple, is_focus_brand, category)
            values(${p.id}, ${org}, ${p.code}, ${p.name}, ${p.barcode ?? null}, ${p.itc_multiple ?? null}, ${p.is_focus_brand ?? false}, ${p.category ?? 'CG-01 CIGARETTE'})
            on conflict (org, code) do update set
              name = excluded.name,
              barcode = excluded.barcode,
              itc_multiple = excluded.itc_multiple,
              is_focus_brand = excluded.is_focus_brand,
              category = excluded.category`,
      );
    }
    console.log(`✓ Synced ${data.products.length} products`);
  }

  // 4. Product Configurations (Exact historical + effective rates)
  if (Array.isArray(data.productConfigurations)) {
    // Clean old configurations for these products to ensure exact mirror
    await t.execute(sql`delete from product_configurations where org=${org}`);
    for (const c of data.productConfigurations) {
      await t.execute(
        sql`insert into product_configurations(id, org, product_id, unit, base_unit, conversion, basis, rate, fractional, confirmed, effective_date, created_at)
            values(${c.id}, ${org}, ${c.product_id}, ${c.unit}, ${c.base_unit}, ${c.conversion}, ${c.basis}, ${c.rate}, ${c.fractional}, ${c.confirmed ?? true}, ${c.effective_date}::date, ${c.created_at}::timestamptz)`,
      );
    }
    console.log(`✓ Synced ${data.productConfigurations.length} exact product configurations (rates & dates)`);
  }

  // 5. Employees
  if (Array.isArray(data.employees)) {
    await t.execute(sql`delete from employees where org=${org}`);
    for (const e of data.employees) {
      await t.execute(
        sql`insert into employees(id, org, name, role, phone, active)
            values(${e.id}, ${org}, ${e.name}, ${e.role ?? ''}, ${e.phone ?? null}, ${e.active ?? true})`,
      );
    }
    console.log(`✓ Synced ${data.employees.length} employees`);
  }

  // 6. Foods Salesmen
  if (Array.isArray(data.foodsSalesmen)) {
    await t.execute(sql`delete from foods_salesmen where org=${org}`);
    for (const fs of data.foodsSalesmen) {
      await t.execute(
        sql`insert into foods_salesmen(id, org, name, territory, phone, active)
            values(${fs.id}, ${org}, ${fs.name}, ${fs.territory ?? null}, ${fs.phone ?? null}, ${fs.active ?? true})`,
      );
    }
    console.log(`✓ Synced ${data.foodsSalesmen.length} foods salesmen`);
  }

  // 7. ITC Customers
  if (Array.isArray(data.itcCustomers)) {
    await t.execute(sql`delete from itc_customers where org=${org}`);
    for (const c of data.itcCustomers) {
      await t.execute(
        sql`insert into itc_customers(id, org, customer_id, customer_name, salesman_itc_id, salesman_name, beat_code, beat_name, salesman_id, active, is_gst)
            values(${c.id}, ${org}, ${c.customer_id}, ${c.customer_name}, ${c.salesman_itc_id}, ${c.salesman_name}, ${c.beat_code}, ${c.beat_name}, ${c.salesman_id}, ${c.active ?? true}, ${c.is_gst ?? false})`,
      );
    }
    console.log(`✓ Synced ${data.itcCustomers.length} ITC customers`);
  }
});

console.log("Master records exact sync completed!");
await pool.end();
