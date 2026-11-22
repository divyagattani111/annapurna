import { sql } from "drizzle-orm";
import { db, pool } from "../packages/db/src";
import { rows, command, type Actor } from "../apps/api/src/engine";
import { app } from "../apps/api/src/app";
import { auth } from "../apps/api/src/auth";
import { businessDate } from "../apps/api/src/money";
if (
  process.env.APP_MODE !== "test" ||
  !new URL(process.env.DATABASE_URL ?? "").pathname.endsWith("_test")
)
  throw new Error("Isolated test database required");
const previous = await Bun.file(".local/performance.json").json(),
  org = previous.organization,
  date = businessDate();
const [organization] = await rows<{ mode: string }>(
  db,
  sql`select mode from organizations where id=${org}`,
);
if (organization.mode !== "test")
  throw new Error("Fixture must remain test mode");
const password = "Benchmark-" + crypto.randomUUID(),
  email = crypto.randomUUID() + "@test.invalid";
const user = await auth.api.signUpEmail({
  body: { name: "Fictional benchmark verifier", email, password },
});
await db.execute(
  sql`insert into members(org,user_id,role) values(${org},${user.user.id},'owner')`,
);
const session = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  }),
  cookie = session.headers
    .getSetCookie()
    .map((s) => s.split(";")[0])
    .join("; "),
  measurements: Record<string, number> = {};
for (const path of [
  "dashboard",
  "documents",
  "reports/products?from=" + date + "&to=" + date,
  "reports/outstanding?to=" + date,
]) {
  const start = performance.now();
  const response = await app.request("http://local/api/v1/" + path, {
    headers: { cookie },
  });
  if (response.status !== 200) throw new Error("Failed benchmark route");
  await response.json();
  measurements[path] = Math.round((performance.now() - start) * 100) / 100;
}
const [salesman] = await rows<{ id: string }>(
    db,
    sql`select id from salesmen where org=${org} order by code limit 1`,
  ),
  [cash] = await rows<{ id: string }>(
    db,
    sql`select id from money_accounts where org=${org} and type='cash' limit 1`,
  );
const actor: Actor = { id: user.user.id, org, role: "owner", capabilities: {} },
  started = performance.now();
await command(
  actor,
  "receipt",
  {
    date,
    actualDate: date,
    salesmanId: salesman.id,
    amount: "4000.00",
    accountId: cash.id,
    method: "cash",
    reference: "",
  },
  crypto.randomUUID(),
);
measurements.receiptWithAllocation =
  Math.round((performance.now() - started) * 100) / 100;
const result = {
  ...previous,
  requestMs: measurements,
  measuredAt: new Date().toISOString(),
  note: "Current code, retained 10,000-bill/100,000-line fictional fixture, local single-run/warm database. Not production capacity.",
};
await Bun.write(
  ".local/performance-final.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
await pool.end();
