import { sql } from "drizzle-orm";
import { db, pool } from "../packages/db/src";
import { auth } from "../apps/api/src/auth";
import { rows } from "../apps/api/src/engine";
const email = process.env.OWNER_EMAIL,
  password = process.env.OWNER_PASSWORD,
  name = process.env.BUSINESS_NAME;
if (!email || !password || password.length < 12 || !name)
  throw new Error(
    "Set private OWNER_EMAIL, OWNER_PASSWORD (12+) and confirmed BUSINESS_NAME",
  );
if (process.env.APP_MODE === "live" && process.env.APPROVED_PROVISION !== "yes")
  throw new Error(
    "Live provisioning requires an explicitly approved operational procedure",
  );
if (!["live", "test", "demo"].includes(process.env.APP_MODE ?? ""))
  throw new Error("APP_MODE required");
const existing = await rows(db, sql`select id from organizations limit 1`);
if (existing.length)
  throw new Error(
    "This database already has an organization. No bootstrap overwrite is permitted.",
  );
const result = await auth.api.signUpEmail({
    body: { name: "Owner", email, password },
  }),
  org = crypto.randomUUID();
await db.transaction(async (t) => {
  await t.execute(
    sql`insert into organizations(id,name,mode) values(${org},${name},${process.env.APP_MODE})`,
  );
  await t.execute(
    sql`insert into members(org,user_id,role) values(${org},${result.user.id},'owner')`,
  );
  await t.execute(
    sql`insert into audit(org,actor,action,target,data) values(${org},${result.user.id},'owner_provisioned',${org},'{}')`,
  );
});
console.log(
  "Owner provisioned. No passwords or session tokens are displayed. Finish Settings before financial posting.",
);
await pool.end();
