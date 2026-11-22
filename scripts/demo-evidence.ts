import { sql } from "drizzle-orm";
import { db, pool } from "../packages/db/src";
import { auth } from "../apps/api/src/auth";
import { app } from "../apps/api/src/app";
import { rows } from "../apps/api/src/engine";
if (process.env.APP_MODE !== "demo")
  throw new Error("Fictional evidence only in demo mode");
const response = await auth.api.signInEmail({
  body: {
    email: "owner@demo.invalid",
    password: process.env.DEMO_OWNER_PASSWORD!,
  },
  asResponse: true,
});
const cookie = response.headers
  .getSetCookie()
  .map((v) => v.split(";")[0])
  .join("; ");
const [doc] = await rows<{ id: string }>(
  db,
  sql`select d.id from documents d join organizations o on o.id=d.org where o.mode='demo' and d.kind='bill' order by d.created_at limit 1`,
);
const form = new FormData();
form.set(
  "file",
  new File(
    [
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jG1sAAAAASUVORK5CYII=",
        "base64",
      ),
    ],
    "fictional-evidence.png",
    { type: "image/png" },
  ),
);
const uploaded = await app.request(
  "http://local/api/v1/attachments/" + doc.id,
  {
    method: "POST",
    headers: { cookie, origin: process.env.APP_ORIGIN! },
    body: form,
  },
);
if (uploaded.status !== 201) throw new Error("Private evidence upload failed");
const { id } = await uploaded.json();
const before = await app.request("http://local/api/v1/attachments/" + id, {
  headers: { cookie },
});
if (before.status !== 200) throw new Error("Authenticated attachment failed");
await auth.api.signOut({ headers: new Headers({ cookie }) });
const after = await app.request("http://local/api/v1/attachments/" + id, {
  headers: { cookie },
});
if (after.status !== 401)
  throw new Error("Evidence remains accessible after logout");
console.log(
  "Fictional evidence uploaded; authenticated access passed, logout access denied.",
);
await pool.end();
