import { test, expect, request } from "@playwright/test";
test("Malay default, persistent drafts, superadmin settings, CSV, authorization and supervised restore", async ({
  page,
}) => {
  test.setTimeout(150000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "ms");
  await page.getByLabel("Nama pengguna", { exact: true }).fill("testadmin");
  await page
    .getByLabel("Kata laluan", { exact: true })
    .fill("TestAdminPassword123");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(page.getByLabel("Username", { exact: true })).toHaveValue(
    "testadmin",
  );
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue(
    "TestAdminPassword123",
  );
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Current password").fill("TestAdminPassword123");
  await page.getByLabel(/^New password/).fill("ChangedAdminPassword123");
  await page.getByLabel("Confirm new password").fill("ChangedAdminPassword123");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(
    page.getByRole("heading", { name: "Settings and administration" }),
  ).toBeVisible();
  for (const route of [
    "reports",
    "reports/arbitrary",
    "photos/arbitrary",
    "locations",
    "students",
    "dashboard",
    "notifications",
  ])
    expect((await page.request.get("/api/" + route)).status()).toBe(403);
  page.on("dialog", (d) => d.accept());
  const policy = page.getByLabel("Require password change on first login", {
    exact: true,
  });
  await expect(policy).toBeChecked();
  await policy.uncheck();
  await expect(page.getByText("Password-change policy saved.")).toBeVisible();
  await page.reload();
  await expect(policy).not.toBeChecked();
  await page.getByRole("button", { name: "Add warden" }).click();
  await page.getByLabel("Full name").fill("Settings Warden");
  await page.getByLabel("Username", { exact: true }).fill("settingswarden");
  await page.getByLabel("Temporary password").fill("WardenTemporary123");
  await page.getByRole("button", { name: "Save warden" }).click();
  await expect(
    page.getByRole("cell", { name: "settingswarden", exact: true }),
  ).toBeVisible();
  const other = await request.newContext({
    baseURL: "http://localhost:3100",
    extraHTTPHeaders: { Origin: "http://localhost:3100" },
  });
  const login = await other.post("/api/login", {
    data: { username: "settingswarden", password: "WardenTemporary123" },
  });
  expect((await login.json()).user.must_change).toBe(0);
  expect(
    (
      await other.post("/api/settings/security", {
        data: { requireInitialPasswordChange: true },
      })
    ).status(),
  ).toBe(403);
  const manual = await other.post("/api/students", {
    data: {
      name: "Manual Policy Student",
      username: "manualpolicy",
      student_id: "MANUALPOLICY",
      password: "ManualPolicyPassword123",
      active: true,
      room_id: null,
    },
  });
  expect(manual.ok()).toBeTruthy();
  const students = await (await other.get("/api/students")).json();
  expect(
    students.items.find(
      (s: { username: string }) => s.username === "manualpolicy",
    ).must_change,
  ).toBe(0);
  await other.dispose();
  await policy.check();
  await expect(page.getByText("Password-change policy saved.")).toBeVisible();
  await page.getByRole("button", { name: "Archive account" }).click();
  await page.getByLabel("Show archived").check();
  await expect(
    page.getByRole("cell", { name: "settingswarden", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Restore account" }).click();
  await page.getByLabel("Show archived").uncheck();
  await expect(
    page.getByRole("cell", { name: "settingswarden", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Student CSV Import" }).click();
  await page.getByLabel("Choose CSV").setInputFiles({
    name: "students.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      'fullname,username,password,phone number,email\n"Imported, Student",csvstudent,TemporaryStudent123,0123456789,student@example.com',
    ),
  });
  await page.getByRole("button", { name: "Validate CSV", exact: true }).click();
  await expect(
    page.getByRole("cell", { name: "CSVSTUDENT", exact: true }),
  ).toBeVisible();
  expect(await page.locator("body").innerText()).not.toContain(
    "TemporaryStudent123",
  );
  await page.screenshot({path:'test-results/settings-csv-desktop.png',fullPage:true});
  await page.getByRole("button", { name: "Confirm import" }).click();
  await expect(page.getByText("1 students imported.")).toBeVisible();
  await page
    .getByRole("button", { name: "Bahasa Melayu", exact: true })
    .click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "ms");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("cell", { name: "settingswarden", exact: true }),
  ).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  const filterInset=await page.locator('.filter-row').evaluate(el=>{
    const panel=el.closest('.panel')!.getBoundingClientRect();
    const field=el.querySelector('label')!.getBoundingClientRect();
    return field.left-panel.left;
  });
  expect(filterInset).toBeGreaterThanOrEqual(16);
  await page.screenshot({
    path: "test-results/settings-malay-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("tab", { name: "Backup and Restore" }).click();
  await page.getByRole("button", { name: "Create backup" }).click();
  await expect(async () => {
    await page.reload();
    await page.getByRole("tab", { name: "Backup and Restore" }).click();
    await expect(
      page.getByRole("link", { name: "Download", exact: true }),
    ).toBeVisible();
  }).toPass({ timeout: 30000 });
  const url = await page
    .getByRole("link", { name: "Download", exact: true })
    .getAttribute("href");
  const download = await page.request.get(url!);
  expect(download.ok()).toBeTruthy();
  await page.getByLabel("Upload backup", { exact: true }).setInputFiles({
    name: "backup.tar.gz",
    mimeType: "application/gzip",
    buffer: await download.body(),
  });
  await page
    .getByRole("button", { name: "Validate backup", exact: true })
    .click();
  await expect(async () => {
    await page.reload();
    await page.getByRole("tab", { name: "Backup and Restore" }).click();
    await expect(
      page.getByRole("button", { name: "Restore this backup" }),
    ).toBeVisible();
  }).toPass({ timeout: 30000 });
  await page.screenshot({
    path: "test-results/settings-backup-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Restore this backup" }).click();
  await page.getByLabel("Current password").fill("ChangedAdminPassword123");
  await page.getByRole("dialog").getByRole("checkbox").check();
  await page
    .getByRole("button", { name: "Start restore", exact: true })
    .click();
  await expect(async () => {
    const r = await page.request.get("/api/me");
    expect(r.status()).toBe(401);
  }).toPass({ timeout: 60000 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await page.getByLabel("Username", { exact: true }).fill("testadmin");
  await page
    .getByLabel("Password", { exact: true })
    .fill("ChangedAdminPassword123");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Settings and administration" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
