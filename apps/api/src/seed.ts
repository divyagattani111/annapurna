import { sql } from "drizzle-orm";
import { db, pool } from "@ledger/db";
import { auth } from "./auth";
import { rows } from "./engine";
import { businessDate } from "./money";
export async function seedDemo(mode: "demo" | "test" = "demo") {
  if (process.env.APP_MODE !== mode)
    throw new Error("Seed requires explicit matching APP_MODE");
  const database = new URL(process.env.DATABASE_URL ?? "").pathname.slice(1);
  if (!database.endsWith("_" + mode))
    throw new Error("Seed may target only a database ending _demo or _test");
  const name =
    mode === "demo"
      ? "Demo Family Business · Fictional"
      : "Acceptance Test Business";
  const [existing] = await rows<{ id: string }>(
    db,
    sql`select id from organizations where name=${name} and mode=${mode}`,
  );
  for (const key of ["DEMO_OWNER_PASSWORD", "DEMO_MANAGER_PASSWORD"])
    if ((process.env[key]?.length ?? 0) < 4)
      throw new Error(key + " must be set privately (4+ characters)");
  const org = existing?.id ?? crypto.randomUUID();
  if (!existing)
    await db.execute(
      sql`insert into organizations(id,name,mode) values(${org},${name},${mode})`,
    );
  const people: string[] = [];
  if (!existing) {
    for (const role of ["owner", "manager"] as const) {
      const email = `${role}@${mode}.invalid`;
      const result = await auth.api.signUpEmail({
        body: {
          email,
          password:
            process.env[
              role === "owner" ? "DEMO_OWNER_PASSWORD" : "DEMO_MANAGER_PASSWORD"
            ]!,
          name: `Fictional ${role}`,
        },
      });
      await db.execute(
        sql`insert into members(org,user_id,role) values(${org},${result.user.id},${role})`,
      );
      people.push(result.user.id);
    }
  }
  if (existing) {
    const members = await rows<{ user_id: string }>(
      db,
      sql`select user_id from members where org=${org} and role='owner'`,
    );
    people.push(members[0].user_id);
  }
  const accounts: string[] = [];
  if (!existing) {
    for (const [label, type, holder] of [
      ["Demo manager cash", "cash", "Demo manager"],
      ["Demo receiving bank", "bank", "Demo business"],
      ["Mudhasir online account", "bank", "Mudhasir"],
    ]) {
      const [r] = await rows<{ id: string }>(
        db,
        sql`insert into money_accounts(org,name,type,holder) values(${org},${label},${type},${holder}) returning id`,
      );
      accounts.push(r.id);
    }
  }
  if (existing) {
    const list = await rows<{ id: string }>(
      db,
      sql`select id from money_accounts where org=${org} order by case name when 'Demo manager cash' then 0 else 1 end`,
    );
    accounts.push(...list.map((r) => r.id));
  }
  const salesmen: string[] = [];
  if (!existing) {
    for (let i = 1; i <= 12; i++) {
      const [r] = await rows<{ id: string }>(
        db,
        sql`insert into salesmen(org,code,name) values(${org},${"D" + String(i).padStart(3, "0")},${"Fictional Salesman " + String(i).padStart(2, "0")}) returning id`,
      );
      salesmen.push(r.id);
    }
  }
  if (existing) {
    const list = await rows<{ id: string }>(
      db,
      sql`select id from salesmen where org=${org} order by code`,
    );
    salesmen.push(...list.map((r) => r.id));
  }
  const products: string[] = [];
  if (!existing) {
    for (const [code, label, unit, conversion, basis, rate] of [
      ["DEMO-A", "Demo Meadow Pack", "pack", "1", "1", "100"],
      ["DEMO-B", "Demo River Box", "box", "10", "100", "250"],
      ["DEMO-C", "Demo Hill Unit", "unit", "1", "1", "10.005"],
      ["CONF-01", "Cadbury Dairy Milk 12g", "piece", "1", "1", "10.00", "confectionery"],
      ["CONF-02", "Center Fresh Spearmint", "piece", "1", "1", "1.00", "confectionery"],
    ]) {
      const cat = code.startsWith("CONF") ? "CF-05 CONFECTIONERY" : "CG-01 CIGARETTE";
      const [r] = await rows<{ id: string }>(
        db,
        sql`insert into products(org,code,name,category) values(${org},${code},${label},${cat}) returning id`,
      );
      products.push(r.id);
      await db.execute(
        sql`insert into product_configurations(org,product_id,effective_date,unit,base_unit,conversion,basis,rate,confirmed) values(${org},${r.id},${businessDate()},${unit},'unit',${conversion},${basis},${rate},true)`,
      );
    }
  }
  if (existing) {
    const list = await rows<{ id: string }>(
      db,
      sql`select id from products where org=${org} order by code`,
    );
    products.push(...list.map((r) => r.id));
  }
  if (mode === "demo") {
    // Clean demo start: 12 salesmen, 0 balances and 0 transactions.
  }
  return org;
}
if (import.meta.main) {
  console.log("Demo organization:", await seedDemo());
  await pool.end();
}
