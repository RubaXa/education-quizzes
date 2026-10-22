/** Deterministic additive reconciliation of the confirmed numeric grade ledger.
 * @see ../docs/modules/school-diary/grades.md#mesh-reconciliation */
import { assertGradeSnapshotAligned } from './grade-reconciliation.mjs'

const aliases = new Map([
  ['Иностранный (английский) язык', 'Английский язык'],
  ['Изобразительное искусство', 'ИЗО'],
  ['Труд (технология)', 'Технология'],
])
const key = ([mark, weight]) => `${mark}:${weight}`
const counts = (rows) => {
  const result = new Map()
  for (const row of rows) result.set(key(row), (result.get(key(row)) ?? 0) + 1)
  return result
}

export function proposeGradeSnapshot(previous, mesh, reportPath) {
  const threshold = Number(previous?.working_threshold)
  if (previous?.working_threshold_status !== 'conditional; not a confirmed school rule'
    || !Number.isFinite(threshold) || threshold <= 4 || threshold > 5) {
    throw new Error('Нужен сохранённый условный рабочий порог оценок в диапазоне (4, 5].')
  }
  if (!mesh?.complete || !Array.isArray(mesh.marks) || !/^20\d{2}-\d{2}-\d{2}T/.test(mesh.fetchedAt ?? '')) {
    throw new Error('Нужен полный датированный снимок МЭШ с оценками.')
  }
  if (typeof reportPath !== 'string' || !/^reports\/20\d{2}-\d{2}-\d{2}-education-sync\/baseline\.md$/.test(reportPath)) {
    throw new Error('Нужен постоянный отчёт reports/YYYY-MM-DD-education-sync/baseline.md.')
  }
  const byName = new Map(mesh.marks.map((entry) => [aliases.get(entry.subject_name) ?? entry.subject_name, entry]))
  if (byName.size !== previous.subjects?.length || previous.subjects.some((entry) => !byName.has(entry.name))) {
    throw new Error('Набор предметов отличается от подтверждённого среза; нужна предметная сверка.')
  }
  const changes = []
  const subjects = previous.subjects.map((subject) => {
    const source = byName.get(subject.name)
    if (!Array.isArray(subject.grades) || subject.grades.some((grade) => !Array.isArray(grade) || grade.length !== 2
      || !Number.isInteger(grade[0]) || grade[0] < 2 || grade[0] > 5
      || !Number.isInteger(grade[1]) || grade[1] < 1)) {
      throw new Error(`Некорректный подтверждённый журнал оценок: ${subject.name}.`)
    }
    if (!Number.isInteger(source.count) || !Array.isArray(source.marks) || source.marks.length !== source.count
      || source.marks.some((mark) => !Number.isInteger(Number(mark.value)) || !Number.isInteger(Number(mark.weight)))) {
      throw new Error(`Неполная лента оценок: ${subject.name}.`)
    }
    const current = source.marks.map((mark) => [Number(mark.value), Number(mark.weight)])
    const old = counts(subject.grades)
    const actual = counts(current)
    for (const [grade, amount] of old) if ((actual.get(grade) ?? 0) < amount) {
      throw new Error(`У ${subject.name} изменилась или исчезла старая оценка; автоматическое добавление остановлено.`)
    }
    const remaining = new Map(old)
    const added = current.filter((grade) => {
      const gradeKey = key(grade), available = remaining.get(gradeKey) ?? 0
      if (available) { remaining.set(gradeKey, available - 1); return false }
      return true
    })
    const grades = [...subject.grades, ...added]
    const total = grades.reduce((sum, [mark, weight]) => sum + mark * weight, 0)
    const weightSum = grades.reduce((sum, [, weight]) => sum + weight, 0)
    let appMoreFives = 0
    while ((total + 5 * appMoreFives) / (weightSum + appMoreFives) < threshold && appMoreFives < 100) {
      appMoreFives += 1
    }
    const next = { ...subject, grades, displayed_average: Number(source.average), app_more_fives: appMoreFives }
    if (added.length || Number(subject.displayed_average) !== Number(source.average)
      || subject.app_more_fives !== appMoreFives) {
      changes.push({ subject: subject.name, previous: Number(subject.displayed_average), current: next.displayed_average,
        added, previous_app_more_fives: subject.app_more_fives, app_more_fives: appMoreFives })
    }
    return next
  })
  const date = mesh.fetchedAt.slice(0, 10)
  const proposal = changes.length ? { ...previous, snapshot_id: `grades:${date}-period-1`, observed_at: date,
    source_report: reportPath, subjects } : previous
  assertGradeSnapshotAligned(proposal, mesh)
  return { proposal, changes }
}
