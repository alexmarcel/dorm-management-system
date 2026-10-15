import { test, expect } from "@playwright/test";
import { openDatabase, migrate } from "../../src/lib/db";
import { passwordHash } from "../../src/lib/auth";
import { uid, now } from "../../src/lib/service";
import { runtimeStorage } from "../../src/lib/control";
import sharp from "sharp";
const password = "Test-password-12345";
test.beforeAll(async () => {
  const db = openDatabase(runtimeStorage().database);
  migrate(db);
  db.prepare(
    "UPDATE app_settings SET value=1 WHERE key='require_initial_password_change'",
  ).run();
  const hash = await passwordHash(password);
  for (const name of ["warden", "secondwarden"])
    db.prepare(
      "INSERT INTO users(id,name,username,password_hash,role,must_change,created_at) VALUES (?,?,?,?,'warden',0,?)",
    ).run(
      uid(),
      name === "warden" ? "Amina Warden" : "Hafiz Warden",
      name,
      hash,
      now(),
    );
  db.close();
});
test("complete warden setup, student reporting with compressed photo, shared updates and immutable closure", async ({
  page,
  browser,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Welcome back" }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/login-desktop.png",
    fullPage: true,
  });
  await page.getByLabel("Username", { exact: true }).fill("warden");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Hello, Amina." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Locations", exact: true }).click();
  await page.getByRole("button", { name: "Add block", exact: true }).click();
  await page.getByLabel("Block name").fill("Red Block");
  await page.getByLabel(/^Code/).fill("RED");
  await page.getByRole("button", { name: "Save block" }).click();
  await page.getByRole("button", { name: "Explore levels" }).click();
  await page.getByRole("button", { name: "Add level", exact: true }).click();
  await page.getByLabel("Level name").fill("Ground Floor");
  await page.getByLabel(/^Code/).fill("G");
  await page.getByRole("button", { name: "Save level" }).click();
  await page.getByRole("button", { name: "Explore rooms" }).click();
  await page.getByRole("button", { name: "Add room", exact: true }).click();
  await page.getByLabel("Room name").fill("G-01");
  await page.getByRole("button", { name: "Save room" }).click();
  await expect(page.getByRole("heading", { name: "G-01" })).toBeVisible();
  await page
    .getByRole("link", { name: "Students", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Add student" }).click();
  await page.getByLabel("Full name").fill("Sara Student");
  await page.getByLabel("Student ID", { exact: true }).fill("S001");
  await page.getByLabel("Username", { exact: true }).fill("sara");
  await page.getByLabel("Initial password").fill(password);
  await page
    .getByRole("dialog")
    .getByLabel("Block", { exact: true })
    .selectOption({ label: "Red Block (RED)" });
  await page
    .getByRole("dialog")
    .getByLabel("Level", { exact: true })
    .selectOption({ label: "Ground Floor" });
  await page
    .getByRole("dialog")
    .getByLabel("Room", { exact: true })
    .selectOption({ label: "G-01" });
  await page.getByRole("button", { name: "Save student" }).click();
  await expect(
    page.getByRole("cell", { name: "sara", exact: true }),
  ).toBeVisible();
  const studentContext = await browser.newContext({
      baseURL: "http://localhost:3100",
    }),
    student = await studentContext.newPage();
  await student.goto("/");
  await student.getByRole("button", { name: "English", exact: true }).click();
  await student.getByLabel("Username", { exact: true }).fill("sara");
  await student.getByLabel("Password", { exact: true }).fill(password);
  await student.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    student.getByRole("heading", { name: "Choose a new password" }),
  ).toBeVisible();
  await student.getByLabel("Current password").fill(password);
  await student.getByLabel(/^New password/).fill("New-student-password-123");
  await student
    .getByLabel("Confirm new password")
    .fill("New-student-password-123");
  await student.getByRole("button", { name: "Change password" }).click();
  await expect(
    student.getByRole("heading", { name: "Hello, Sara." }),
  ).toBeVisible();
  await student
    .getByRole("link", { name: "Report a problem", exact: true })
    .click();
  await student.getByLabel("Report title").fill("Door lock is stuck");
  await student
    .getByLabel("Category", { exact: true })
    .selectOption("Locks/doors");
  await student
    .getByLabel("Description", { exact: true })
    .fill("The lock will not turn from inside the room.");
  const image = await sharp({
    create: { width: 2600, height: 1800, channels: 3, background: "#8aad98" },
  })
    .png()
    .toBuffer();
  await student
    .getByLabel("Choose photos", { exact: true })
    .setInputFiles({ name: "lock.png", mimeType: "image/png", buffer: image });
  await expect(student.getByAltText("lock.png")).toBeVisible();
  await student
    .getByRole("button", { name: "Bahasa Melayu", exact: true })
    .click();
  await expect(
    student.getByLabel("Tajuk laporan", { exact: true }),
  ).toHaveValue("Door lock is stuck");
  await expect(student.getByAltText("lock.png")).toBeVisible();
  await student.getByRole("button", { name: "English", exact: true }).click();
  expect((await student.request.get("/api/settings")).status()).toBe(403);
  expect((await page.request.get("/api/settings")).status()).toBe(403);
  await student.getByRole("button", { name: "Submit report" }).click();
  await expect(
    student.getByRole("heading", { name: "Door lock is stuck" }),
  ).toBeVisible();
  await expect(student.locator(".eyebrow")).toHaveText("RED-G-00001");
  await expect(
    student.getByAltText("Maintenance report attachment"),
  ).toBeVisible();
  const reportPath = new URL(student.url()).pathname;
  const reportId = reportPath.split("/").at(-1)!;
  const second = await browser.newContext({ baseURL: "http://localhost:3100" });
  await second.request.post("/api/login", {
    headers: { Origin: "http://localhost:3100" },
    data: { username: "secondwarden", password },
  });
  const update = await second.request.post(`/api/reports/${reportId}/events`, {
    headers: { Origin: "http://localhost:3100" },
    data: {
      message: "Maintenance is on the way.",
      status: "In progress",
      expected_status: "Submitted",
      submission_key: uid(),
      photos: [],
    },
  });
  expect(update.status()).toBe(201);
  await page.goto(reportPath);
  await expect(
    page.getByText("Maintenance is on the way.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Hafiz Warden", { exact: true })).toBeVisible();
  await page.getByLabel("Status", { exact: true }).selectOption("Closed");
  await page
    .getByLabel("Closing explanation")
    .fill("Replaced the lock and tested both keys.");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Close report permanently" }).click();
  await expect(
    page.getByText("This report is permanently closed."),
  ).toBeVisible();
  await student.reload();
  await expect(
    student.getByText("This report is permanently closed."),
  ).toBeVisible();
  expect(
    (
      await second.request.post(`/api/reports/${reportId}/events`, {
        headers: { Origin: "http://localhost:3100" },
        data: { message: "Late update", submission_key: uid() },
      })
    ).status(),
  ).toBe(409);
  const crossOrigin = await second.request.post(
    `/api/reports/${reportId}/events`,
    {
      headers: { Origin: "https://evil.invalid" },
      data: { message: "No", submission_key: uid() },
    },
  );
  expect(crossOrigin.status()).toBe(403);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Hello, Amina." }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Needs attention", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".refresh-note")).toBeVisible();
  await page.screenshot({
    path: "test-results/dashboard-desktop.png",
    fullPage: true,
  });
  await student.setViewportSize({ width: 390, height: 844 });
  await student.goto("/");
  await expect(
    student.getByRole("heading", { name: "Hello, Sara." }),
  ).toBeVisible();
  await expect(student.locator(".refresh-note")).toBeVisible();
  expect(
    await student.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await student.screenshot({
    path: "test-results/dashboard-mobile.png",
    fullPage: true,
  });
  await student.goto(reportPath);
  await expect(
    student.getByText("This report is permanently closed."),
  ).toBeVisible();
  await student.screenshot({
    path: "test-results/report-mobile.png",
    fullPage: true,
  });
  expect(
    await student.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await page.goto('/students');
  const row=page.getByRole('row').filter({has:page.getByRole('cell',{name:'sara',exact:true})});
  await expect(row).toBeVisible();
  const students=await (await page.request.get('/api/students?q=sara')).json();const studentId=students.items[0].id;
  expect((await student.request.post('/api/students/'+studentId,{headers:{Origin:'http://localhost:3100'},data:{action:'archive'}})).status()).toBe(403);
  page.once('dialog',d=>d.dismiss());await row.getByRole('button',{name:'Delete student Sara Student'}).click();await expect(row).toBeVisible();
  page.once('dialog',d=>d.accept());await row.getByRole('button',{name:'Delete student Sara Student'}).click();await expect(row).toHaveCount(0);
  expect((await student.request.get('/api/me')).status()).toBe(401);
  expect((await page.request.get('/api/reports/'+reportId)).status()).toBe(200);
  expect((await page.request.post('/api/students/'+studentId,{headers:{Origin:'http://localhost:3100'},data:{action:'reset',password:'Another-password-123'}})).status()).toBe(404);
  await page.getByRole('combobox',{name:'Account status',exact:true}).selectOption('archived');await expect(row).toBeVisible();
  await expect(row.getByRole('button',{name:'Edit Sara Student'})).toHaveCount(0);
  page.once('dialog',d=>d.accept());await row.getByRole('button',{name:'Restore Sara Student'}).click();await expect(row).toHaveCount(0);
  await page.getByRole('combobox',{name:'Account status',exact:true}).selectOption('');await expect(row).toBeVisible();
  expect((await student.request.get('/api/me')).status()).toBe(401);
  await studentContext.close();
  await second.close();
});
