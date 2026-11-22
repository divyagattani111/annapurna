import { sql } from "drizzle-orm";
import { db, pool } from "../packages/db/src";
import { auth } from "../apps/api/src/auth";
import { rows, command, type Actor } from "../apps/api/src/engine";
import { app } from "../apps/api/src/app";
import { businessDate } from "../apps/api/src/money";
if (
  process.env.APP_MODE !== "test" ||
  !new URL(process.env.DATABASE_URL ?? "").pathname.endsWith("_test")
)
  throw new Error("Performance fixture only in isolated *_test database");
const org = crypto.randomUUID(),
  date = businessDate(),
  password = "Benchmark-" + crypto.randomUUID(),
  email = crypto.randomUUID() + "@test.invalid";
const user = await auth.api.signUpEmail({
  body: { name: "Fictional benchmark owner", email, password },
});
await db.execute(
  sql`insert into organizations(id,name,mode) values(${org},'Fictional benchmark history','test')`,
);
await db.execute(
  sql`insert into members(org,user_id,role) values(${org},${user.user.id},'owner')`,
);
const product = crypto.randomUUID(),
  cash = crypto.randomUUID();
await db.execute(
  sql`insert into products(id,org,code,name) values(${product},${org},'PERF','Fictional benchmark unit')`,
);
await db.execute(
  sql`insert into product_configurations(org,product_id,effective_date,unit,base_unit,conversion,basis,rate,confirmed) values(${org},${product},${date},'unit','unit','1','1','10',true)`,
);
await db.execute(
  sql`insert into money_accounts(id,org,name,type,holder) values(${cash},${org},'Benchmark cash','cash','Benchmark owner')`,
);
await db.execute(
  sql`insert into salesmen(org,code,name) select ${org},'P'||n,'Fictional benchmark salesman '||n from generate_series(1,12)n`,
);
const seedStart = performance.now();
await db.transaction(async (t) => {
  await t.execute(
    sql`create temporary table perf_docs on commit drop as select gen_random_uuid() id,row_number() over() n,s.id salesman_id from generate_series(1,10000) g join lateral(select id from salesmen where org=${org} order by code offset ((g-1)%12) limit 1)s on true`,
  );
  await t.execute(
    sql`insert into documents(id,org,number,kind,business_date,salesman_id,amount,data,actor) select id,${org},'PERF-'||nextval('document_numbers'),'bill',${date},salesman_id,'100.00',jsonb_build_object('note','Fictional benchmark bill','issueBalance','100.00'),${user.user.id} from perf_docs`,
  );
  await t.execute(
    sql`insert into bill_lines(org,document_id,product_id,quantity,amount,snapshot) select ${org},p.id,${product},'1','10.00',jsonb_build_object('name','Fictional benchmark unit','unit','unit','base_unit','unit','conversion','1','basis','1','rate','10','fractional',false) from perf_docs p cross join generate_series(1,10)`,
  );
  await t.execute(
    sql`insert into journal(org,document_id,account,debit,credit) select ${org}::uuid,id,'trade:'||salesman_id::text,100::numeric,0::numeric from perf_docs union all select ${org}::uuid,id,'control:sales',0::numeric,100::numeric from perf_docs`,
  );
});
const seedMs = performance.now() - seedStart;
const signed = await auth.api.signInEmail({
  body: { email, password },
  asResponse: true,
});
const cookie = signed.headers
  .getSetCookie()
  .map((s) => s.split(";")[0])
  .join("; ");
const measurements: Record<string, number> = {};
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
  if (response.status !== 200)
    throw new Error("Benchmark query failed: " + path);
  await response.json();
  measurements[path] = Math.round((performance.now() - start) * 100) / 100;
}
const [salesman] = await rows<{ id: string }>(
  db,
  sql`select id from salesmen where org=${org} order by code limit 1`,
);
const actor: Actor = { id: user.user.id, org, role: "owner", capabilities: {} };
const start = performance.now();
await command(
  actor,
  "receipt",
  {
    date,
    actualDate: date,
    salesmanId: salesman.id,
    amount: "4000.00",
    accountId: cash,
    method: "cash",
    reference: "",
  },
  crypto.randomUUID(),
);
measurements.receiptWithAllocation =
  Math.round((performance.now() - start) * 100) / 100;
const [counts] = await rows(
  db,
  sql`select (select count(*)::text from documents where org=${org} and kind='bill') bills,(select count(*)::text from bill_lines where org=${org}) lines`,
);
const result = {
  runtime: Bun.version,
  postgres: "18",
  organization: org,
  fixture: counts,
  bulkFixtureMs: Math.round(seedMs),
  requestMs: measurements,
  note: "Local warm single-run measurements, not production capacity or financial command bulk throughput.",
};
await Bun.write(".local/performance.json", JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
await pool.end();
