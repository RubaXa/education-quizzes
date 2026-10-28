// @see docs/modules/school-diary/school-calendar.md#представление
// @see docs/decisions/calendar-scroll-selection-2026-10-28.md
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const root = fileURLToPath(new URL('.', import.meta.url))
const mock = (name: string) => fileURLToPath(new URL(`./e2e/mocks/${name}.ts`, import.meta.url))

export default defineConfig({
  root,
  base: '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: '@/lib/dayStore', replacement: mock('dayStore') },
      { find: '@/lib/dayDashboardStore', replacement: mock('dayDashboardStore') },
      { find: '@/lib/dayDashboardLessonCache', replacement: mock('dayDashboardLessonCache') },
      { find: '@/lib/dayDashboardViewCache', replacement: mock('dayDashboardViewCache') },
      { find: '@/lib/personalAccess', replacement: mock('personalAccess') },
      { find: '@/lib/useDashboardDayWork', replacement: mock('useDashboardDayWork') },
      { find: './WeekendMathSlot', replacement: mock('WeekendMathSlot') },
      { find: './components/OlympiadHome', replacement: mock('OlympiadHome') },
      { find: /\/WeekendMathSlot(?:\.tsx)?$/, replacement: mock('WeekendMathSlot') },
      { find: /\/components\/OlympiadHome(?:\.tsx)?$/, replacement: mock('OlympiadHome') },
      { find: 'firebase/auth', replacement: mock('auth') },
      { find: /^@\//, replacement: `${root}/src/` },
    ],
  },
})
