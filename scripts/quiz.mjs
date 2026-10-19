import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { assertQuizOwner } from './quiz-access.mjs'
import { pendingManualQuestionIds, validateAssessmentPlan } from '../assessment/decision-graph.mjs'
import { repeatedQuestionCopy } from '../assessment/question-copy.mjs'
import { assignmentShapeErrors } from '../day/data-contract.mjs'
import { assertFollowupCoverage, assertOpenRevisionReadback, openQuizRevision } from '../assessment/followup-contract.mjs'
import { assertLineageContinuation, quizLineageStatistics } from '../assessment/quiz-lineage.mjs'
import { grade, summarize } from '../src/lib/quiz.ts'
import { canonicalShortKeyRepair, correctionFingerprint } from '../assessment/canonical-short-key.mjs'
import { publishedAnswer, questionGuidanceErrors, repairQuestionGuidance } from '../assessment/question-guidance.mjs'
import { needsQuizFollowup } from '../src/lib/quizCompletion.ts'

const projectId = 'education-9d7c6'
const site = 'https://rubaxa.github.io/education-quizzes/'
const localDir = resolve('.local')
const dashboardTokenFile = resolve(localDir, 'dashboard-token')
const learnerBoardTokenFile = resolve(localDir, 'learner-board-token')
const parentBoardTokenFile = resolve(localDir, 'parent-board-token')

function prepareLocalFirebaseLogin() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return
  const loginFile = resolve(localDir, 'config/configstore/firebase-tools.json')
  if (!existsSync(loginFile)) fail('Сначала выполните вход через Firebase CLI.')
  const login = JSON.parse(readFileSync(loginFile, 'utf8'))
  if (!login.tokens?.refresh_token) fail('Вход Firebase CLI устарел. Войдите снова.')
  const require = createRequire(import.meta.url)
  const { clientId, clientSecret } = require('firebase-tools/lib/api')
  const credentialFile = resolve(localDir, 'adc.json')
  writeFileSync(credentialFile, JSON.stringify({
    type: 'authorized_user',
    client_id: clientId(),
    client_secret: clientSecret(),
    refresh_token: login.tokens.refresh_token,
  }), { mode: 0o600 })
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialFile
}

function token(bytes = 24) {
  return randomBytes(bytes).toString('base64url')
}

function dashboardToken() {
  mkdirSync(localDir, { recursive: true })
  if (!existsSync(dashboardTokenFile)) writeFileSync(dashboardTokenFile, token(32), { mode: 0o600 })
  return readFileSync(dashboardTokenFile, 'utf8').trim()
}

function learnerBoardToken() {
  mkdirSync(localDir, { recursive: true })
  if (!existsSync(learnerBoardTokenFile)) writeFileSync(learnerBoardTokenFile, token(32), { mode: 0o600 })
  return readFileSync(learnerBoardTokenFile, 'utf8').trim()
}

function parentBoardToken() {
  mkdirSync(localDir, { recursive: true })
  if (!existsSync(parentBoardTokenFile)) writeFileSync(parentBoardTokenFile, token(32), { mode: 0o600 })
  return readFileSync(parentBoardTokenFile, 'utf8').trim()
}

function fail(message) {
  throw new Error(message)
}

function loadJson(path) {
  if (!path) fail('Укажите путь к JSON-файлу.')
  return JSON.parse(readFileSync(resolve(path), 'utf8'))
}

function assignmentOwner(personId) {
  const registryPath = resolve(localDir, 'family-access.json')
  if (!existsSync(registryPath)) fail('Нет закрытого реестра семей для назначения теста.')
  const people = JSON.parse(readFileSync(registryPath, 'utf8')).people ?? {}
  const students = Object.entries(people).filter(([, value]) => value?.role === 'student')
  const selected = personId ? people[personId] : students.length === 1 ? students[0][1] : null
  if (!selected || selected.role !== 'student' || !selected.familyId || !selected.childId) {
    fail('Укажите ID профиля ученика третьим аргументом create; профиль должен быть в закрытом реестре.')
  }
  return { familyId: selected.familyId, childId: selected.childId }
}

