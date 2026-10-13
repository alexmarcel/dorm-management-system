import { defineConfig } from "@playwright/test";
import path from "node:path";
const run = process.env.PAINI_TEST_RUN || String(Date.now());
process.env.PAINI_TEST_RUN = run;
process.env.DATABASE_PATH = path.resolve(`data/e2e-${run}.db`);
process.env.UPLOAD_DIR = path.resolve(`data/e2e-photos-${run}`);
process.env.APP_ORIGIN = "http://localhost:3100";
process.env.CONTROL_DIR = path.resolve(`data/e2e-control-${run}`);
process.env.PAINI_SUPERADMIN_USERNAME = "testadmin";
process.env.PAINI_SUPERADMIN_PASSWORD = "TestAdminPassword123";
export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 90000,
  use: {
    actionTimeout: 15000,
    baseURL: "http://localhost:3100",
    headless: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev -- --port 3100",
    url: "http://localhost:3100",
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      DATABASE_PATH: process.env.DATABASE_PATH,
      UPLOAD_DIR: process.env.UPLOAD_DIR,
      APP_ORIGIN: process.env.APP_ORIGIN,
      CONTROL_DIR: process.env.CONTROL_DIR,
      PAINI_SUPERADMIN_USERNAME: process.env.PAINI_SUPERADMIN_USERNAME,
      PAINI_SUPERADMIN_PASSWORD: process.env.PAINI_SUPERADMIN_PASSWORD,
    },
  },
});
