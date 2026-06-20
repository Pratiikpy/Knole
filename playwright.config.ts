import { defineConfig, devices } from "@playwright/test";

// E2E harness. Runs against the deployed app by default (the seeded read-only demo); point it at a
// local dev server with E2E_BASE_URL=http://localhost:3000 to exercise write flows. Timeouts are
// generous because the serverless function cold-starts and the local embedding model warms up.
const BASE_URL = process.env.E2E_BASE_URL ?? "https://knole-app.vercel.app";

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false, // deterministic against the shared demo
  retries: process.env.CI ? 1 : 0, // a failure is a real signal, not retried away locally
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 20_000,
    navigationTimeout: 60_000,
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    // Pixel 7 is a chromium-based mobile profile (~412px, touch) — real mobile emulation without a
    // separate WebKit install. iPhone devices default to WebKit, which we don't ship in this harness.
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