function validateSpec(spec, specPath) {
  if (typeof spec.title !== 'string' || !spec.title.trim()) fail('Не указано название теста.')
  if (typeof spec.description !== 'string' || !spec.description.trim()) fail('Нужно краткое описание теста для личного списка.')
  validateBoardDetails(spec.board)
  if (typeof spec.subject !== 'string' || !spec.subject.trim()) fail('Не указан предмет.')
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(spec.slug ?? '')) fail('slug должен содержать латинские буквы, цифры и дефисы.')
  if (spec.linkedToTestId !== undefined && (typeof spec.linkedToTestId !== 'string' || !spec.linkedToTestId.trim())) fail('linkedToTestId должен содержать ID исходного теста, а не токен ссылки.')
  if (!Array.isArray(spec.questions) || !spec.questions.length || spec.questions.length > 100) fail('Нужно от 1 до 100 вопросов.')
  const repeatedCopy = repeatedQuestionCopy(spec.questions)
  if (repeatedCopy.length) fail(repeatedCopy.join(' '))
  const guidanceProblems = questionGuidanceErrors(spec.questions)
  if (guidanceProblems.length) fail(guidanceProblems.join('\n'))
  if (spec.visual !== undefined) {
    if (!spec.visual || typeof spec.visual !== 'object' || Array.isArray(spec.visual)) fail('visual должен быть объектом.')
    if (spec.visual.preset && !['english', 'informatics', 'biology', 'literature', 'history', 'math', 'russian', 'geography', 'physics', 'chemistry', 'general'].includes(spec.visual.preset)) fail('Неизвестный visual.preset.')
    if (spec.visual.scene && !['city', 'language', 'code', 'nature', 'story', 'archive', 'shapes', 'atlas', 'lab'].includes(spec.visual.scene)) fail('Неизвестный visual.scene.')
    for (const field of ['eyebrow', 'caption']) {
      if (spec.visual[field] !== undefined && (typeof spec.visual[field] !== 'string' || spec.visual[field].length > 160)) fail(`Некорректный visual.${field}.`)
    }
  }
  if (spec.reading !== undefined && (
    !spec.reading || typeof spec.reading.heading !== 'string' || !spec.reading.heading.trim() ||
    !Array.isArray(spec.reading.paragraphs) || !spec.reading.paragraphs.length ||
    !spec.reading.paragraphs.every((paragraph) => typeof paragraph === 'string' && paragraph.trim() && paragraph.length <= 1200)
  )) fail('Некорректный reading: нужны заголовок и непустые абзацы.')
  const ids = new Set()
  for (const question of spec.questions) {
    if (!question.id || ids.has(question.id)) fail('У каждого вопроса должен быть уникальный id.')
    ids.add(question.id)
    if (!['single', 'multiple', 'short', 'number', 'long', 'figure'].includes(question.kind)) fail(`Неизвестный тип вопроса ${question.id}.`)
    if (typeof question.prompt !== 'string' || !question.prompt.trim()) fail(`Нет текста вопроса ${question.id}.`)
    if (!Number.isFinite(question.points) || question.points <= 0) fail(`Некорректные баллы вопроса ${question.id}.`)
    if (question.kind !== 'long' && question.answer?.correct === undefined) fail(`Нет ключа для вопроса ${question.id}.`)
    if (['single', 'multiple', 'figure'].includes(question.kind) && (!Array.isArray(question.options) || question.options.length < 2)) fail(`Нужно минимум два варианта в ${question.id}.`)
    const answer = question.answer
    if (!answer || typeof answer !== 'object' || Array.isArray(answer)) fail(`Нет разбора для вопроса ${question.id}.`)
    if (question.kind === 'short' && answer.accepted !== undefined && (!Array.isArray(answer.accepted)
      || !answer.accepted.some((value) => typeof value === 'string' && typeof answer.correct === 'string'
        && value.trim().toLocaleLowerCase('ru-RU') === answer.correct.trim().toLocaleLowerCase('ru-RU')))) {
      fail(`Основной correct должен входить в accepted: ${question.id}.`)
    }
    for (const field of ['explanation', 'source']) {
      if (typeof answer[field] !== 'string' || !answer[field].trim()) fail(`Нет answer.${field} для вопроса ${question.id}.`)
    }
    const learning = answer.learning
    if (!learning || typeof learning !== 'object' || Array.isArray(learning)) fail(`Нет answer.learning для вопроса ${question.id}.`)
    for (const field of ['rule', 'why', 'textbook', 'nextStep']) {
      if (typeof learning[field] !== 'string' || !learning[field].trim()) fail(`Нет answer.learning.${field} для вопроса ${question.id}.`)
    }
    if (learning.sourceHeading !== undefined && (typeof learning.sourceHeading !== 'string' || !learning.sourceHeading.trim())) fail(`Некорректный answer.learning.sourceHeading в ${question.id}.`)
    for (const field of ['textbookUrl', 'url']) {
      if (learning[field] !== undefined) {
        if (typeof learning[field] !== 'string') fail(`Некорректная ссылка answer.learning.${field} в ${question.id}.`)
        let parsed
        try { parsed = new URL(learning[field]) } catch { fail(`Некорректная ссылка answer.learning.${field} в ${question.id}.`) }
        if (parsed.protocol !== 'https:' || !parsed.hostname) fail(`Ссылка answer.learning.${field} в ${question.id} должна быть HTTPS.`)
      }
    }
  }
  if (typeof spec.assessmentPlanPath !== 'string' || !spec.assessmentPlanPath.trim()) {
    fail('Для нового теста нужен закрытый assessmentPlanPath; см. docs/modules/assessments/assessment-decision-graph.md.')
  }
  const planPath = resolve(dirname(resolve(specPath)), spec.assessmentPlanPath)
  const plan = loadJson(planPath)
  const policyErrors = validateAssessmentPlan(plan, spec)
  if (policyErrors.length) fail(`План теста не прошёл структурную проверку:\n- ${policyErrors.join('\n- ')}`)
  return plan
}

