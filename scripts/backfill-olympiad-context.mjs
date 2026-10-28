/** @see ../docs/modules/assessments/olympiad-preparation.md */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { backfillLearningContext } from '../assessment/learning-context-backfill.mjs'

if (process.argv[2] !== 'apply' || process.env.GCLOUD_PROJECT !== 'education-9d7c6' || !process.env.GOOGLE_APPLICATION_CREDENTIALS) throw new Error('Нужны apply, явный проект и operator credentials')
const consent = JSON.parse(readFileSync(resolve('.local/olympiad-grade-consent.json'), 'utf8'))
const person = JSON.parse(readFileSync(resolve('.local/family-access.json'), 'utf8')).people?.[consent.personId]
if (!person || person.role !== 'student' || !person.familyId || !person.childId) throw new Error('Нет подтверждённой семейной связи')
function parse(url, prefix) {
  const parsed = new URL(url)
  if (parsed.origin !== 'https://rubaxa.github.io' || parsed.pathname !== '/education-quizzes/' || !parsed.hash.startsWith(prefix)) throw new Error('Недостоверная квитанция')
  const value = parsed.hash.slice(prefix.length)
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(value)) throw new Error('Некорректная ссылка в квитанции')
  return value
}
const entries = ['enumeration', 'parity', 'counterexample'].map(name => {
  const slug = `training-${name}-v1`, r = JSON.parse(readFileSync(resolve('.local', `olympiad-training-create-${name}.json`), 'utf8'))
  return { slug, testId: r.testId, learnerToken: parse(r.learner, `#/t/${slug}~`), previewToken: parse(r.preview, `#/preview/${slug}~`), boardTokens: [parse(r.dashboard, '#/dashboard/'), parse(r.learnerBoard, '#/my/'), parse(r.parentBoard, '#/review/')] }
})
initializeApp({ projectId: process.env.GCLOUD_PROJECT, credential: applicationDefault() })
console.log(JSON.stringify(await backfillLearningContext(getFirestore(), { owner: { familyId: person.familyId, childId: person.childId }, entries, context: { kind: 'olympiad', id: 'formulo-math-2026-2027' }, markOptional: true })))
