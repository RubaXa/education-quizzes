import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'

const projectId = 'education-9d7c6'
const site = 'https://rubaxa.github.io/education-quizzes/'
const localDir = resolve('.local')
const dashboardTokenFile = resolve(localDir, 'dashboard-token')

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

function fail(message) {
  throw new Error(message)
}

function loadJson(path) {
  if (!path) fail('Укажите путь к JSON-файлу.')
  return JSON.parse(readFileSync(resolve(path), 'utf8'))
}

function validateSpec(spec) {
  if (typeof spec.title !== 'string' || !spec.title.trim()) fail('Не указано название теста.')
  if (typeof spec.subject !== 'string' || !spec.subject.trim()) fail('Не указан предмет.')
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(spec.slug ?? '')) fail('slug должен содержать латинские буквы, цифры и дефисы.')
  if (!Array.isArray(spec.questions) || !spec.questions.length || spec.questions.length > 100) fail('Нужно от 1 до 100 вопросов.')
  const ids = new Set()
  for (const question of spec.questions) {
    if (!question.id || ids.has(question.id)) fail('У каждого вопроса должен быть уникальный id.')
    ids.add(question.id)
    if (!['single', 'multiple', 'short', 'number', 'long', 'figure'].includes(question.kind)) fail(`Неизвестный тип вопроса ${question.id}.`)
    if (typeof question.prompt !== 'string' || !question.prompt.trim()) fail(`Нет текста вопроса ${question.id}.`)
    if (!Number.isFinite(question.points) || question.points <= 0) fail(`Некорректные баллы вопроса ${question.id}.`)
    if (question.kind !== 'long' && question.answer?.correct === undefined) fail(`Нет ключа для вопроса ${question.id}.`)
    if (['single', 'multiple', 'figure'].includes(question.kind) && (!Array.isArray(question.options) || question.options.length < 2)) fail(`Нужно минимум два варианта в ${question.id}.`)
  }
}

prepareLocalFirebaseLogin()
initializeApp({ credential: applicationDefault(), projectId })
const db = getFirestore()
const [command, first, second] = process.argv.slice(2)

async function create(specPath) {
  const spec = loadJson(specPath)
  validateSpec(spec)
  const learnerToken = token()
  const previewToken = token()
  const ownerToken = dashboardToken()
  const testId = token(12)
  const publicQuestions = spec.questions.map(({ answer: _answer, ...question }) => question)
  const entries = Object.fromEntries(spec.questions.map((question) => [question.id, question.answer ?? {}]))
  const createdAt = Timestamp.now()
  const assignment = {
    schemaVersion: 1,
    testId,
    title: spec.title,
    description: spec.description ?? '',
    subject: spec.subject,
    slug: spec.slug,
    linkedToTestId: spec.linkedToTestId ?? null,
    questions: publicQuestions,
    status: 'open',
    answers: {},
    startedAt: null,
    updatedAt: null,
    submittedAt: null,
    createdAt,
  }
  const batch = db.batch()
  batch.create(db.doc(`assignments/${learnerToken}`), assignment)
  batch.create(db.doc(`answerKeys/${learnerToken}`), { entries })
  batch.create(db.doc(`previews/${previewToken}`), {
    testId,
    title: spec.title,
    description: spec.description ?? '',
    subject: spec.subject,
    questions: publicQuestions,
    createdAt,
  })
  batch.create(db.doc(`dashboard/${ownerToken}/assignments/${learnerToken}`), {
    testId,
    title: spec.title,
    subject: spec.subject,
    slug: spec.slug,
    previewToken,
    createdAt,
  })
  await batch.commit()
  console.log(JSON.stringify({
    testId,
    learner: `${site}#/t/${spec.slug}~${learnerToken}`,
    preview: `${site}#/preview/${spec.slug}~${previewToken}`,
    dashboard: `${site}#/dashboard/${ownerToken}`,
  }, null, 2))
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
  if (command === 'create') await create(first)
  else if (command === 'list') await list()
  else if (command === 'export') await exportAttempt(first, second)
  else if (command === 'review') await reviewAttempt(first, second)
  else fail('Команды: create SPEC.json | list | export TOKEN OUTPUT.json | review TOKEN REVIEW.json')
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