function validateBoardDetails(board) {
  if (!board || typeof board !== 'object' || Array.isArray(board)) fail('Нужен board с материалами, темами повторения и целью теста.')
  if (!Array.isArray(board.materials) || !board.materials.length || !board.materials.every((value) => typeof value === 'string' && value.trim())) fail('board.materials: укажите конкретные проверенные источники.')
  for (const field of ['review', 'purpose']) {
    if (typeof board[field] !== 'string' || !board[field].trim()) fail(`board.${field}: нужна непустая строка.`)
  }
}

const [command, first, second, third] = process.argv.slice(2)
if (command !== 'validate') {
  prepareLocalFirebaseLogin()
  initializeApp({ credential: applicationDefault(), projectId })
}
const db = command === 'validate' ? null : getFirestore()

async function inspectedFollowupSource(spec, plan, owner) {
  const parents = await db.collection('assignments').where('testId', '==', spec.linkedToTestId).get()
  if (parents.size !== 1) fail('Исходный testId не найден однозначно. Не используйте токен ученической ссылки в linkedToTestId.')
  const parent = parents.docs[0].data()
  if (parent.familyId !== owner.familyId || parent.childId !== owner.childId || parent.status !== 'submitted') fail('Исходный тест не отправлен или принадлежит другому ученику.')
  if (plan.mode === 'control-followup' && parent.assessment?.mode !== 'control-diagnostic') {
    fail('Второй вариант контрольной должен ссылаться на первую контрольную диагностику этого ученика.')
  }
  const [parentReview, parentKey] = await Promise.all([
    db.doc(`reviews/${parents.docs[0].id}`).get(), db.doc(`answerKeys/${parents.docs[0].id}`).get(),
  ])
  const pending = pendingManualQuestionIds(parent, parentReview.data())
  if (pending.length) fail(`Сначала проверьте все открытые ответы исходного теста: ${pending.join(', ')}.`)
  if (!parentKey.exists) fail('Ключ исходной попытки отсутствует: продолжение нельзя составить по непроверенному результату.')
  const results = grade(parent, parentKey.data(), parentReview.data())
  const score = summarize(results)
  if (score.pending || !score.possible) fail('Исходная попытка ещё не проверена полностью.')
  if (!needsQuizFollowup({ points: score.earned, maxPoints: score.possible }, Boolean(parent.followupRequestedAt))) {
    fail('Исходный тест зачтён: продолжение создаётся только по запросу родителя.')
  }
  const errorQuestionIds = results.filter((result) => !result.skipped && result.points !== null
    && result.points < result.question.points).map((result) => result.question.id)
  const attempts = await loadLineage(parents.docs[0].id, { assignment: parent, answerKey: parentKey.data(), review: parentReview.data() ?? null })
  const { targetCount } = assertLineageContinuation(plan, spec, attempts)
  assertFollowupCoverage(plan, spec, parent.testId, errorQuestionIds)
  return { parent, errorQuestionIds, targetCount }
}

