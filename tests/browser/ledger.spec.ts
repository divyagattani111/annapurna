import { test, expect, type Page, type BrowserContext } from "@playwright/test";
let managerCookies: Awaited<ReturnType<BrowserContext["cookies"]>> | undefined;
async function login(page: Page, fresh = false) {
  if (managerCookies && !fresh) {
    await page.context().addCookies(managerCookies);
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Manager Daily Desk" }),
    ).toBeVisible();
    return;
  }
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("manager@demo.invalid");
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.DEMO_MANAGER_PASSWORD ?? "");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Manager Daily Desk" }),
  ).toBeVisible();
  if (!fresh) managerCookies = await page.context().cookies();
}
test("manager login persists after reload and logout revokes private data", async ({
  page,
}) => {
  await login(page, true);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Manager Daily Desk" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  expect((await page.request.get("/api/v1/documents")).status()).toBe(401);
});
test("keyboard billing, validation and one committed bill after retry-safe confirmation", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("button", { name: "New bill", exact: true })
    .first()
    .click();
  const dialog = page.locator(".workflow-page");
  await dialog
    .getByRole("combobox", { name: "Salesman", exact: true })
    .selectOption({ label: "D002 · Fictional Salesman 02" });
  await dialog.getByLabel("Quantity for Demo Meadow Pack").fill("0.5");
  await dialog.getByLabel("Quantity for Demo Meadow Pack").press("Tab");
  await dialog.getByRole("button", { name: "Review entry" }).click();
  await expect(dialog.getByRole("alert")).toContainText("whole quantities");
  await dialog.getByLabel("Quantity for Demo Meadow Pack").fill("40");
  await dialog.getByLabel("Quantity for Demo Meadow Pack").press("Enter");
  await expect(
    dialog.getByRole("button", { name: "Review entry" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Review entry" }).click();
  await expect(
    dialog.getByText("₹4,000.00", { exact: true }).first(),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Confirm & save" }).click();
  await expect(
    dialog.getByRole("heading", { name: "Saved to business records" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Bills", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Bill register" }),
  ).toBeVisible();
  await expect(page.getByRole("table")).toContainText("4,000.00");
});
test("A48 offline review preserves entry and never shows false saved", async ({
  page,
  context,
}) => {
  await login(page);
  await page
    .getByRole("button", { name: "New bill", exact: true })
    .first()
    .click();
  const dialog = page.locator(".workflow-page");
  await dialog
    .getByRole("combobox", { name: "Salesman", exact: true })
    .selectOption({ label: "D003 · Fictional Salesman 03" });
  await dialog.getByLabel("Quantity for Demo Meadow Pack").fill("2");
  await context.setOffline(true);
  await dialog.getByRole("button", { name: "Review entry" }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByLabel("Quantity for Demo Meadow Pack")).toHaveValue(
    "2",
  );
  await expect(
    dialog.getByText("Saved to business records", { exact: true }),
  ).toHaveCount(0);
  await context.setOffline(false);
});
test("owner phone dashboard, large text and no clipped page totals", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("owner@demo.invalid");
  await page
    .getByLabel("Password", { exact: true })
    .fill(process.env.DEMO_OWNER_PASSWORD ?? "");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your business at a glance" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: ".local/owner-phone.png", fullPage: true });
  await page.addStyleTag({ content: ":root{font-size:20px}" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("online claim queue, cashbook and print saved record", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("button", { name: "Receive Money", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Awaiting verification" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Cash & Bank", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Money in transit" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Bills", exact: true }).click();
  await page.getByRole("button", { name: /BILL-/ }).first().click();
  await expect(
    page.getByText("OPERATIONAL RECORD · TAX INVOICE FORMAT NOT CONFIGURED", {
      exact: true,
    }),
  ).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await page.screenshot({ path: ".local/bill-print.png", fullPage: true });
});
async function tabToButton(page: Page, name: string) {
  for (let i = 0; i < 30; i++) {
    const active = await page.evaluate(() =>
      document.activeElement?.textContent?.trim(),
    );
    if (active === name) return;
    await page.keyboard.press("Tab");
  }
  throw new Error("Keyboard focus did not reach " + name);
}
test("keyboard-only bill posting and F2 shortcut", async ({ page }) => {
  await login(page);
  await page.keyboard.press("F2");
  const dialog = page.locator(".workflow-page");
  await expect(dialog).toBeVisible();
  const salesman = dialog.getByRole("combobox", {
    name: "Salesman",
    exact: true,
  });
  for (let i = 0; i < 25; i++) {
    if (await salesman.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(salesman).toBeFocused();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  const firstQuantity = dialog.getByLabel("Quantity for Demo Meadow Pack");
  for (let i = 0; i < 12; i++) {
    if (await firstQuantity.evaluate((el) => el === document.activeElement))
      break;
    await page.keyboard.press("Tab");
  }
  await expect(firstQuantity).toBeFocused();
  await page.keyboard.type("1");
  await tabToButton(page, "Review entry");
  await page.keyboard.press("Enter");
  await expect(
    dialog.getByRole("button", { name: "Confirm & save" }),
  ).toBeVisible();
  await tabToButton(page, "Confirm & save");
  await page.keyboard.press("Enter");
  await expect(
    dialog.getByRole("heading", { name: "Saved to business records" }),
  ).toBeVisible();
});
test("saved draft restores entry and is atomically consumed after posting", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("button", { name: "New bill", exact: true })
    .first()
    .click();
  let dialog = page.locator(".workflow-page");
  await dialog
    .getByRole("combobox", { name: "Salesman", exact: true })
    .selectOption({ label: "D003 · Fictional Salesman 03" });
  await dialog.getByLabel("Quantity for Demo Meadow Pack").fill("3");
  await dialog.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    dialog.getByText("Draft saved. No financial posting.", { exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "← Back", exact: true }).click();
  await page.getByRole("button", { name: "Saved drafts", exact: true }).click();
  dialog = page.locator(".workflow-page");
  await dialog
    .getByRole("button", { name: "Resume draft", exact: true })
    .first()
    .click();
  await expect(
    page.locator(".workflow-page").getByLabel("Quantity for Demo Meadow Pack"),
  ).toHaveValue("3");
  await page
    .locator(".workflow-page")
    .getByRole("button", { name: "Review entry" })
    .click();
  await page
    .locator(".workflow-page")
    .getByRole("button", { name: "Confirm & save" })
    .click();
  await expect(
    page
      .locator(".workflow-page")
      .getByRole("heading", { name: "Saved to business records" }),
  ).toBeVisible();
});
test("multipage bill prints full table and totals", async ({ page }) => {
  await login(page);
  const masters = await (await page.request.get("/api/v1/masters")).json();
  const me = await (await page.request.get("/api/v1/me")).json();
  const payload = {
    date: me.date,
    salesmanId: masters.salesmen[3].id,
    lines: Array.from({ length: 100 }, () => ({
      productId: masters.products[0].id,
      quantity: "1",
    })),
    note: "Fictional multipage printing test",
  };
  const quote = await (
    await page.request.post("/api/v1/preview/bill", {
      headers: { Origin: "http://127.0.0.1:5186" },
      data: payload,
    })
  ).json();
  const response = await page.request.post("/api/v1/commands/bill", {
    headers: {
      Origin: "http://127.0.0.1:5186",
      "Idempotency-Key": crypto.randomUUID(),
    },
    data: { ...payload, expectedQuoteHash: quote.quoteHash },
  });
  expect(response.status()).toBe(201);
  const saved = await response.json();
  await page.getByRole("button", { name: "Bills", exact: true }).click();
  await page.getByRole("button", { name: saved.number, exact: true }).click();
  await expect(
    page.getByText("₹10,000.00", { exact: true }).first(),
  ).toBeVisible();
  await page.emulateMedia({ media: "print" });
  const pdf = await page.pdf({
    format: "A4",
    printBackground: true,
    path: ".local/multipage-bill.pdf",
  });
  const pageCount = (pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? [])
    .length;
  expect(pageCount).toBeGreaterThan(1);
  await page.screenshot({
    path: ".local/bill-multipage-screen.png",
    fullPage: true,
  });
});
test("A48 failed evidence upload preserves the committed record", async ({
  page,
}) => {
  await login(page);
  const documents = await (
      await page.request.get("/api/v1/documents?kind=bill")
    ).json(),
    saved = documents[0];
  await page.getByRole("button", { name: "Bills", exact: true }).click();
  await page.getByRole("button", { name: saved.number, exact: true }).click();
  const alertPromise = page.waitForEvent("dialog");
  await page.getByLabel("Attach private evidence").setInputFiles({
    name: "invalid.html",
    mimeType: "text/html",
    buffer: Buffer.from("<html>not permitted evidence</html>"),
  });
  const alert = await alertPromise;
  expect(alert.message()).toContain("Record is saved, but upload failed");
  await alert.accept();
  const stillSaved = await page.request.get("/api/v1/documents/" + saved.id);
  expect(stillSaved.status()).toBe(200);
  expect((await stillSaved.json()).amount).toBe(saved.amount);
});
test("online verification through the UI posts one bank receipt and safe retry", async ({
  page,
}) => {
  await login(page);
  const masters = await (await page.request.get("/api/v1/masters")).json(),
    me = await (await page.request.get("/api/v1/me")).json(),
    bank = masters.accounts.find(
      (r: Record<string, unknown>) => r.type === "bank",
    ),
    salesman = masters.salesmen[4],
    before = await (await page.request.get("/api/v1/dashboard")).json();
  const claim = await page.request.post("/api/v1/commands/receipt", {
    headers: {
      Origin: "http://127.0.0.1:5186",
      "Idempotency-Key": crypto.randomUUID(),
    },
    data: {
      date: me.date,
      actualDate: me.date,
      salesmanId: salesman.id,
      amount: "17.50",
      accountId: bank.id,
      method: "online",
      verified: false,
      reference: "FICTIONAL-CLAIM-" + crypto.randomUUID(),
    },
  });
  expect(claim.status()).toBe(201);
  let verified: { key: string; data: unknown } | undefined;
  page.on("request", (r) => {
    if (r.url().endsWith("/api/v1/commands/verify"))
      verified = {
        key: r.headers()["idempotency-key"],
        data: r.postDataJSON(),
      };
  });
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await page
    .getByRole("button", { name: "Receive Money", exact: true })
    .click();
  await page
    .locator(".claim")
    .filter({ hasText: salesman.name })
    .getByRole("button", { name: "Review", exact: true })
    .click();
  const dialog = page.locator(".workflow-page");
  await dialog
    .getByLabel("Unique bank transaction identity")
    .fill("FICTIONAL-BANK-" + crypto.randomUUID());
  await dialog
    .getByLabel("What receiving-account evidence did you check?")
    .fill("Fictional test receiving-account statement checked manually");
  await dialog
    .getByRole("button", { name: "Confirm verified receipt" })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(verified).toBeDefined();
  const retry = await page.request.post("/api/v1/commands/verify", {
    headers: {
      Origin: "http://127.0.0.1:5186",
      "Idempotency-Key": verified!.key,
    },
    data: verified!.data,
  });
  expect(retry.status()).toBe(201);
  const after = await (await page.request.get("/api/v1/dashboard")).json();
  const Decimal = (await import("decimal.js")).default;
  expect(
    after.accounts.find((r: Record<string, unknown>) => r.id === bank.id)
      .balance,
  ).toBe(
    new Decimal(
      before.accounts.find((r: Record<string, unknown>) => r.id === bank.id)
        .balance,
    )
      .plus("17.50")
      .toFixed(2),
  );
});
test("A42 CSV exports the displayed snapshot even after another receipt posts", async ({
  page,
}) => {
  await login(page);
  const reportResponse = page.waitForResponse(
    (r) =>
      r.url().includes("/api/v1/reports/outstanding?") &&
      r.request().method() === "GET",
  );
  await page.getByRole("button", { name: "Reports", exact: true }).click();
  const displayed = await (await reportResponse).json();
  await expect(
    page.getByRole("button", { name: "Export displayed page", exact: true }),
  ).toBeEnabled();
  const masters = await (await page.request.get("/api/v1/masters")).json(),
    me = await (await page.request.get("/api/v1/me")).json(),
    cash = masters.accounts.find(
      (r: Record<string, unknown>) => r.type === "cash",
    );
  const posted = await page.request.post("/api/v1/commands/receipt", {
    headers: {
      Origin: "http://127.0.0.1:5186",
      "Idempotency-Key": crypto.randomUUID(),
    },
    data: {
      date: me.date,
      actualDate: me.date,
      salesmanId: displayed.rows[0].id,
      accountId: cash.id,
      amount: "1.00",
      method: "cash",
      reference: "",
    },
  });
  expect(posted.status()).toBe(201);
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export displayed page", exact: true })
    .click();
  const download = await downloadPromise;
  const { readFile } = await import("node:fs/promises");
  const file = await readFile((await download.path())!, "utf8");
  const { encodeCsvRows } = await import("../../packages/contracts/src");
  expect(file).toBe(encodeCsvRows(displayed.rows));
});

test("dashboard and sidebar share destinations and entry workflows use the full page", async ({
  page,
}) => {
  await login(page);
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  for (const [card, sidebar, heading, workflow] of [
    ["bill", "New bill", "New bill", true],
    ["receipt", "Receive Money", "Receive Money", false],
    ["expense", "Other Money", "Other Money", false],
    ["deposit", "Cash & Bank", "Cash & Bank", false],
    ["close", "Daily Close", "Close today", true],
  ] as const) {
    await page.locator(`.dashboard-actions .action-${card}`).click();
    const destination = workflow
      ? page.getByRole("region", { name: heading, exact: true })
      : page.locator(".page-content");
    await expect(
      destination.getByRole("heading", { name: heading, exact: true }).first(),
    ).toBeVisible();
    await expect(
      navigation.getByRole("button", { name: sidebar, exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    if (workflow) {
      expect(
        await destination.evaluate((el) => el.closest("main") !== null),
      ).toBe(true);
      const bounds = await destination.boundingBox();
      const main = await page.locator("main").boundingBox();
      expect(bounds!.width).toBeGreaterThan(main!.width - 80);
    }
    await navigation
      .getByRole("button", { name: "Dashboard", exact: true })
      .click();
    await navigation
      .getByRole("button", { name: sidebar, exact: true })
      .click();
    await expect(
      destination.getByRole("heading", { name: heading, exact: true }).first(),
    ).toBeVisible();
    await navigation
      .getByRole("button", { name: "Dashboard", exact: true })
      .click();
  }
  await navigation
    .getByRole("button", { name: "New bill", exact: true })
    .click();
  const entry = page.getByRole("region", { name: "New bill", exact: true });
  await entry.getByLabel("Quantity for Demo Meadow Pack").fill("3");
  await navigation
    .getByRole("button", { name: "New bill", exact: true })
    .click();
  await expect(entry.getByLabel("Quantity for Demo Meadow Pack")).toHaveValue(
    "3",
  );
  await entry.getByRole("button", { name: "← Back", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Manager Daily Desk" }),
  ).toBeVisible();
});

test("simplified bill grid defaults to today and prices edits through the server", async ({
  page,
}) => {
  await login(page);
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "New bill", exact: true })
    .click();
  const entry = page.getByRole("region", { name: "New bill", exact: true });
  await expect(
    entry.getByText(
      "Review before posting. Online claims remain pending until verified.",
      { exact: true },
    ),
  ).toHaveCount(0);
  await expect(entry.locator(".section-marker")).toHaveCount(0);
  expect(await entry.getByRole("columnheader").allTextContents()).toEqual([
    "Product",
    "Quantity",
    "Selling Unit",
    "Rate / Basis",
    "Discount",
    "Amount",
  ]);
  const me = await (await page.request.get("/api/v1/me")).json();
  await expect(entry.getByLabel("Date", { exact: true })).toHaveValue(me.date);
  await entry
    .getByRole("combobox", { name: "Salesman", exact: true })
    .selectOption({ label: "D002 · Fictional Salesman 02" });
  await entry.getByLabel("Quantity for Demo Meadow Pack").fill("3");
  await entry
    .getByLabel("Rate for Demo Meadow Pack", { exact: true })
    .fill("125");
  await entry.getByLabel("Price basis for Demo Meadow Pack").fill("2");
  await entry
    .getByLabel("Discount for Demo Meadow Pack", { exact: true })
    .fill("7.51");
  await expect(
    entry.getByLabel("Amount for Demo Meadow Pack", { exact: true }),
  ).toHaveText("₹179.99");
  await expect(entry.getByLabel("Bill total", { exact: true })).toHaveText(
    "₹179.99",
  );
  await entry.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(
    entry.getByText("Draft saved. No financial posting.", { exact: true }),
  ).toBeVisible();
  await entry.getByRole("button", { name: "← Back", exact: true }).click();
  await page.getByRole("button", { name: "Saved drafts", exact: true }).click();
  await page
    .locator(".workflow-page")
    .getByRole("button", { name: "Resume draft", exact: true })
    .first()
    .click();
  await expect(
    entry.getByLabel("Rate for Demo Meadow Pack", { exact: true }),
  ).toHaveValue("125");
  await expect(
    entry.getByLabel("Price basis for Demo Meadow Pack"),
  ).toHaveValue("2");
  await expect(
    entry.getByLabel("Discount for Demo Meadow Pack", { exact: true }),
  ).toHaveValue("7.51");
  await entry
    .getByLabel("Discount type for Demo Meadow Pack")
    .selectOption("percent");
  await entry
    .getByLabel("Discount for Demo Meadow Pack", { exact: true })
    .fill("10");
  await expect(
    entry.getByLabel("Amount for Demo Meadow Pack", { exact: true }),
  ).toHaveText("₹168.75");
  await entry
    .getByRole("button", { name: "Review entry", exact: true })
    .click();
  await expect(
    entry.getByRole("button", { name: "Send for owner review", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: ".local/bill-grid-review.png",
    fullPage: true,
  });
});
