import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./index";
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
const mode = process.env.APP_MODE;
const databaseName = new URL(process.env.DATABASE_URL).pathname.slice(1);
if ((mode === "demo" || mode === "test") && !databaseName.endsWith("_" + mode))
  throw new Error(
    "Development migrations require a database ending _demo or _test to match APP_MODE",
  );
if (
  process.env.APP_MODE !== "demo" &&
  process.env.APP_MODE !== "test" &&
  process.env.APPROVED_MIGRATION !== "yes"
)
  throw new Error(
    "Live migration requires separately approved plan, backup and APPROVED_MIGRATION=yes",
  );
await migrate(db, {
  migrationsFolder: new URL("../migrations", import.meta.url).pathname,
});
console.log("Reviewed migrations applied");
await pool.end();
