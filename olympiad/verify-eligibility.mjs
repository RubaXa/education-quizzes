/** @see ../docs/modules/assessments/olympiad-preparation.md */
const safe = (x) => typeof x === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(x)
const token = (x) => typeof x === 'string' && /^[A-Za-z0-9_-]{32}$/.test(x)
/** The caller provides a locally confirmed grade and exact family registry identity.
 * This transaction rechecks owner against three published quiz receipts and active membership. */
export async function verifyOlympiadEligibility(db, input) {
  const { familyId, childId, personId, grade, receipts } = input ?? {}
  if (![familyId, childId, personId].every(safe) || !Number.isInteger(grade) || grade < 1 || grade > 11 || !Array.isArray(receipts) || receipts.length !== 3 || receipts.some(r => !token(r.learnerToken) || !safe(r.testId)) || new Set(receipts.map(r => r.testId)).size !== 3) throw new Error('Недостаточно проверенных оснований')
  const childRef = db.doc(`families/${familyId}/children/${childId}`)
  const checked = { grade, verified: true }
  await db.runTransaction(async tx => {
    const refs = [db.doc(`families/${familyId}`), childRef, db.doc(`families/${familyId}/members/${personId}`), ...receipts.map(r => db.doc(`assignments/${r.learnerToken}`))]
    const docs = await Promise.all(refs.map(ref => tx.get(ref)))
    if (docs.some(d => !d.exists)) throw new Error('Семейное подтверждение не найдено')
    const [family, child, person, ...assignments] = docs.map(d => d.data())
    if (family.active === false || child.active === false || person.active !== true || person.role !== 'student' || !Array.isArray(person.childIds) || !person.childIds.includes(childId)) throw new Error('Членство не подтверждено')
    if (assignments.some((a, i) => a.familyId !== familyId || a.childId !== childId || a.testId !== receipts[i].testId || a.slug !== receipts[i].lessonId)) throw new Error('Назначения не совпадают с учеником')
    const existing = child.olympiadEligibility
    if (existing?.verified === true && existing.grade !== grade) throw new Error('Класс уже подтверждён другим значением; нужна проверка источника')
    if (existing !== undefined && (existing?.verified !== true || existing.grade !== grade)) throw new Error('Существующее значение требует отдельной сверки')
    if (existing === undefined) tx.update(childRef, { olympiadEligibility: checked })
  })
  const snapshot = await childRef.get()
  const value = snapshot.data()?.olympiadEligibility
  if (!snapshot.exists || value?.verified !== true || value.grade !== grade) throw new Error('Readback класса не совпадает')
  return { verified: true, grade }
}
