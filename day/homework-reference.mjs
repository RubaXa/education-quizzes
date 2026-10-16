/** A MESH instruction pointing to earlier homework has no new learner action.
 * @see ../docs/modules/school-diary/dashboard.md#reference-only-homework */
const weekdays = { понедельник: 1, вторник: 2, среду: 3, четверг: 4, пятницу: 5, субботу: 6, воскресенье: 0 }

export function referencedHomeworkDate(text, lessonDate) {
  const match = /^смотри(?:те)?\s+(?:дз|задание)\s+на\s+(понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье)(?:\s+(\d{1,2})\.(\d{1,2}))?\.?$/i.exec(String(text || '').trim())
  if (!match || !/^\d{4}-\d{2}-\d{2}$/.test(lessonDate || '')) return null
  const day = new Date(`${lessonDate}T12:00:00Z`)
  const distance = (day.getUTCDay() - weekdays[match[1].toLowerCase()] + 7) % 7 || 7
  day.setUTCDate(day.getUTCDate() - distance)
  if (match[2] && (+match[2] !== day.getUTCDate() || +match[3] !== day.getUTCMonth() + 1)) return null
  return day.toISOString().slice(0, 10)
}
