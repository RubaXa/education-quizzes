import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  use: { baseURL: 'http://127.0.0.1:4179/education-quizzes/', ...devices['Desktop Chrome'], launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}  },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 4179 --strictPort', url: 'http://127.0.0.1:4179/education-quizzes/', reuseExistingServer: false, timeout: 120_000 },
})
