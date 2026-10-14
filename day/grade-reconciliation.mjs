const nameAliases = new Map([
  ['Иностранный (английский) язык', 'Английский язык'],
  ['Изобразительное искусство', 'ИЗО'],
  ['Труд (технология)', 'Технология'],
])
const subjectName = (name) => nameAliases.get(name) ?? name
const gradeKey = (grade) => {
  const mark = Array.isArray(grade) ? grade[0] : grade?.mark
  const weight = Array.isArray(grade) ? grade[1] : grade?.weight
  if (!Number.isFinite(Number(mark)) || !Number.isFinite(Number(weight))) throw new Error('Неверная форма школьной отметки.')
  return `${Number(mark)}:${Number(weight)}`
}
const gradeCounts = (grades) => {
  const counts = new Map()
  for (const grade of grades) counts.set(gradeKey(grade), (counts.get(gradeKey(grade)) ?? 0) + 1)
  return counts
}

/** Source summary may omit individual marks; count and average are always required.
 * @see ../docs/product/grades.md#mesh-reconciliation
 */
export function assertGradeSnapshotAligned(gradeSnapshot, meshSnapshot) {
  if (!meshSnapshot?.complete || !Array.isArray(meshSnapshot.marks)) throw new Error('Для оценок нужен полный снимок МЭШ.')
  const published = new Map((gradeSnapshot?.subjects ?? []).map((item) => [item.name, item]))
  for (const mesh of meshSnapshot.marks) {
    if (!Number.isInteger(mesh.count) || mesh.count <= 0) continue
    const subject = published.get(subjectName(mesh.subject_name))
    if (!subject || subject.grades?.length !== mesh.count || Number(subject.displayed_average) !== Number(mesh.average)) {
      throw new Error(`Срез оценок ${subjectName(mesh.subject_name)} отстаёт от МЭШ. Сверьте learner/grade-snapshot.json до публикации.`)
    }
    if (Array.isArray(mesh.marks) && mesh.marks.length === mesh.count) {
      const expected = gradeCounts(mesh.marks.map((item) => [item.value, item.weight]))
      const actual = gradeCounts(subject.grades)
      if ([...expected].some(([key, count]) => actual.get(key) !== count)) {
        throw new Error(`Лента оценок ${subject.name} расходится с полным списком МЭШ.`)
      }
    }
  }
}

/** Preserve source identity: equal marks may describe different work and comments.
 * @see ../docs/product/grades.md#dashboard-grade-list
 */
export function gradeDetailRows(gradeSnapshot, meshSnapshot) {
  assertGradeSnapshotAligned(gradeSnapshot, meshSnapshot)
  const meshByName = new Map(meshSnapshot.marks.map((item) => [subjectName(item.subject_name), item]))
  return gradeSnapshot.subjects.map((subject) => {
    const source = meshByName.get(subject.name)
    const complete = source && source.count === subject.grades.length && source.marks?.length === source.count
    const grades = complete ? source.marks.map((item) => ({
      mark: Number(item.value), weight: Number(item.weight),
      ...(item.id != null ? { sourceId: String(item.id) } : {}),
      ...(typeof item.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(item.date) ? { date: item.date.slice(0, 10) } : {}),
      ...(item.control_form_name?.trim() ? { workType: item.control_form_name.trim() } : {}),
      ...(item.comment?.trim() ? { comment: item.comment.trim() } : {}),
    })) : subject.grades.map(([mark, weight]) => ({ mark, weight }))
    return { id: subject.id, name: subject.name, displayed_average: subject.displayed_average,
      scenario_verified: gradeSnapshot.scenarios_verified === true, grades }
  })
}

/** Distinguishes added grades from corrections and ignores order-only changes. */
export function detectGradeChange(previous, current) {
  if (!previous || !Array.isArray(previous.grades) || !Array.isArray(current?.grades)) return null
  const oldCounts = gradeCounts(previous.grades)
  const newCounts = gradeCounts(current.grades)
  const equal = Number(previous.displayed_average ?? previous.average) === Number(current.displayed_average ?? current.average)
    && oldCounts.size === newCounts.size && [...oldCounts].every(([key, count]) => newCounts.get(key) === count)
  if (equal) return null
  const added = []
  for (const grade of current.grades) {
    const key = gradeKey(grade)
    if ((oldCounts.get(key) ?? 0) > 0) oldCounts.set(key, oldCounts.get(key) - 1)
    else added.push(Array.isArray(grade) ? grade : [grade.mark, grade.weight])
  }
  const onlyAdded = current.grades.length > previous.grades.length && [...oldCounts.values()].every((count) => count === 0)
  return { type: onlyAdded ? 'grade_added' : 'grade_changed', added }
}
