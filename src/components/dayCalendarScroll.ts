/** @see ../../docs/modules/school-diary/school-calendar.md#представление */
/** @see ../../docs/decisions/calendar-scroll-selection-2026-10-28.md */
/** @see ../../docs/shared/design/README.md#tokens */
/** @see ../../docs/shared/design/ui-kit.md#один-источник-реализации */
/** @see ../../docs/shared/design/components.md#registry */
export function calendarScrollTarget({ scrollLeft, viewportLeft, viewportRight, dayLeft, dayRight, dayWidth, initial }: {
  scrollLeft: number
  viewportLeft: number
  viewportRight: number
  dayLeft: number
  dayRight: number
  dayWidth: number
  initial: boolean
}) {
  const nearEdge = dayLeft < viewportLeft + dayWidth * 1.5 || dayRight > viewportRight - dayWidth * 1.5
  if (!initial && !nearEdge) return null
  const visibleWidth = viewportRight - viewportLeft
  const centeredLeft = scrollLeft + dayLeft - viewportLeft - (visibleWidth - dayWidth) / 2
  return Math.max(0, centeredLeft)
}
