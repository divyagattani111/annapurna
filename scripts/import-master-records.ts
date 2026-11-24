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
console.log(`Importing master records for Organization: ${orgRow.name} (${org})`);

const filePath = path.resolve(process.cwd(), "exports/all_master_records.json");
if (!fs.existsSync(filePath)) {
  throw new Error(`File not found: ${filePath}`);
}
const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));

await db.transaction(async (t) => {
  // 1. Money accounts
  if (Array.isArray(data.moneyAccounts)) {
    for (const a of data.moneyAccounts) {
      const [existing] = await rows<{ id: string }>(
        t,
        sql`select id from money_accounts where org=${org} and id=${a.id}`,
      );
      if (!existing) {
        await t.execute(
          sql`insert into money_accounts(id, org, name, type, holder, active, allow_overdraft, details)
              values(${a.id}, ${org}, ${a.name}, ${a.type}, ${a.holder ?? "Annapurna"}, ${a.active ?? true}, ${a.allow_overdraft ?? false}, ${JSON.stringify(a.details ?? {})}::jsonb)`,
        );
      }
    }
    console.log(`✓ Processed ${data.moneyAccounts.length} money accounts`);
  }

  // 2. Salesmen
  if (Array.isArray(data.salesmen)) {
    for (const s of data.salesmen) {
      const [existing] = await rows<{ id: string }>(
        t,
        sql`select id from salesmen where org=${org} and (id=${s.id} or code=${s.code})`,
      );
      if (!existing) {
        await t.execute(
          sql`insert into salesmen(id, org, code, name, active, credit_limit, details)
              values(${s.id}, ${org}, ${s.code}, ${s.name}, ${s.active ?? true}, ${s.credit_limit ?? null}, ${JSON.stringify(s.details ?? {})}::jsonb)`,
        );
      } else {
        await t.execute(
          sql`update salesmen set name=${s.name}, active=${s.active ?? true}, details=${JSON.stringify(s.details ?? {})}::jsonb where org=${org} and id=${existing.id}`,
        );
      }
    }
    console.log(`✓ Processed ${data.salesmen.length} salesmen`);
  }

  // 3. Products and configurations
  if (Array.isArray(data.products)) {
    for (const p of data.products) {
      const [existing] = await rows<{ id: string }>(
        t,
        sql`select id from products where org=${org} and (id=${p.id} or code=${p.code})`,
      );
      const prodId = existing?.id ?? p.id ?? crypto.randomUUID();
      if (!existing) {
        await t.execute(
          sql`insert into products(id, org, code, name, barcode, itc_multiple, is_focus_brand, category)
              values(${prodId}, ${org}, ${p.code}, ${p.name}, ${p.barcode ?? null}, ${p.itc_multiple ?? null}, ${p.is_focus_brand ?? false}, ${p.category ?? 'CG-01 CIGARETTE'})`,
        );
      }

      // Check product configuration
      const [cfg] = await rows<{ id: string }>(
        t,
        sql`select id from product_configurations where org=${org} and product_id=${prodId}`,
      );
      if (!cfg) {
        const configId = crypto.randomUUID();
        const effDate = p.effective_date ? String(p.effective_date).slice(0, 10) : new Date().toISOString().slice(0, 10);
        await t.execute(
          sql`insert into product_configurations(id, org, product_id, unit, base_unit, conversion, basis, rate, fractional, confirmed, effective_date)
              values(${configId}, ${org}, ${prodId}, ${p.unit ?? 'm'}, ${p.base_unit ?? 'm'}, ${p.conversion ?? '1.00000000'}, ${p.basis ?? '1.00000000'}, ${p.rate ?? '0.00000000'}, ${p.fractional ?? true}, true, ${effDate}::date)`,
        );
      }
    }
    console.log(`✓ Processed ${data.products.length} products with configurations`);
  }

  // 4. Employees
  if (Array.isArray(data.employees)) {
    for (const e of data.employees) {
      const empId = e.id && e.id.length === 36 ? e.id : crypto.randomUUID();
      const [existing] = await rows<{ id: string }>(
        t,
        sql`select id from employees where org=${org} and name=${e.name}`,
      );
      if (!existing) {
        await t.execute(
          sql`insert into employees(id, org, name, role, phone, active)
              values(${empId}, ${org}, ${e.name}, ${e.role ?? ''}, ${e.phone ?? null}, ${e.active ?? true})`,
        );
      }
    }
    console.log(`✓ Processed ${data.employees.length} employees`);
  }

  // 5. Foods salesmen
  if (Array.isArray(data.foodsSalesmen)) {
    for (const fs of data.foodsSalesmen) {
      const fsId = fs.id && fs.id.length === 36 ? fs.id : crypto.randomUUID();
      const [existing] = await rows<{ id: string }>(
        t,
        sql`select id from foods_salesmen where org=${org} and name=${fs.name}`,
      );
      if (!existing) {
        await t.execute(
          sql`insert into foods_salesmen(id, org, name, territory, phone, active)
              values(${fsId}, ${org}, ${fs.name}, ${fs.territory ?? null}, ${fs.phone ?? null}, ${fs.active ?? true})`,
        );
      }
    }
    console.log(`✓ Processed ${data.foodsSalesmen.length} foods salesmen`);
  }
});

console.log("Master records imported successfully!");
await pool.end();
