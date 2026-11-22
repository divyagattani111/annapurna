import { resolve } from "node:path";
import { mkdir, copyFile } from "node:fs/promises";
import { Pool } from "../packages/db/src";
const source = process.env.RESTORE_SOURCE;
if (!source) throw new Error("RESTORE_SOURCE required");
const url = new URL(process.env.DATABASE_URL ?? "");
if (
  !["demo", "test"].includes(process.env.APP_MODE ?? "") ||
  !["127.0.0.1", "localhost"].includes(url.hostname)
)
  throw new Error("Automated drill is local demo/test only");
const target =
  "family_ledger_drill_" + crypto.randomUUID().replaceAll("-", "") + "_restore";
const env = {
  ...process.env,
  PGHOST: url.hostname,
  PGPORT: url.port || "5432",
  PGUSER: decodeURIComponent(url.username),
  PGPASSWORD: decodeURIComponent(url.password),
};
async function run(name: string, args: string[]) {
  const p = Bun.spawn(
    [resolve(process.env.PG_BIN ?? "/usr/bin", name), ...args],
    { env, stdout: "ignore", stderr: "pipe" },
  );
  if ((await p.exited) !== 0)
    throw new Error(name + " failed. No existing database was replaced.");
}
await run("createdb", [target]);
await run("pg_restore", [
  "--exit-on-error",
  "--no-owner",
  "--no-acl",
  "-d",
  target,
  resolve(source, "database.dump"),
]);
const pool = new Pool({ connectionString: new URL("/" + target, url).href }),
  manifest = await Bun.file(resolve(source, "manifest.json")).json();
const financial = (
  await pool.query(
    "select org,account,sum(debit-credit)::text balance from journal group by org,account order by org,account",
  )
).rows;
const counts = (
  await pool.query(
    "select (select count(*)::text from documents) documents,(select count(*)::text from audit) audit,(select count(*)::text from members) members,(select count(*)::text from attachments) attachments",
  )
).rows[0];
if (
  JSON.stringify(financial) !== JSON.stringify(manifest.financial) ||
  JSON.stringify(counts) !== JSON.stringify(manifest.counts)
)
  throw new Error("Restore totals/counts differ");
const permissions = (
  await pool.query(
    "select org,user_id,role,active,capabilities from members order by org,user_id",
  )
).rows;
const history = (
  await pool.query(
    `select id,org,actor,action,target,data,to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') created_at from audit order by id`,
  )
).rows;
if (JSON.stringify(permissions) !== JSON.stringify(manifest.permissions))
  throw new Error("Restored permissions differ");
if (
  new Bun.CryptoHasher("sha256")
    .update(JSON.stringify(history))
    .digest("hex") !== manifest.auditHash
)
  throw new Error("Restored audit contents differ");
const restoredFiles = resolve(".local/restore-attachments", target);
await mkdir(restoredFiles, { recursive: true, mode: 0o700 });
for (const file of manifest.attachments) {
  if (!/^[0-9a-f-]{36}$/.test(file.key))
    throw new Error("Invalid attachment storage key");
  await copyFile(
    resolve(source, "attachments", file.key),
    resolve(restoredFiles, file.key),
  );
  const bytes = await Bun.file(resolve(restoredFiles, file.key)).arrayBuffer();
  if (new Bun.CryptoHasher("sha256").update(bytes).digest("hex") !== file.hash)
    throw new Error("Attachment checksum failed");
}
const [invalid] = (
  await pool.query(
    "select count(*)::text count from members where role not in ('owner','manager')",
  )
).rows;
if (invalid.count !== "0") throw new Error("Invalid restored permissions");
console.log(
  "Restore verified: financial balances, record/audit/member counts, private attachment hashes.",
);
console.log("Isolated database retained for inspection:", target);
console.log("Restored private attachment directory:", restoredFiles);
await pool.end();
const { pool: sourcePool } = await import("../packages/db/src");
await sourcePool.end();
