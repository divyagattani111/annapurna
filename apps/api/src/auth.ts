import { betterAuth } from "better-auth";
import { pool } from "@ledger/db";
if (
  !process.env.BETTER_AUTH_SECRET ||
  process.env.BETTER_AUTH_SECRET.length < 32
)
  throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters");
export const auth = betterAuth({
  database: pool,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.AUTH_BASE_URL ?? "http://localhost:5173",
  basePath: "/api/v1/auth",
  trustedOrigins: [process.env.APP_ORIGIN ?? "http://localhost:5173"],
  emailAndPassword: { enabled: true, minPasswordLength: 4 },
  session: {
    expiresIn: 60 * 60 * 12,
    updateAge: 60 * 30,
    cookieCache: { enabled: false },
  },
  advanced: {
    useSecureCookies: process.env.COOKIE_SECURE !== "false",
    ipAddress: {
      ipAddressHeaders:
        process.env.TRUST_PROXY_HEADER === "true" ? ["x-ledger-client-ip"] : [],
    },
  },
  telemetry: { enabled: false },
  rateLimit: { enabled: true, window: 60, max: 20 },
});
