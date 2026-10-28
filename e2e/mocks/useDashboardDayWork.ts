/** @see ../../docs/modules/school-diary/school-calendar.md#представление */
export function useDashboardDayWork() {
  return {
    page: undefined, linkedPage: undefined, subjects: [], uploads: [], reviews: [],
    tests: {}, scores: {}, parentDecisions: { events: [], ready: false, error: '' }, ready: false,
  }
}
