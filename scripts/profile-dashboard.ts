import { sql } from "drizzle-orm";
import { db, pool } from "../packages/db/src";
import { rows } from "../apps/api/src/engine";
import { businessDate } from "../apps/api/src/money";
if (process.env.APP_MODE !== "test") throw new Error("Test only");
const org = (await Bun.file(".local/performance.json").json()).organization,
  date = businessDate();
for (const [name, query] of [
  [
    "people",
    sql`select s.id,s.code,s.name,s.active,coalesce(sum(j.debit-j.credit) filter(where d.business_date<=${date}::date),0)::numeric(18,2)::text balance from salesmen s left join journal j on j.org=s.org and j.account='trade:'||s.id::text left join documents d on d.id=j.document_id where s.org=${org} group by s.id order by s.code`,
  ],
  [
    "money",
    sql`select m.*,coalesce(sum(j.debit-j.credit) filter(where d.business_date<=${date}::date),0)::numeric(18,2)::text balance from money_accounts m left join journal j on j.org=m.org and j.account='money:'||m.id::text left join documents d on d.id=j.document_id where m.org=${org} group by m.id order by m.type,m.name`,
  ],
  [
    "activity",
    sql`select coalesce(o.kind,d.kind) kind,coalesce(o.data->>'method',d.data->>'method','') method,sum(case when d.reverses is null then d.amount else -d.amount end)::numeric(18,2)::text amount,count(*)::text count from documents d left join documents o on o.id=d.reverses and o.org=d.org where d.org=${org} and d.business_date=${date} group by coalesce(o.kind,d.kind),coalesce(o.data->>'method',d.data->>'method','') order by kind`,
  ],
  [
    "cashSummary",
    sql`select m.id,m.name,m.holder,coalesce(sum(j.debit-j.credit) filter(where d.business_date<${date}::date),0)::numeric(18,2)::text opening,coalesce(sum(j.debit) filter(where d.business_date=${date}::date),0)::numeric(18,2)::text inflows,coalesce(sum(j.credit) filter(where d.business_date=${date}::date),0)::numeric(18,2)::text outflows,coalesce(sum(j.debit-j.credit) filter(where d.business_date<=${date}::date),0)::numeric(18,2)::text expected from money_accounts m left join journal j on j.org=m.org and j.account='money:'||m.id::text left join documents d on d.id=j.document_id where m.org=${org} and m.type='cash' group by m.id order by m.name`,
  ],
] as const) {
  const plan = await rows<Record<string, unknown>>(
    db,
    sql`explain (analyze,buffers,format json) ${query}`,
  );
  console.log(name, JSON.stringify(plan));
}
await pool.end();