async function create(specPath, studentPersonId) {
  const spec = loadJson(specPath)
  const plan = validateSpec(spec, specPath)
  const owner = assignmentOwner(studentPersonId)
  if (spec.linkedToTestId) {
    await inspectedFollowupSource(spec, plan, owner)
    const continuations = await db.collection('assignments').where('linkedToTestId', '==', spec.linkedToTestId).get()
    if (continuations.docs.some((item) => item.data().familyId === owner.familyId && item.data().childId === owner.childId)) fail('Связанное продолжение для этого теста уже существует.')
  }
  const learnerToken = token()
  const previewToken = token()
  const ownerToken = dashboardToken()
  const testId = token(12)
  const publicQuestions = spec.questions.map(({ answer: _answer, ...question }) => question)
  const entries = Object.fromEntries(spec.questions.map((question) => [question.id, publishedAnswer(question.answer)]))
  const createdAt = Timestamp.now()
  const assignment = {
    schemaVersion: 1,
    ...owner,
    testId,
    title: spec.title,
    description: spec.description ?? '',
    subject: spec.subject,
    visual: spec.visual ?? null,
    reading: spec.reading ?? null,
    slug: spec.slug,
    linkedToTestId: spec.linkedToTestId ?? null,
    assessment: { policyVersion: plan.policyVersion, mode: plan.mode, subjectAdapter: plan.subjectAdapter },
    questions: publicQuestions,
    status: 'open',
    answers: {},
    startedAt: null,
    updatedAt: null,
    submittedAt: null,
    createdAt,
  }
  assertQuizOwner(assignment, owner)
  const shapeErrors = assignmentShapeErrors(assignment)
  if (shapeErrors.length) fail(`Тест не соответствует модели Firestore: ${shapeErrors.join(' ')}`)
  const batch = db.batch()
  batch.create(db.doc(`assignments/${learnerToken}`), assignment)
  batch.create(db.doc(`answerKeys/${learnerToken}`), { entries })
  batch.create(db.doc(`previews/${previewToken}`), {
    testId,
    title: spec.title,
    description: spec.description ?? '',
    subject: spec.subject,
    visual: spec.visual ?? null,
    reading: spec.reading ?? null,
    questions: publicQuestions,
    createdAt,
  })
  batch.create(db.doc(`dashboard/${ownerToken}/assignments/${learnerToken}`), {
    testId,
    linkedToTestId: spec.linkedToTestId ?? null,
    title: spec.title,
    description: spec.description ?? '',
    board: spec.board,
    subject: spec.subject,
    slug: spec.slug,
    previewToken,
    createdAt,
  })
  if (existsSync(learnerBoardTokenFile)) {
    batch.create(db.doc(`dashboard/${learnerBoardToken()}/assignments/${learnerToken}`), {
      testId,
      linkedToTestId: spec.linkedToTestId ?? null,
      title: spec.title,
      description: spec.description ?? '',
      board: spec.board,
      subject: spec.subject,
      slug: spec.slug,
      previewToken,
      createdAt,
    })
  }
  if (existsSync(parentBoardTokenFile)) {
    batch.create(db.doc(`dashboard/${parentBoardToken()}/assignments/${learnerToken}`), {
      testId,
      linkedToTestId: spec.linkedToTestId ?? null,
      title: spec.title,
      description: spec.description ?? '',
      board: spec.board,
      subject: spec.subject,
      slug: spec.slug,
      previewToken,
      createdAt,
    })
  }
  await batch.commit()
  const published = await db.doc(`assignments/${learnerToken}`).get()
  if (!published.exists) fail('Тест не найден после публикации.')
  const publishedErrors = assignmentShapeErrors(published.data())
  if (publishedErrors.length) fail(`Опубликованный тест нарушает модель Firestore: ${publishedErrors.join(' ')}`)
  assertQuizOwner(published.data(), owner)
  console.log(JSON.stringify({
    testId,
    learner: `${site}#/t/${spec.slug}~${learnerToken}`,
    preview: `${site}#/preview/${spec.slug}~${previewToken}`,
    dashboard: `${site}#/dashboard/${ownerToken}`,
    ...(existsSync(learnerBoardTokenFile) ? { learnerBoard: `${site}#/my/${learnerBoardToken()}` } : {}),
    ...(existsSync(parentBoardTokenFile) ? { parentBoard: `${site}#/review/${parentBoardToken()}` } : {}),
  }, null, 2))
}

