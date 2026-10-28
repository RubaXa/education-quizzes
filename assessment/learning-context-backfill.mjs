import { learningContext } from './learning-context.mjs'
import { assertQuizOwner } from '../scripts/quiz-access.mjs'

/** Update only public placement metadata on verified existing assignments and their indexes.
 * @see ../docs/modules/assessments/quizzes.md */
export async function backfillLearningContext(db, { owner, entries, context, markOptional = false }) {
  const placement = learningContext(context)
  const safe = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
  if (!placement || !safe(owner?.familyId) || !safe(owner?.childId) || !Array.isArray(entries) || !entries.length) throw new Error('Не указан владелец, контекст или назначения')
  const paths = new Set()
  const refs = []
  let optionalWritten = new Set()
  for (const entry of entries) {
    if (![entry.learnerToken, entry.previewToken, entry.testId, entry.slug].every(safe) || !Array.isArray(entry.boardTokens) || !entry.boardTokens.length || !entry.boardTokens.every(safe)) throw new Error('Некорректная квитанция')
    for (const [path, kind] of [[`assignments/${entry.learnerToken}`, 'assignment'], [`previews/${entry.previewToken}`, 'preview'], ...entry.boardTokens.map(board => [`dashboard/${board}/assignments/${entry.learnerToken}`, 'index'])]) {
      if (paths.has(path)) throw new Error('Повторяющаяся ссылка')
      paths.add(path); refs.push({ ref: db.doc(path), kind, entry })
    }
  }
  await db.runTransaction(async tx => {
    optionalWritten = new Set()
    const snaps = await Promise.all(refs.map(({ ref }) => tx.get(ref)))
    for (let i = 0; i < refs.length; i++) {
      const { kind, entry } = refs[i], snap = snaps[i]
      if (!snap.exists) throw new Error('Документ квитанции не найден')
      const data = snap.data()
      if (data.testId !== entry.testId || kind !== 'preview' && data.slug !== entry.slug) throw new Error('Квитанция относится к другому тесту')
      if (kind === 'assignment') assertQuizOwner(data, owner)
      if (kind === 'index' && data.previewToken !== entry.previewToken) throw new Error('Предпросмотр индекса не совпадает')
      if (kind !== 'preview' && data.learningContext && JSON.stringify(learningContext(data.learningContext)) !== JSON.stringify(placement)) throw new Error('Существующий контекст отличается')
    }
    for (let i = 0; i < refs.length; i++) {
      if (refs[i].kind === 'preview') continue
      const data = snaps[i].data(), patch = {}
      if (!data.learningContext) patch.learningContext = placement
      if (markOptional && refs[i].kind === 'assignment' && data.familyOptional === undefined && data.familyChoiceAt == null && data.familyChoiceBy == null) { patch.familyOptional = true; optionalWritten.add(i) }
      if (Object.keys(patch).length) tx.update(refs[i].ref, patch)
    }
  })
  const checked = await Promise.all(refs.map(({ ref }) => ref.get()))
  if (checked.some((snap, i) => !snap.exists || refs[i].kind !== 'preview' && JSON.stringify(learningContext(snap.data().learningContext)) !== JSON.stringify(placement))) throw new Error('Обратное чтение контекста не совпало')
  if ([...optionalWritten].some(i => checked[i].data()?.familyOptional !== true)) throw new Error('Обратное чтение дополнительного статуса не совпало')
  return { assignments: entries.length, documentsVerified: refs.length, ...(markOptional ? { optional: checked.filter((snap, i) => refs[i].kind === 'assignment' && snap.data()?.familyOptional === true).length, existingRequired: checked.filter((snap, i) => refs[i].kind === 'assignment' && snap.data()?.familyOptional !== true).length } : {}) }
}
