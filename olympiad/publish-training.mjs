/** Operator publication of the reviewed authored bank; never imported by the browser.
 * @see ../docs/modules/assessments/olympiad-preparation.md */
import { getTrainingLesson, listTrainingLessons } from './training-content.mjs'

const olympiadId = 'formulo-math-2026-2027'
const safeId = (value) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)
const stable = (value) => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))) : v)
const metadata = listTrainingLessons()
const lessonIds = metadata.map(({ id }) => id)
const problemId = 'training-even-three-digit-v1'
const problem = { status: 'published', practiceOnly: true, title: 'Чётные трёхзначные числа', statement: 'Из цифр 1, 2, 3 и 4 составляют трёхзначные числа без повторения цифр. Сколько среди них чётных? Объясни, почему твой способ учитывает все подходящие числа и не считает одно число дважды.', origin: 'author-training', version: '1' }
const catalog = {
  status: 'published', practiceOnly: true,
  title: 'Формула Единства / Третье тысячелетие — математика 2026–2027',
  deadline: '2026-11-05T23:59:59Z', gradeLevels: [5, 6, 7, 8, 9, 10, 11],
  lessonRefs: metadata.map(({ id, version }) => ({ lessonId: id, version })), allowedProblemIds: [problemId],
  sources: [{ title: 'Официальная страница олимпиады и срок сдачи', url: 'https://www.formulo.org/ru/olymp/2026-math-ru/' }, ...metadata[0].sources],
}

/** No keys or personal identifiers are returned by the planning interface. */
export function trainingPublicationPlan() {
  return { olympiadId, catalog: structuredClone(catalog), lessons: metadata.map(({ id, version, title }) => ({ id, version, title })), problem: { id: problemId, title: problem.title } }
}

function material(lessonId) {
  const lesson = getTrainingLesson(lessonId)
  if (!lesson || lesson.verified !== true || lesson.origin !== 'author-training') throw new Error('Материал не прошёл предметную проверку')
  // Availability means the trusted publication gate has passed, not a change to source content.
  return { status: 'published', practiceOnly: true, lesson: { ...lesson, available: true } }
}

/** Gate must include the original immutable quiz receipts: they are closed local data.
 * Verify all three published questions, keys, family owner and previews before any write.
 * UI/browser readback and access audit are separate release gates. */
export async function publishTraining(db, receipts) {
  if (!db || typeof db.runTransaction !== 'function' || typeof db.doc !== 'function') throw new Error('Нет Firestore')
  if (!Array.isArray(receipts) || receipts.length !== lessonIds.length) throw new Error('Нужны подтверждения online-quiz для каждого урока')
  const byLesson = new Map(receipts.map((r) => [r.lessonId, r]))
  if (byLesson.size !== lessonIds.length || lessonIds.some((id) => !byLesson.has(id))) throw new Error('Неполный набор подтверждений')
  const tokenPattern = /^[A-Za-z0-9_-]{32}$/
  const documents = []
  for (const lessonId of lessonIds) {
    const lesson = getTrainingLesson(lessonId)
    documents.push({ path: `olympiadMaterials/${olympiadId}/lessons/${lessonId}/versions/${lesson.version}`, value: material(lessonId) })
  }
  documents.push({ path: `olympiadMaterials/${olympiadId}/problems/${problemId}`, value: problem })
  documents.push({ path: `olympiadCatalog/${olympiadId}`, value: catalog })
  // Deliberately publish an allowlisted public projection, never the private catalog record.
  documents.push({ path: `publicOlympiadCatalog/${olympiadId}`, value: { status: 'published', title: catalog.title, deadline: catalog.deadline.slice(0, 10), gradeLevels: catalog.gradeLevels, subject: 'Математика' } })
  documents.push({ path: 'publicOlympiadCatalog/energy-hope-math-2026-2027', value: { status: 'published', title: 'Надежда энергетики', deadline: null, gradeLevels: [5, 6, 7, 8, 9, 10, 11], subject: 'Математика', schedule: 'Тренировочный этап: 1 и 8 ноября', source: 'https://ehope.ru/actual/grafik.html' } })
  await db.runTransaction(async (tx) => {
  let owner = null
  for (const lessonId of lessonIds) {
    const receipt = byLesson.get(lessonId)
    if (!tokenPattern.test(receipt.learnerToken || '') || !tokenPattern.test(receipt.previewToken || '') || !safeId(receipt.testId)) throw new Error('Некорректное подтверждение online-quiz')
    const lesson = getTrainingLesson(lessonId)
    const [assignment, key, preview] = await Promise.all([
      tx.get(db.doc(`assignments/${receipt.learnerToken}`)), tx.get(db.doc(`answerKeys/${receipt.learnerToken}`)), tx.get(db.doc(`previews/${receipt.previewToken}`)),
    ])
    if (!assignment.exists || !key.exists || !preview.exists) throw new Error('Не найдено опубликованное назначение, ключ или предпросмотр')
    const a = assignment.data(), k = key.data(), p = preview.data()
    if (a.testId !== receipt.testId || p.testId !== receipt.testId || a.slug !== lessonId || !safeId(a.familyId) || !safeId(a.childId)) throw new Error('Подтверждение принадлежит другому материалу или владельцу')
    const identity = `${a.familyId}/${a.childId}`
    if (owner && owner !== identity) throw new Error('Материалы принадлежат разным детям')
    owner = identity
    if (!Array.isArray(a.questions) || a.questions.length !== lesson.steps.length || stable(p.questions) !== stable(a.questions)) throw new Error('Не совпадают вопросы и предпросмотр')
    for (let i = 0; i < lesson.steps.length; i++) {
      const s = lesson.steps[i], q = a.questions[i], answer = k.entries?.[s.id]
      if (q?.id !== s.id || q.prompt !== s.prompt || stable(q.options?.map(({ id, label }) => ({ id, text: label }))) !== stable(s.options)
        || s.correctOptionIds.length !== 1 || answer?.correct !== s.correctOptionIds[0]) throw new Error('Опубликованный тест не совпадает с уроком')
    }
  }
    const snapshots = await Promise.all(documents.map(({ path }) => tx.get(db.doc(path))))
    for (let i = 0; i < snapshots.length; i++) {
      if (snapshots[i].exists && stable(snapshots[i].data()) !== stable(documents[i].value)) throw new Error('Существующая опубликованная версия отличается; нужна новая версия')
    }
    for (let i = 0; i < snapshots.length; i++) if (!snapshots[i].exists) tx.create(db.doc(documents[i].path), documents[i].value)
  })
  const readback = await Promise.all(documents.map(({ path }) => db.doc(path).get()))
  if (readback.some((s, i) => !s.exists || stable(s.data()) !== stable(documents[i].value))) throw new Error('Readback публикации не совпадает')
  return { olympiadId, lessonCount: lessonIds.length, verifiedDocuments: readback.length }
}