/** Closed statistics for one linked chain; no lesson text or answer key is published. */
async function loadLineage(learnerToken, firstAttempt = null) {
  const attempts = [], seen = new Set()
  let tokenToRead = learnerToken
  let owner = null
  while (tokenToRead && attempts.length < 16) {
    if (seen.has(tokenToRead)) fail('В цепочке тестов обнаружен цикл.')
    seen.add(tokenToRead)
    let attempt = firstAttempt && tokenToRead === learnerToken ? firstAttempt : null
    if (!attempt) {
      const [assignmentDoc, keyDoc, reviewDoc] = await Promise.all([
        db.doc(`assignments/${tokenToRead}`).get(), db.doc(`answerKeys/${tokenToRead}`).get(),
        db.doc(`reviews/${tokenToRead}`).get(),
      ])
      if (!assignmentDoc.exists || !keyDoc.exists) fail('В цепочке нет назначения или ключа.')
      attempt = { assignment: assignmentDoc.data(), answerKey: keyDoc.data(), review: reviewDoc.data() ?? null }
    }
    const { assignment } = attempt
    if (owner && (assignment.familyId !== owner.familyId || assignment.childId !== owner.childId)) fail('Цепочка пересекла границу семьи.')
    owner ??= { familyId: assignment.familyId, childId: assignment.childId }
    attempts.push(attempt)
    if (!assignment.linkedToTestId) return attempts
    const previous = await db.collection('assignments').where('testId', '==', assignment.linkedToTestId).get()
    if (previous.size !== 1) fail('Предыдущая попытка в цепочке не найдена однозначно.')
    tokenToRead = previous.docs[0].id
  }
  fail('Цепочка тестов длиннее 16 попыток.')
}

async function exportLineage(learnerToken, outputPath, planPath) {
  if (!learnerToken || !outputPath || !resolve(outputPath).startsWith(`${localDir}/`)) {
    fail('Укажите токен и закрытый путь внутри .local/.')
  }
  const coverage = planPath ? loadJson(planPath)?.continuation?.topicCoverage : []
  if (!Array.isArray(coverage)) fail('В закрытом плане нужна continuation.topicCoverage — матрица темы.')
  const statistics = quizLineageStatistics(await loadLineage(learnerToken), coverage.length)
  writeFileSync(resolve(outputPath), `${JSON.stringify(statistics, null, 2)}\n`, { mode: 0o600 })
  console.log(JSON.stringify({ saved: resolve(outputPath), attempts: statistics.attempts.length,
    latestErrors: statistics.next.errorQuestionIds.length, targetCount: statistics.next.targetCount }))
}

/** Atomically update an unopened continuation without changing its testId or links. */
async function reviseOpenQuiz(learnerToken, specPath, studentPersonId) {
  if (!learnerToken || !specPath || !studentPersonId) fail('Нужны токен открытого теста, spec и ID ученика.')
  const spec = loadJson(specPath)
  const plan = validateSpec(spec, specPath)
  if (plan.mode !== 'targeted-followup' || !spec.linkedToTestId) fail('Ревизия разрешена только для адресного продолжения.')
  const owner = assignmentOwner(studentPersonId)
  await inspectedFollowupSource(spec, plan, owner)
  const ownerToken = dashboardToken()
  const assignmentRef = db.doc(`assignments/${learnerToken}`)
  const keyRef = db.doc(`answerKeys/${learnerToken}`)
  const ownerIndexRef = db.doc(`dashboard/${ownerToken}/assignments/${learnerToken}`)
  const revisedAt = Timestamp.now()
  let readbackRefs = null
  await db.runTransaction(async (transaction) => {
    const [assignmentDoc, keyDoc, ownerIndexDoc] = await Promise.all([
      transaction.get(assignmentRef), transaction.get(keyRef), transaction.get(ownerIndexRef),
    ])
    if (!assignmentDoc.exists || !keyDoc.exists || !ownerIndexDoc.exists) fail('Для ревизии нужны назначение, ключ и родительский индекс.')
    const previewToken = ownerIndexDoc.data().previewToken
    if (!previewToken) fail('У теста нет связанного предпросмотра.')
    const previewRef = db.doc(`previews/${previewToken}`)
    const additionalIndexRefs = [learnerBoardTokenFile, parentBoardTokenFile].filter(existsSync).map((file) =>
      db.doc(`dashboard/${readFileSync(file, 'utf8').trim()}/assignments/${learnerToken}`))
    const indexRefs = [ownerIndexRef, ...additionalIndexRefs]
    const [previewDoc, ...additionalIndexDocs] = await Promise.all([
      transaction.get(previewRef), ...additionalIndexRefs.map((ref) => transaction.get(ref)),
    ])
    const indexDocs = [ownerIndexDoc, ...additionalIndexDocs]
    if (!previewDoc.exists || indexDocs.some((doc) => !doc.exists)) fail('Не все ролевые индексы и предпросмотр существуют.')
    const patch = openQuizRevision({ current: assignmentDoc.data(), spec, owner, revisedAt })
    const shapeErrors = assignmentShapeErrors({ ...assignmentDoc.data(), ...patch.assignment })
    if (shapeErrors.length) fail(`Ревизия нарушает модель назначения: ${shapeErrors.join(' ')}`)
    transaction.update(assignmentRef, patch.assignment)
    transaction.update(keyRef, patch.answerKey)
    transaction.update(previewRef, patch.preview)
    indexRefs.forEach((ref) => transaction.update(ref, patch.index))
    readbackRefs = [assignmentRef, keyRef, previewRef, ...indexRefs]
  })
  const docs = await db.getAll(...readbackRefs)
  const result = assertOpenRevisionReadback({ assignment: docs[0].data(), answerKey: docs[1].data(),
    preview: docs[2].data(), indexes: docs.slice(3).map((doc) => doc.data()), spec })
  console.log(JSON.stringify(result))
}

