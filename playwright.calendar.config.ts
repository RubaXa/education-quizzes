// @see docs/modules/school-diary/school-calendar.md#представление
// @see docs/decisions/calendar-scroll-selection-2026-10-28.md
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/calendar.e2e.ts',
  outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? '/tmp/education-quizzes-playwright-results',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4179/',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'vite --config vite.e2e.config.ts --host 127.0.0.1 --port 4179 --strictPort',
    url: 'http://127.0.0.1:4179/e2e/calendar.html',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
})
