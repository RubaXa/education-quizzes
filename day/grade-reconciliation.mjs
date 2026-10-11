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