async function addToLearnerBoard(manifestPath) {
  const items = loadJson(manifestPath)
  if (!Array.isArray(items) || !items.length) fail('В manifest нужен непустой массив тестов.')
  const tokens = new Set()
  const board = learnerBoardToken()
  const parentBoard = parentBoardToken()
  const batch = db.batch()
  batch.set(db.doc(`dashboard/${parentBoard}`), { kind: 'parent' })
  for (const [position, item] of items.entries()) {
    if (typeof item.token !== 'string' || !/^[A-Za-z0-9_-]{24,}$/.test(item.token) || tokens.has(item.token)) fail('Некорректный или повторный token в manifest.')
    tokens.add(item.token)
    const snapshot = await db.doc(`assignments/${item.token}`).get()
    if (!snapshot.exists) fail(`Назначение с позицией ${position + 1} не найдено.`)
    const assignment = snapshot.data()
    const assignmentErrors = assignmentShapeErrors(assignment)
    if (assignmentErrors.length) fail(`Тест с позицией ${position + 1} нарушает модель Firestore: ${assignmentErrors.join(' ')}`)
    if (assignment.status === 'open') assertQuizOwner(assignment, assignmentOwner())
    validateBoardDetails(item.board)
    const indexEntry = {
      testId: assignment.testId,
      title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : assignment.title,
      description: typeof item.description === 'string' && item.description.trim() ? item.description.trim() : assignment.description ?? '',
      board: item.board,
      subject: assignment.subject,
      slug: assignment.slug,
      previewToken: String(item.previewToken ?? ''),
      createdAt: assignment.createdAt ?? Timestamp.now(),
      position: position + 1,
    }
    batch.set(db.doc(`dashboard/${board}/assignments/${item.token}`), indexEntry)
    batch.set(db.doc(`dashboard/${parentBoard}/assignments/${item.token}`), indexEntry)
  }
  await batch.commit()
  console.log(JSON.stringify({ learnerBoard: `${site}#/my/${board}`, parentBoard: `${site}#/review/${parentBoard}`, count: items.length }, null, 2))
}

async function list() {
  const ownerToken = dashboardToken()
  const snapshot = await db.collection(`dashboard/${ownerToken}/assignments`).get()
  const items = await Promise.all(snapshot.docs.map(async (item) => {
    const assignment = await db.doc(`assignments/${item.id}`).get()
    return {
      testId: item.data().testId,
      title: item.data().title,
      subject: item.data().subject,
      status: assignment.exists ? assignment.data().status : 'revoked',
      learnerToken: item.id,
    }
  }))
  console.log(JSON.stringify(items, null, 2))
}

async function boardStatus() {
  const board = learnerBoardToken()
  const snapshot = await db.collection(`dashboard/${board}/assignments`).get()
  const entries = await Promise.all(snapshot.docs.map(async (item) => {
    const assignment = await db.doc(`assignments/${item.id}`).get()
    const data = assignment.data() ?? {}
    return {
      position: item.data().position ?? null,
      title: item.data().title ?? data.title ?? 'Без названия',
      subject: item.data().subject ?? data.subject ?? null,
      status: assignment.exists ? data.status : 'revoked',
      answeredCount: data.answers && typeof data.answers === 'object' ? Object.keys(data.answers).length : 0,
      totalQuestions: Array.isArray(data.questions) ? data.questions.length : 0,
      submittedAt: data.submittedAt?.toDate?.()?.toISOString?.() ?? null,
    }
  }))
  entries.sort((a, b) => (a.position ?? 9999) - (b.position ?? 9999))
  console.log(JSON.stringify(entries, null, 2))
}

