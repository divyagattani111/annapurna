import { sql } from "drizzle-orm";
import { db, pool } from "../packages/db/src";
import { auth } from "../apps/api/src/auth";
import { rows } from "../apps/api/src/engine";

const orgs = await rows<{ id: string; name: string }>(db, sql`select id, name from organizations limit 1`);
if (!orgs.length) {
  throw new Error("No organization found in database!");
}
const orgId = orgs[0].id;
console.log(`Working on Organization: "${orgs[0].name}" (${orgId})`);

// 1. Update existing admin email from admin@annapurnadivya.co.in to admin@annapurna.co.in
const existingAdmin = await rows<{ id: string; email: string }>(
  db,
  sql`select id, email from "user" where email = 'admin@annapurnadivya.co.in'`
);
if (existingAdmin.length) {
  await db.transaction(async (t) => {
    await t.execute(
      sql`update "user" set email = 'admin@annapurna.co.in', "updatedAt" = now() where id = ${existingAdmin[0].id}`
    );
    await t.execute(
      sql`update "account" set "accountId" = 'admin@annapurna.co.in', "updatedAt" = now() where "userId" = ${existingAdmin[0].id} and "accountId" = 'admin@annapurnadivya.co.in'`
    );
  });
  console.log("Updated admin email to admin@annapurna.co.in");
} else {
  console.log("admin@annapurnadivya.co.in not found (may already be updated).");
}

// 2. Fetch Mubashir Salesman ID
const mubashirRows = await rows<{ id: string; name: string }>(
  db,
  sql`select id, name from salesmen where id = 'fc4930bb-9775-4156-ad91-a161a981ed2d' or name ilike '%mubashir%' limit 1`
);
if (!mubashirRows.length) {
  throw new Error("Could not find Mubashir salesman record!");
}
const mubashirId = mubashirRows[0].id;
console.log(`Found Salesman: ${mubashirRows[0].name} (${mubashirId})`);

// 3. Define users to create or update
const usersToProvision = [
  {
    name: "Naresh",
    email: "naresh@annapurna.co.in",
    password: "naresh@119876",
    role: "manager" as const,
    capabilities: {},
  },
  {
    name: "Laxmi",
    email: "laxmi@annapurna.co.in",
    password: "laxmi@115678",
    role: "manager" as const,
    capabilities: {},
  },
  {
    name: "Salesman Mubashir",
    email: "sales@annapurna.co.in",
    password: "sales@99876",
    role: "salesman" as const,
    capabilities: { salesmanId: mubashirId },
  },
];

for (const u of usersToProvision) {
  const existing = await rows<{ id: string; email: string }>(
    db,
    sql`select id, email from "user" where email = ${u.email}`
  );

  let userId: string;
  if (existing.length) {
    userId = existing[0].id;
    console.log(`User ${u.email} already exists (id: ${userId}), resetting password and membership...`);
    const { hashPassword } = await import("better-auth/crypto");
    const hash = await hashPassword(u.password);
    await db.transaction(async (t) => {
      await t.execute(
        sql`update "account" set password = ${hash}, "updatedAt" = now() where "userId" = ${userId}`
      );
      await t.execute(
        sql`insert into members(org, user_id, role, capabilities)
            values(${orgId}, ${userId}, ${u.role}, ${JSON.stringify(u.capabilities)}::jsonb)
            on conflict (user_id) do update set
              role = ${u.role},
              capabilities = ${JSON.stringify(u.capabilities)}::jsonb,
              active = true`
      );
    });
  } else {
    console.log(`Creating user ${u.email} (${u.role})...`);
    const created = await auth.api.signUpEmail({
      body: { email: u.email, password: u.password, name: u.name },
    });
    userId = created.user.id;
    await db.transaction(async (t) => {
      await t.execute(
        sql`insert into members(org, user_id, role, capabilities)
            values(${orgId}, ${userId}, ${u.role}, ${JSON.stringify(u.capabilities)}::jsonb)
            on conflict (user_id) do update set
              role = ${u.role},
              capabilities = ${JSON.stringify(u.capabilities)}::jsonb,
              active = true`
      );
    });
  }
  console.log(`Provisioned ${u.email} as ${u.role} (user_id: ${userId})`);
}

console.log("All requested accounts successfully configured!");
await pool.end();
