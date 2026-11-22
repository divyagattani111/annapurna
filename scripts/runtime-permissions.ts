import { sql } from "drizzle-orm";
import { db, pool } from "../packages/db/src";
import { seedDemo } from "../apps/api/src/seed";
import { command, rows, type Actor } from "../apps/api/src/engine";
import { auth } from "../apps/api/src/auth";
import { app } from "../apps/api/src/app";
import { businessDate } from "../apps/api/src/money";
if (process.env.APP_MODE !== "test") throw new Error("Isolated test mode only");
const [role] = await rows<{ rolsuper: boolean; rolcreatedb: boolean }>(
  db,
  sql`select rolsuper,rolcreatedb from pg_roles where rolname=current_user`,
);
if (role.rolsuper || role.rolcreatedb)
  throw new Error("This check requires the restricted runtime role");
const org = await seedDemo("test"),
  [member] = await rows<{ user_id: string }>(
    db,
    sql`select user_id from members where org=${org} and role='owner'`,
  ),
  [account] = await rows<{ id: string }>(
    db,
    sql`select id from money_accounts where org=${org} and type='cash' order by name limit 1`,
  ),
  actor: Actor = { id: member.user_id, org, role: "owner", capabilities: {} };
const saved = await command(
  actor,
  "owner",
  {
    date: businessDate(),
    classification: "contribution",
    accountId: account.id,
    amount: "1000.00",
  },
  "runtime-permission-smoke-" + org,
);
let denied = false;
try {
  await db.execute(
    sql`update documents set amount=amount where id=${saved.id}`,
  );
} catch (e) {
  denied = (e as { cause?: { code?: string } }).cause?.code === "42501";
}
if (!denied) throw new Error("Runtime database role can update posted history");
const signed = await auth.api.signInEmail({
    body: {
      email: "owner@test.invalid",
      password: process.env.DEMO_OWNER_PASSWORD!,
    },
    asResponse: true,
  }),
  cookie = signed.headers
    .getSetCookie()
    .map((s) => s.split(";")[0])
    .join("; ");
const me = await app.request("http://local/api/v1/me", { headers: { cookie } });
if (me.status !== 200) throw new Error("Runtime role authentication failed");
console.log(
  "Non-superuser runtime role: authenticated posting passed; financial-history UPDATE denied by PostgreSQL privileges.",
);
await pool.end();
