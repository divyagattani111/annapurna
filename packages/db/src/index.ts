import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
export * from "./schema";
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});
pool.on("connect", (client) => {
  client.query("SET timezone = 'Asia/Kolkata'");
});
export const db = drizzle(pool);
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export { Pool } from "pg";