async function syncBoardLinks(apply) {
  const boards = [dashboardToken(), learnerBoardToken(), parentBoardToken()]
  let checked = 0
  let changed = 0
  for (const boardToken of new Set(boards)) {
    const entries = await db.collection(`dashboard/${boardToken}/assignments`).get()
    const batch = db.batch()
    let batchChanges = 0
    for (const entry of entries.docs) {
      const assignment = await db.doc(`assignments/${entry.id}`).get()
      if (!assignment.exists) continue
      checked += 1
      const source = assignment.data()
      if (source.testId !== entry.data().testId) fail(`Идентификатор теста не совпал: ${entry.id}`)
      const linkedToTestId = source.linkedToTestId ?? null
      if (entry.data().linkedToTestId === linkedToTestId) continue
      changed += 1
      batch.update(entry.ref, { linkedToTestId })
      batchChanges += 1
    }
    if (apply && batchChanges) await batch.commit()
  }
  console.log(JSON.stringify({ checked, changed, applied: apply }, null, 2))
}

async function auditAccess(studentPersonId) {
  const owner = assignmentOwner(studentPersonId)
  const board = await db.collection(`dashboard/${learnerBoardToken()}/assignments`).get()
  const active = []
  for (const item of board.docs) {
    const assignment = await db.doc(`assignments/${item.id}`).get()
    if (!assignment.exists || assignment.data().status !== 'open') continue
    assertQuizOwner(assignment.data(), owner)
    active.push({ title: assignment.data().title, status: 'open', familyLinked: true })
  }
  console.log(JSON.stringify({ checked: active.length, active }, null, 2))
}

async function bindFamily(sourcePath, taskId, studentPersonId) {
  if (!sourcePath || !taskId) fail('Укажите исходник дня и точный taskId теста.')
  const source = loadJson(sourcePath)
  const placement = source.testPlacements?.find((item) => item.taskId === taskId)
  if (!placement?.token) fail('Тест с указанным taskId не привязан к исходнику дня.')
  const owner = assignmentOwner(studentPersonId)
  const board = await db.doc(`dashboard/${learnerBoardToken()}/assignments/${placement.token}`).get()
  if (!board.exists) fail('Тест отсутствует в ученическом списке; привязка остановлена.')
  const ref = db.doc(`assignments/${placement.token}`)
  const assignment = await ref.get()
  if (!assignment.exists || assignment.data().status !== 'open') fail('Тест отсутствует или уже завершён.')
  const data = assignment.data()
  if (data.familyId && data.familyId !== owner.familyId || data.childId && data.childId !== owner.childId) fail('У теста другая семейная привязка; исправление остановлено.')
  if (data.familyId !== owner.familyId || data.childId !== owner.childId) await ref.update(owner)
  console.log(JSON.stringify({ taskId, status: 'open', familyLinked: true, answersCount: Object.keys(data.answers || {}).length }, null, 2))
}

async function exportAttempt(learnerToken, outputPath) {
  if (!learnerToken || !outputPath) fail('Использование: npm run quiz -- export TOKEN путь/к/файлу.json')
  const [assignment, key, review] = await Promise.all([
    db.doc(`assignments/${learnerToken}`).get(),
    db.doc(`answerKeys/${learnerToken}`).get(),
    db.doc(`reviews/${learnerToken}`).get(),
  ])
  if (!assignment.exists) fail('Тест не найден.')
  writeFileSync(resolve(outputPath), JSON.stringify({
    assignment: assignment.data(),
    answerKey: key.exists ? key.data() : null,
    review: review.exists ? review.data() : null,
  }, null, 2), { mode: 0o600 })
  console.log(`Результат сохранён в ${resolve(outputPath)}`)
}

