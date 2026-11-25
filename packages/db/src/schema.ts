import {
  pgTable,
  text,
  uuid,
  boolean,
  timestamp,
  date,
  numeric,
  jsonb,
  integer,
  uniqueIndex,
  index,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
const id = () => uuid("id").primaryKey().defaultRandom();
const stamp = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  mode: text("mode").notNull(),
  setup: jsonb("setup").notNull().default({}),
  createdAt: stamp(),
});
export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("emailVerified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
});
export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expiresAt").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  userId: text("userId")
    .notNull()
    .references(() => user.id),
});
export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  userId: text("userId")
    .notNull()
    .references(() => user.id),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  idToken: text("idToken"),
  accessTokenExpiresAt: timestamp("accessTokenExpiresAt"),
  refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("createdAt").notNull().defaultNow(),
  updatedAt: timestamp("updatedAt").notNull().defaultNow(),
});
export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expiresAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow(),
  updatedAt: timestamp("updatedAt").defaultNow(),
});
export const members = pgTable("members", {
  id: id(),
  org: uuid("org")
    .notNull()
    .references(() => organizations.id),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => user.id),
  role: text("role").notNull(),
  active: boolean("active").notNull().default(true),
  capabilities: jsonb("capabilities").notNull().default({}),
});
export const salesmen = pgTable(
  "salesmen",
  {
    id: id(),
    org: uuid("org")
      .notNull()
      .references(() => organizations.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    creditLimit: numeric("credit_limit", { precision: 18, scale: 2 }),
    details: jsonb("details").notNull().default({}),
    itcId: text("itc_id"),
    beatCode: text("beat_code"),
    beatName: text("beat_name"),
    route: text("route"),
    phone: text("phone"),
  },
  (t) => [uniqueIndex("salesman_code").on(t.org, t.code)],
);
export const products = pgTable(
  "products",
  {
    id: id(),
    org: uuid("org")
      .notNull()
      .references(() => organizations.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    barcode: text("barcode"),
    category: text("category").notNull().default("CG-01 CIGARETTE"),
    active: boolean("active").notNull().default(true),
    itcMultiple: numeric("itc_multiple", { precision: 10, scale: 2 }),
    isFocusBrand: boolean("is_focus_brand").notNull().default(false),
  },
  (t) => [uniqueIndex("product_code").on(t.org, t.code)],
);
export const configurations = pgTable("product_configurations", {
  id: id(),
  org: uuid("org")
    .notNull()
    .references(() => organizations.id),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id),
  effectiveDate: date("effective_date").notNull(),
  unit: text("unit").notNull(),
  baseUnit: text("base_unit").notNull(),
  conversion: numeric("conversion", { precision: 24, scale: 8 }).notNull(),
  basis: numeric("basis", { precision: 24, scale: 8 }).notNull(),
  rate: numeric("rate", { precision: 24, scale: 8 }).notNull(),
  fractional: boolean("fractional").notNull().default(false),
  confirmed: boolean("confirmed").notNull().default(false),
  createdAt: stamp(),
});
export const moneyAccounts = pgTable("money_accounts", {
  id: id(),
  org: uuid("org")
    .notNull()
    .references(() => organizations.id),
  name: text("name").notNull(),
  type: text("type").notNull(),
  holder: text("holder").notNull(),
  active: boolean("active").notNull().default(true),
  allowOverdraft: boolean("allow_overdraft").notNull().default(false),
  details: jsonb("details").notNull().default({}),
});
export const documents = pgTable(
  "documents",
  {
    id: id(),
    org: uuid("org")
      .notNull()
      .references(() => organizations.id),
    number: text("number").notNull(),
    kind: text("kind").notNull(),
    businessDate: date("business_date").notNull(),
    actualDate: date("actual_date"),
    salesmanId: uuid("salesman_id").references(() => salesmen.id),
    amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
    data: jsonb("data").notNull(),
    actor: text("actor")
      .notNull()
      .references(() => user.id),
    reverses: uuid("reverses"),
    customerId: uuid("customer_id").references((): AnyPgColumn => itcCustomers.id),
    returnLineId: uuid("return_line_id").references((): AnyPgColumn => billLines.id),
    employeeId: uuid("employee_id").references((): AnyPgColumn => employees.id),
    foodsSalesmanId: uuid("foods_salesman_id").references((): AnyPgColumn => foodsSalesmen.id),
    createdAt: stamp(),
  },
  (t) => [
    uniqueIndex("document_number").on(t.org, t.number),
    uniqueIndex("one_reversal").on(t.org, t.reverses),
    index("documents_customer_id_idx").on(t.org, t.customerId),
    index("documents_return_line_id_idx").on(t.org, t.returnLineId),
    index("documents_kind_date_idx").on(t.org, t.kind, t.businessDate),
    index("documents_employee_id_idx").on(t.org, t.employeeId),
    index("documents_foods_salesman_id_idx").on(t.org, t.foodsSalesmanId),
  ],
);
export const billLines = pgTable("bill_lines", {
  id: id(),
  org: uuid("org")
    .notNull()
    .references(() => organizations.id),
  documentId: uuid("document_id")
    .notNull()
    .references(() => documents.id),
  productId: uuid("product_id")
    .references(() => products.id),
  quantity: numeric("quantity", { precision: 24, scale: 8 }).notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  snapshot: jsonb("snapshot").notNull(),
});
export const journal = pgTable("journal", {
  id: id(),
  org: uuid("org")
    .notNull()
    .references(() => organizations.id),
  documentId: uuid("document_id")
    .notNull()
    .references(() => documents.id),
  account: text("account").notNull(),
  debit: numeric("debit", { precision: 18, scale: 2 }).notNull().default("0"),
  credit: numeric("credit", { precision: 18, scale: 2 }).notNull().default("0"),
});
export const receiptClaims = pgTable("receipt_claims", {
  id: id(),
  org: uuid("org")
    .notNull()
    .references(() => organizations.id),
  salesmanId: uuid("salesman_id")
    .references(() => salesmen.id),
  foodsSalesmanId: uuid("foods_salesman_id")
    .references((): AnyPgColumn => foodsSalesmen.id),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => moneyAccounts.id),
  actualDate: date("actual_date").notNull(),
  reference: text("reference").notNull(),
  state: text("state").notNull().default("pending"),
  documentId: uuid("document_id").references(() => documents.id),
  reason: text("reason"),
  actor: text("actor")
    .notNull()
    .references(() => user.id),
  createdAt: stamp(),
});
export const bankIdentities = pgTable(
  "bank_identities",
  {
    id: id(),
    org: uuid("org")
      .notNull()
      .references(() => organizations.id),
    accountId: uuid("account_id")
      .notNull()
      .references(() => moneyAccounts.id),
    identity: text("identity").notNull(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
  },
  (t) => [uniqueIndex("bank_credit_once").on(t.org, t.accountId, t.identity)],
);
export const allocations = pgTable("allocations", {
  id: id(),
  org: uuid("org")
    .notNull()
    .references(() => organizations.id),
  salesmanId: uuid("salesman_id")
    .notNull()
    .references(() => salesmen.id),
  generation: uuid("generation").notNull(),
  creditId: uuid("credit_id")
    .notNull()
    .references(() => documents.id),
  chargeId: uuid("charge_id")
    .notNull()
    .references(() => documents.id),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  createdAt: stamp(),
});
export const allocationHeads = pgTable("allocation_heads", {
  salesmanId: uuid("salesman_id")
    .primaryKey()
    .references(() => salesmen.id),
  org: uuid("org")
    .notNull()
    .references(() => organizations.id),
  generation: uuid("generation").notNull(),
});
export const audit = pgTable("audit", {
  id: id(),
  org: uuid("org")
    .notNull()
    .references(() => organizations.id),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  target: text("target").notNull(),
  data: jsonb("data").notNull(),
  createdAt: stamp(),
});
export const idempotency = pgTable(
  "idempotency",
  {
    id: id(),
    org: uuid("org")
      .notNull()
      .references(() => organizations.id),
    key: text("key").notNull(),
    hash: text("hash").notNull(),
    result: jsonb("result").notNull(),
    createdAt: stamp(),
  },
  (t) => [uniqueIndex("command_once").on(t.org, t.key)],
);
export const closes = pgTable("closes", {
  id: id(),
  org: uuid("org")
    .notNull()
    .references(() => organizations.id),
  date: date("date").notNull(),
  accountId: uuid("account_id")
    .notNull()
    .references(() => moneyAccounts.id),
  expected: numeric("expected", { precision: 18, scale: 2 }).notNull(),
  counted: numeric("counted", { precision: 18, scale: 2 }).notNull(),
  difference: numeric("difference", { precision: 18, scale: 2 }).notNull(),
  reason: text("reason").notNull(),
  state: text("state").notNull(),
  actor: text("actor").notNull(),
  createdAt: stamp(),
});
export const periods = pgTable(
  "periods",
  {
    id: id(),
    org: uuid("org")
      .notNull()
      .references(() => organizations.id),
    date: date("date").notNull(),
    closed: boolean("closed").notNull().default(false),
  },
  (t) => [uniqueIndex("period_once").on(t.org, t.date)],
);
export const reconciliations = pgTable("reconciliations", {
  id: id(),
  org: uuid("org")
    .notNull()
    .references(() => organizations.id),
  accountId: uuid("account_id")
    .notNull()
    .references(() => moneyAccounts.id),
  date: date("date").notNull(),
  statement: numeric("statement", { precision: 18, scale: 2 }).notNull(),
  book: numeric("book", { precision: 18, scale: 2 }).notNull(),
  matches: jsonb("matches").notNull(),
  state: text("state").notNull().default("active"),
  actor: text("actor").notNull(),
  createdAt: stamp(),
});
export const drafts = pgTable("drafts", {
  id: id(),
  org: uuid("org")
    .notNull()
    .references(() => organizations.id),
  actor: text("actor").notNull(),
  version: integer("version").notNull().default(1),
  data: jsonb("data").notNull(),
  createdAt: stamp(),
});
export const attachments = pgTable("attachments", {
  id: id(),
  org: uuid("org")
    .notNull()
    .references(() => organizations.id),
  documentId: uuid("document_id")
    .notNull()
    .references(() => documents.id),
  key: text("key").notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  hash: text("hash").notNull(),
  actor: text("actor").notNull(),
  createdAt: stamp(),
});
export const requests = pgTable("requests", {
  id: id(),
  org: uuid("org")
    .notNull()
    .references(() => organizations.id),
  actor: text("actor").notNull(),
  payload: jsonb("payload").notNull(),
  state: text("state").notNull().default("pending"),
  reason: text("reason").notNull(),
  createdAt: stamp(),
});
export const itcCustomers = pgTable(
  "itc_customers",
  {
    id: id(),
    org: uuid("org")
      .notNull()
      .references(() => organizations.id),
    customerId: text("customer_id").notNull(),
    customerName: text("customer_name").notNull(),
    salesmanItcId: text("salesman_itc_id").notNull(),
    salesmanName: text("salesman_name").notNull(),
    beatCode: text("beat_code").notNull(),
    beatName: text("beat_name").notNull(),
    salesmanId: uuid("salesman_id").references(() => salesmen.id),
    active: boolean("active").notNull().default(true),
    isGst: boolean("is_gst").notNull().default(false),
    createdAt: stamp(),
  },
  (t) => [
    uniqueIndex("itc_customer_id_org").on(t.org, t.customerId),
  ],
);
export const cashHandovers = pgTable("cash_handovers", {
  id: id(),
  org: uuid("org")
    .notNull()
    .references(() => organizations.id),
  salesmanId: uuid("salesman_id")
    .notNull()
    .references(() => salesmen.id),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  acceptedAmount: numeric("accepted_amount", { precision: 18, scale: 2 }),
  date: date("date").notNull(),
  status: text("status").notNull().default("pending"),
  salesmanNote: text("salesman_note"),
  managerNote: text("manager_note"),
  documentId: uuid("document_id").references(() => documents.id),
  actor: text("actor")
    .notNull()
    .references(() => user.id),
  verifiedBy: text("verified_by").references(() => user.id),
  createdAt: stamp(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
});

export const employees = pgTable("employees", {
  id: id(),
  org: uuid("org").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  role: text("role").notNull().default(""),
  phone: text("phone"),
  active: boolean("active").notNull().default(true),
  createdAt: stamp(),
});

export const foodsSalesmen = pgTable("foods_salesmen", {
  id: id(),
  org: uuid("org").notNull().references(() => organizations.id),
  name: text("name").notNull(),
  territory: text("territory"),
  phone: text("phone"),
  active: boolean("active").notNull().default(true),
  createdAt: stamp(),
});

export const productPackPcs = pgTable(
  "product_pack_pcs",
  {
    id: id(),
    org: uuid("org").notNull().references(() => organizations.id),
    productId: uuid("product_id").notNull().references(() => products.id),
    pcsPerPack: integer("pcs_per_pack").notNull().default(100),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("pack_pcs_product").on(t.org, t.productId)],
);
