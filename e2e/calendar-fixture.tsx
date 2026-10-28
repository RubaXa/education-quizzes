/** @see ../docs/modules/school-diary/school-calendar.md#представление */
/** @see ../docs/decisions/calendar-scroll-selection-2026-10-28.md */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import DayDashboard from '../src/DayDashboard'

const parent = new URLSearchParams(window.location.search).get('role') === 'parent'
createRoot(document.getElementById('root')!).render(
  <StrictMode><DayDashboard token={parent ? 'e2e-parent' : 'e2e-student'} parent={parent} /></StrictMode>,
)