/** @see ../docs/modules/assessments/quizzes.md#canonical-short-repair */
async function repairCanonicalShortAnswers(learnerToken, requestPath, guidanceOnly = false) {
  if (!learnerToken || !requestPath) fail('Нужны токен и JSON доказательств.')
  const request = loadJson(requestPath)
  const owner = assignmentOwner()
  const assignmentRef = db.doc(`assignments/${learnerToken}`)
  const keyRef = db.doc(`answerKeys/${learnerToken}`)
  const reviewRef = db.doc(`reviews/${learnerToken}`)
  const [assignmentDoc, keyDoc, reviewDoc] = await Promise.all([assignmentRef.get(), keyRef.get(), reviewRef.get()])
  if (!assignmentDoc.exists || !keyDoc.exists) fail('Назначение или ключ отсутствует.')
  const assignment = assignmentDoc.data(), key = keyDoc.data(), review = reviewDoc.data() ?? null
  assertQuizOwner(assignment, owner)
  const repaired = guidanceOnly ? repairQuestionGuidance(assignment, key, request) : canonicalShortKeyRepair(assignment, key, request)
  const before = summarize(grade(assignment, key, review))
  const after = summarize(grade(assignment, repaired.key, review))
  if (guidanceOnly && JSON.stringify(before) !== JSON.stringify(after)) fail('Разбор не может менять оценку.')
  const apply = process.argv.includes('--apply')
  let backup = null
  if (apply && repaired.changed.length) {
    const folder = resolve(localDir, 'quiz-corrections')
    mkdirSync(folder, { recursive: true })
    backup = resolve(folder, `${assignment.testId}-${Date.now()}.json`)
    writeFileSync(backup, JSON.stringify({ owner, request, assignment, key, review, before, after, repairedKey: repaired.key }, null, 2), { mode: 0o600, flag: 'wx' })
    await db.runTransaction(async (transaction) => {
      const [currentAssignment, currentKey] = await Promise.all([transaction.get(assignmentRef), transaction.get(keyRef)])
      assertQuizOwner(currentAssignment.data(), owner)
      if (correctionFingerprint(currentAssignment.data()) !== correctionFingerprint(assignment)
        || correctionFingerprint(currentKey.data()) !== correctionFingerprint(key)) fail('Состояние изменилось; перечитайте попытку и повторите проверку.')
      transaction.update(keyRef, { entries: repaired.key.entries })
    })
  }
  if (apply) {
    const [actualAssignment, actualKey] = await Promise.all([assignmentRef.get(), keyRef.get()])
    if (correctionFingerprint(actualAssignment.data()) !== correctionFingerprint(assignment)
      || correctionFingerprint(actualKey.data()) !== correctionFingerprint(repaired.key)) fail('Исправление не подтверждено readback.')
  }
  console.log(JSON.stringify({ testId: assignment.testId, changed: repaired.changed, before, after, applied: apply, verified: apply, backup }))
}

async function reviewAttempt(learnerToken, reviewPath) {
  if (!learnerToken) fail('Укажите токен теста.')
  const review = loadJson(reviewPath)
  if (!review.entries || typeof review.entries !== 'object') fail('В файле разбора нужны entries по id вопросов.')
  const assignment = await db.doc(`assignments/${learnerToken}`).get()
  if (!assignment.exists || assignment.data().status !== 'submitted') fail('Отправленная попытка не найдена.')
  await db.doc(`reviews/${learnerToken}`).set({ ...review, updatedAt: Timestamp.now() })
  console.log('Разбор опубликован. Он появится по ученической ссылке.')
}

try {
  if (command === 'validate') {
    validateSpec(loadJson(first), first)
    console.log('Спецификация готова к созданию теста.')
  } else if (command === 'create') await create(first, second)
  else if (command === 'revise-open') await reviseOpenQuiz(first, second, third)
  else if (command === 'history') await exportLineage(first, second, third)
  else if (command === 'board-add') await addToLearnerBoard(first)
  else if (command === 'list') await list()
  else if (command === 'board-status') await boardStatus()
  else if (command === 'sync-links') await syncBoardLinks(first === '--apply')
  else if (command === 'audit-access') await auditAccess(first)
  else if (command === 'bind-family') await bindFamily(first, second, third)
  else if (command === 'export') await exportAttempt(first, second)
  else if (command === 'review') await reviewAttempt(first, second)
  else if (command === 'repair-canonical-short-answers') await repairCanonicalShortAnswers(first, second)
  else if (command === 'repair-question-guidance') await repairCanonicalShortAnswers(first, second, true)
  else fail('Команды: validate SPEC.json | create SPEC.json [PERSON_ID] | revise-open TOKEN SPEC.json PERSON_ID | history TOKEN .local/OUTPUT.json [PLAN.json] | board-add MANIFEST.json | board-status | sync-links [--apply] | audit-access | list | export TOKEN OUTPUT.json | review TOKEN REVIEW.json')
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
