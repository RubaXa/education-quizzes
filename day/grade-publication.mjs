import { gradeProjectionPatch } from './grade-reconciliation.mjs'

/** Keep every published day of one child on the same verified grade projection.
 * The dashboard can point to any linked day without losing mark provenance.
 * @see ../docs/modules/school-diary/grades.md#mesh-reconciliation
 */
export async function stageGradeProjectionForRole({ role, links, owner, fingerprint, previousFingerprint,
  desired, loadPage, stagePatch }) {
  if (previousFingerprint === fingerprint) return []
  const updated = []
  for (const [date, pair] of Object.entries(links)) {
    const token = pair?.[role]
    if (!token) continue
    const page = await loadPage(token)
    if (!page || page.kind !== role || page.familyId && page.familyId !== owner.familyId || page.childId && page.childId !== owner.childId) {
      throw new Error(`Страница ${date} (${role}) не принадлежит выбранному ребёнку; оценки не обновлены.`)
    }
    const patch = gradeProjectionPatch(page, desired)
    if (!patch) continue
    await stagePatch(token, patch)
    Object.assign(page, patch)
    updated.push(token)
  }
  return updated
}
