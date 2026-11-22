import { mkdir, chmod, copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import { db, pool } from "../packages/db/src";
import { rows, lock } from "../apps/api/src/engine";
const url = new URL(process.env.DATABASE_URL ?? "");
if (
  !["demo", "test"].includes(process.env.APP_MODE ?? "") &&
  process.env.APPROVED_BACKUP !== "yes"
)
  throw new Error(
    "Live backup requires configured private destination and approved runbook",
  );
const destination = resolve(
  process.env.BACKUP_DIR ?? ".local/backups",
  new Date().toISOString().replaceAll(":", "-"),
);
await mkdir(destination, { recursive: true, mode: 0o700 });
await mkdir(resolve(destination, "attachments"), { mode: 0o700 });
const pgEnv = {
  ...process.env,
  PGHOST: url.hostname,
  PGPORT: url.port || "5432",
  PGUSER: decodeURIComponent(url.username),
  PGPASSWORD: decodeURIComponent(url.password),
  PGDATABASE: url.pathname.slice(1),
};
await db.transaction(async (t) => {
  const organizations = await rows<{ id: string }>(
    t,
    sql`select id from organizations order by id`,
  );
  for (const org of organizations) await lock(t, org.id);
  const dump = Bun.spawn(
    [
      resolve(process.env.PG_BIN ?? "/usr/bin", "pg_dump"),
      "-Fc",
      "--no-owner",
      "--no-acl",
      "-f",
      resolve(destination, "database.dump"),
    ],
    { env: pgEnv, stdout: "ignore", stderr: "pipe" },
  );
  if ((await dump.exited) !== 0)
    throw new Error("Database dump failed; inspect private operational logs");
  const attachments = await rows<{ key: string; hash: string }>(
    t,
    sql`select key,hash from attachments order by key`,
  );
  for (const file of attachments)
    await copyFile(
      resolve(process.env.ATTACHMENT_DIR ?? "private-files", file.key),
      resolve(destination, "attachments", file.key),
    );
  const financial = await rows(
    t,
    sql`select org,account,sum(debit-credit)::text balance from journal group by org,account order by org,account`,
  );
  const [counts] = await rows(
    t,
    sql`select (select count(*)::text from documents) documents,(select count(*)::text from audit) audit,(select count(*)::text from members) members,(select count(*)::text from attachments) attachments`,
  );
  const permissions = await rows(
    t,
    sql`select org,user_id,role,active,capabilities from members order by org,user_id`,
  );
  const history = await rows(
    t,
    sql`select id,org,actor,action,target,data,to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') created_at from audit order by id`,
  );
  const auditHash = new Bun.CryptoHasher("sha256")
    .update(JSON.stringify(history))
    .digest("hex");
  await Bun.write(
    resolve(destination, "manifest.json"),
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        financial,
        counts,
        attachments,
        permissions,
        auditHash,
      },
      null,
      2,
    ),
  );
});
await chmod(resolve(destination, "database.dump"), 0o600);
await chmod(resolve(destination, "manifest.json"), 0o600);
console.log("Private backup created:", destination);
console.log(
  "Local backup only. Off-server encryption/retention and monitoring must be configured.",
);
await pool.end();
