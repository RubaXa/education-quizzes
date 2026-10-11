import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { linksFile as pageLinksFile, materialLinks, materialPlan, preparePages, taskPageRefs } from '../storage/material-pages.mjs'
import { buildDaySource } from '../day/build.mjs'
import { assertWeekendWorkRetention, buildDayDashboardIndex } from '../day/dashboard-index.mjs'
import { mergeDayPage } from '../day/merge.mjs'
import { assertPublishedPageAligned, assertSourceAligned, sourcePlanFingerprint } from '../day/pipeline-contract.mjs'
import { assertGradeSnapshotAligned, detectGradeChange } from '../day/grade-reconciliation.mjs'
import { YandexDiskStorage } from '../storage/yandex-disk.mjs'
import { stageFamilyNotice } from '../storage/inbox-notifications.mjs'
import { lessonVisibility } from '../diary/application/lesson-visibility.mjs'

const local = resolve('.local')
const site = 'https://rubaxa.github.io/education-quizzes/'
const linksFile = resolve(local, 'day-links.json')
const dashboardLinksFile = resolve(local, 'day-dashboard-links.json')
const [command, date, third] = process.argv.slice(2)

function fail(message) { throw new Error(message) }
function json(path) { return JSON.parse(readFileSync(path, 'utf8')) }
function latestCompleteDiarySnapshot() {
  const directory = resolve(local, 'diary')
  const names = readdirSync(directory).filter((name) => /^snapshot-\d{4}-\d{2}-\d{2}\.json$/.test(name))
  const snapshots = names.map((name) => json(resolve(directory, name))).filter((snapshot) => snapshot.complete)
  return snapshots.sort((a, b) => String(b.fetchedAt).localeCompare(String(a.fetchedAt)))[0]
}
function dashboardLinks() {
  return existsSync(dashboardLinksFile) ? json(dashboardLinksFile) : {
    student: randomBytes(32).toString('base64url'),
    parent: randomBytes(32).toString('base64url'),
  }
}
/** @see ../docs/product/dashboard.md#firestore-model */
async function addDashboardDocuments(batch, links, tokens, stagedPages = {}) {
  const ownerFile = resolve(local, 'family-access.json')
  const owner = existsSync(ownerFile) ? json(ownerFile).legacyDayOwner : null
  if (!owner?.familyId || !owner?.childId) fail('Сначала привяжите страницы дня к ребёнку командой family attach-current-day.')
  const members = await db.collection(`families/${owner.familyId}/members`).get()
  for (const role of ['student', 'parent']) {
    const ref = db.doc(`dayDashboards/${tokens[role]}`)
    const previous = (await ref.get()).data()
    const previousDays = new Map((previous?.days ?? []).map((day) => [day.date, day]))
    const index = buildDayDashboardIndex(local, links, role)
    const removalFile = resolve(local, 'weekend-slot-removals.json')
    const removals = existsSync(removalFile) ? json(removalFile).removals : []
    assertWeekendWorkRetention(previous?.weekendWork, index.weekendWork, removals)
    const checkedTokens = new Set()
    for (const day of index.days) {
      const token = day.homeworkDayToken
      if (!token || checkedTokens.has(token)) continue
      checkedTokens.add(token)
      const sourceDate = Object.entries(links).find(([, pair]) => pair?.[role] === token)?.[0]
      if (!sourceDate) fail(`Индекс ${role} ссылается на неизвестную страницу дня.`)
      const source = json(resolve(local, `day-source-${sourceDate}.json`))
      const snapshot = json(resolve(local, `diary/snapshot-${source.targetDate}.json`))
      assertSourceAligned(source, snapshot)
      const page = stagedPages[token] ?? (await db.doc(`dayPages/${token}`).get()).data()
      assertPublishedPageAligned(source, page, role)
    }
    const notifications = []
    const days = index.days.map((day) => {
      const before = previousDays.get(day.date)
      const priorHomework = new Map((before?.homework ?? []).map((item) => [item.subject, item.text]))
      const subjects = before ? day.homework.filter((item) => priorHomework.get(item.subject) !== item.text).map((item) => item.subject) : []
      for (const subject of subjects) notifications.push({ date: day.date, subject, type: priorHomework.has(subject) ? 'homework_changed' : 'homework_published', text: day.homework.find((item) => item.subject === subject)?.text ?? '' })
      if (before) for (const [subject] of priorHomework) {
        if (!day.homework.some((item) => item.subject === subject)) notifications.push({ date: day.date, subject, type: 'homework_removed', text: '' })
      }
      const homeworkUpdate = subjects.length ? { at: new Date().toISOString(), subjects } : before?.homeworkUpdate
      return homeworkUpdate ? { ...day, homeworkUpdate } : day
    })
    batch.set(ref, {
      ...index, days,
      familyId: owner.familyId, childId: owner.childId, updatedAt: Timestamp.now(),
    })
    for (const member of members.docs) {
      const access = member.data()
      if (access.active !== true || access.role !== role || !Array.isArray(access.childIds) || !access.childIds.includes(owner.childId)) continue
      for (const change of notifications) {
        const fingerprint = createHash('sha256').update(JSON.stringify([owner.childId, change.date, change.subject, change.type, change.text, index.days.find((day) => day.date === change.date)?.checkedAt])).digest('hex').slice(0, 40)
        batch.set(db.doc(`users/${member.id}/inbox/${fingerprint}`), {
          familyId: owner.familyId, childId: owner.childId, type: change.type,
          entityId: `${change.date}:${change.subject}`, date: change.date, subject: change.subject,
          sourceRevision: Date.parse(index.days.find((day) => day.date === change.date)?.checkedAt ?? '') || Date.now(),
          createdAt: Timestamp.now(),
        })
      }
    }
  }
}
/** Read back committed role documents before reporting a successful release. */
async function verifyPublishedDay(source, pair, indexTokens, links) {
  for (const role of ['student', 'parent']) {
    const token = pair[role]
    const [pageDoc, dashboardDoc] = await Promise.all([
      db.doc(`dayPages/${token}`).get(), db.doc(`dayDashboards/${indexTokens[role]}`).get(),
    ])
    assertPublishedPageAligned(source, pageDoc.data(), role)
    const indexed = dashboardDoc.data()?.days?.find((item) => item.date === source.targetDate)
    const expected = buildDayDashboardIndex(local, links, role).days.find((item) => item.date === source.targetDate)
    if (!indexed || !expected || indexed.dayToken !== expected.dayToken
      || indexed.homeworkDayToken !== expected.homeworkDayToken
      || JSON.stringify(indexed.homework) !== JSON.stringify(expected.homework)) {
      fail(`После записи индекс ${role} не указывает на опубликованный день ${source.targetDate}.`)
    }
  }
}
async function verifyPublishedIndex(links, indexTokens) {
  for (const role of ['student', 'parent']) {
    const expected = buildDayDashboardIndex(local, links, role)
    const published = (await db.doc(`dayDashboards/${indexTokens[role]}`).get()).data()
    const keys = ['date', 'checkedAt', 'complete', 'schedule', 'homework', 'dayToken', 'homeworkDayToken']
    const comparable = (days) => days?.map((day) => Object.fromEntries(keys.map((key) => [key, day[key]])))
    if (published?.kind !== role
      || JSON.stringify(comparable(published.days)) !== JSON.stringify(comparable(expected.days))
      || JSON.stringify(published.weekendWork) !== JSON.stringify(expected.weekendWork)) {
      fail(`Опубликованный индекс ${role} не совпадает с полным проверенным горизонтом.`)
    }
  }
}
function nextCalendarDate(value, days) { const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10) }
/** The student Firestore document must not carry parent-only source research. @see ../docs/product/adaptive-problem-card.md#происхождение-задачи */
function studentSubjects(subjects) {
  return subjects.map((subject) => ({ ...subject, tasks: subject.tasks.map((task) => ({ ...task,
    ...(task.problems ? { problems: task.problems.map(({ sourceResearch: _sourceResearch, ...problem }) => problem) } : {}),
  })) }))
}
function runLocal(script, args) { execFileSync(process.execPath, [script, ...args], { cwd: resolve('.'), stdio: 'inherit' }) }
function refresh() {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) fail('Укажите дату YYYY-MM-DD.')
  runLocal('diary/cli.mjs', ['sync', '--date', date])
  let targetDate = null
  for (let ahead = 1; ahead <= 14; ahead += 1) {
    const candidate = nextCalendarDate(date, ahead)
    runLocal('diary/cli.mjs', ['sync', '--date', candidate])
    const snapshot = json(resolve(local, `diary/snapshot-${candidate}.json`))
    if (lessonVisibility(snapshot.schedule).conducted.some((lesson) => !lesson.cancelled)) { targetDate = candidate; break }
  }
  if (!targetDate) fail('Не найден следующий учебный день в двухнедельном расписании МЭШ.')
  for (const day of [date, targetDate]) {
    try { runLocal('diary/cli.mjs', ['files', '--date', day]) }
    catch { console.warn(`Вложения МЭШ на ${day} скачаны не полностью; исходные ссылки останутся в плане.`) }
  }
  const target = json(resolve(local, `diary/snapshot-${targetDate}.json`))
  const teacherMaterials = (target.assignments || []).flatMap((item) => item.teacherFiles || [])
    .filter((item) => /\.(png|jpe?g|webp|pdf)(?:\?|$)/i.test(item.title || item.url || ''))
  if (teacherMaterials.length) runLocal('scripts/storage.mjs', ['sync-teacher', targetDate])
  console.log(JSON.stringify(buildDaySource(local, date), null, 2))
}
function prepareLogin() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return
  const loginFile = resolve(local, 'config/configstore/firebase-tools.json')
  if (!existsSync(loginFile)) fail('Сначала войдите через Firebase CLI.')
  const login = json(loginFile)
  if (!login.tokens?.refresh_token) fail('Вход Firebase CLI устарел.')
  const require = createRequire(import.meta.url)
  const { clientId, clientSecret } = require('firebase-tools/lib/api')
  const file = resolve(local, 'adc.json')
  writeFileSync(file, JSON.stringify({ type: 'authorized_user', client_id: clientId(), client_secret: clientSecret(), refresh_token: login.tokens.refresh_token }), { mode: 0o600 })
  process.env.GOOGLE_APPLICATION_CREDENTIALS = file
}
function time(value) { return new Date(value).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' }) }
/** @see ../docs/architecture/school-diary-port-adapter.md#visibility */
function schedule(snapshot) {
  return lessonVisibility(snapshot.schedule).conducted.filter((item) => !item.cancelled).map((item) => ({
    subject: item.subject_name.includes('Специальный курс') ? 'Спецкурс по математике' : item.subject_name.replace('Иностранный (английский) язык', 'Английский язык'),
    start: time(item.start_at), end: time(item.finish_at),
    homework: item.homework?.descriptions?.join('; ') ?? '',
  }))
}
function gradeSummary(snapshot) {
  return snapshot.subjects.map(({ id, name, displayed_average, grades }) => {
    const points = grades.reduce((sum, [mark, weight]) => sum + mark * weight, 0)
    const weight = grades.reduce((sum, [, value]) => sum + value, 0)
    const afterFour = (points + 4) / (weight + 1)
    return {
      id, name, average: displayed_average,
      allFives: grades.length > 0 && grades.every(([mark]) => mark === 5),
      watch: displayed_average < snapshot.working_threshold || afterFour < snapshot.working_threshold,
    }
  })
}
/** @see ../docs/product/plan-generation.md#review-gate */
function validateAssignedInstruction(item, task, sourceDocument) {
  if (!item || typeof item !== 'object' || !item.text?.trim() || !item.source?.label?.trim() || !item.source?.evidence?.trim() || item.source.certainty !== 'confirmed') {
    fail(`Обязательный пункт ${task.id} без подтверждённого источника. Не публикуйте домысел как ДЗ.`)
  }
  if (item.source.kind === 'mesh') {
    if (!item.source.excerpt?.trim() || !task.meshText?.includes(item.source.excerpt) || item.source.evidence !== task.meshText) fail(`Для пункта ${task.id} нужна дословная опора в МЭШ.`)
  } else if (item.source.kind === 'textbook') {
    if (!materialPlan.taskPages[task.id]?.some((pageId) => item.source.ref?.startsWith(pageId))) fail(`Для пункта ${task.id} нужна сверенная страница учебника.`)
  } else if (item.source.kind === 'teacher-file') {
    if (!sourceDocument.materialLinks?.[task.id]?.some((link) => link.sourceType === 'teacher-attachment' && link.title === item.source.ref)) {
      fail(`Для пункта ${task.id} нужен исходный файл учителя из МЭШ.`)
    }
  } else fail(`Пункт ${task.id} не может добавлять к заданию МЭШ обязательную работу от агента или прежнего разбора.`)
}
function validSourceCrop(crop, link) {
  if (!crop || !link?.sourceSha256 || crop.sourceSha256 !== link.sourceSha256) return false
  if (!/^[a-f0-9]{64}$/.test(crop.sourceSha256)) return false
  if (!['x', 'y', 'width', 'height', 'sourceWidth', 'sourceHeight'].every((key) => Number.isInteger(crop[key]))) return false
  return crop.x >= 0 && crop.y >= 0 && crop.width >= 10 && crop.height >= 10
    && crop.sourceWidth > 0 && crop.sourceHeight > 0
    && crop.x + crop.width <= crop.sourceWidth && crop.y + crop.height <= crop.sourceHeight
}

function validate(source) {
  if (!source || !Array.isArray(source.subjects) || !source.subjects.length) fail('В исходнике нужны subjects.')
  const ids = new Set()
  const subjectIds = new Set()
  for (const subject of source.subjects) {
    if (!subject.id || subjectIds.has(subject.id) || !subject.name || !Array.isArray(subject.tasks)) fail('У предмета нужны уникальный id, name и tasks.')
    subjectIds.add(subject.id)
    for (const task of subject.tasks) {
      if (!/^[a-z0-9-]+$/.test(task.id ?? '') || ids.has(task.id) || !task.title) fail('Нужны уникальные id и названия действий.')
      ids.add(task.id)
      if (task.problems != null) {
        if (task.kind !== 'written' || !Array.isArray(task.problems) || !task.problems.length) fail(`У ${task.id} номера допустимы только для письменной работы.`)
        if (task.problems.some((problem) => problem.original?.crop) && task.problems.some((problem) => !problem.original?.crop)) {
          fail(`У ${task.id} фрагменты исходного листа нужны для каждого номера.`)
        }
        const numbers = new Set()
        for (const problem of task.problems) {
          if (!/^[a-z0-9-]+$/.test(problem.id ?? '') || !problem.id.startsWith(`${task.id}-p`) || ids.has(problem.id)
            || !Number.isInteger(problem.number) || numbers.has(problem.number)
            || !problem.title?.trim() || !problem.detail?.trim() || !problem.source?.trim()) fail(`У ${task.id} каждый номер должен иметь устойчивый ID, условие и источник.`)
          // @see ../docs/product/adaptive-problem-card.md#выпуск-и-безопасность
          const sourceLink = source.materialLinks?.[task.id]?.find((link) => link.sourceType === 'teacher-attachment' && link.sourceRef === problem.original?.attachmentRef)
          if (!problem.original?.text?.trim() || !problem.original?.attachmentRef?.trim() || !sourceLink) {
            fail(`У ${problem.id} нужен дословно сверенный текст и исходный лист учителя.`)
          }
          if (problem.original.crop && !validSourceCrop(problem.original.crop, sourceLink)) {
            fail(`У ${problem.id} неверные координаты фрагмента или хэш оригинального листа.`)
          }
          if (problem.sourceResearch && (!['candidate', 'verified', 'not-found', 'conflict'].includes(problem.sourceResearch.status)
            || !problem.sourceResearch.title?.trim() || !problem.sourceResearch.match?.trim()
            || !['not-checked', 'candidate', 'verified', 'unavailable'].includes(problem.sourceResearch.keyStatus)
            || (problem.sourceResearch.url && !/^https:\/\//.test(problem.sourceResearch.url)))) {
            fail(`У ${problem.id} неполные сведения об источнике задачи.`)
          }
          const support = problem.support
          if (!support?.skill?.trim() || !['unknown', 'provisional', 'practicing', 'demonstrated'].includes(support.state)
            || !support.evidence?.trim() || !Array.isArray(support.evidenceRefs) || !support.evidenceRefs.length
            || !Array.isArray(support.facts) || support.facts.some((fact) => !fact.label?.trim() || !fact.value?.trim())
            || !support.find?.trim() || !support.firstQuestion?.trim() || !Number.isInteger(support.revision) || support.revision < 1) {
            fail(`У ${problem.id} нет проверяемого педагогического слоя с первым вопросом.`)
          }
          ids.add(problem.id)
          numbers.add(problem.number)
        }
      }
      if (task.id.startsWith('mesh-')) {
        if (task.instructionStatus?.state === 'needs-review' && (task.detail !== task.meshText || task.kind !== 'check' || task.steps?.length || task.submission)) fail(`У ${task.id} разбор ещё не сверен: показывайте только точный текст МЭШ без добавленных действий и фото.`)
        if (task.instructionStatus?.state === 'reviewed') for (const step of task.steps ?? []) validateAssignedInstruction(step, task, source)
        for (const item of task.submission?.items ?? []) validateAssignedInstruction(item, task, source)
      }
    }
  }
  if (!Array.isArray(source.retiredTaskIds ?? []) || (source.retiredTaskIds ?? []).some((id) => !/^mesh-\d+$/.test(id) || ids.has(id))
    || new Set(source.retiredTaskIds ?? []).size !== (source.retiredTaskIds ?? []).length) fail('Перенесённые задания должны иметь уникальные ID и отсутствовать в текущем списке.')
  for (const [taskId, links] of Object.entries(source.materialLinks ?? {})) {
    if (!ids.has(taskId) || !Array.isArray(links)) fail(`Ссылки на материал должны относиться к существующему заданию: ${taskId}.`)
    const task = source.subjects.flatMap((subject) => subject.tasks).find((item) => item.id === taskId)
    for (const link of links) {
      if (!link.title || !/^https:\/\//.test(link.url ?? '') || !['textbook-page', 'teacher-attachment', 'external-text'].includes(link.sourceType)) fail(`У ссылки ${taskId} нужны HTTPS, название и тип источника.`)
      if (link.sourceType === 'teacher-attachment' && /\.(png|jpe?g|webp|pdf)(?:\?|$)/i.test(decodeURIComponent(new URL(link.url).pathname)) && new URL(link.url).hostname === 'school.mos.ru') {
        fail(`Файл учителя для ${taskId} ещё не перенесён на Яндекс.Диск. Запустите storage sync-teacher и обновите исходник дня.`)
      }
      if (link.sourceType === 'external-text' && (task.materialStatus?.state !== 'text-absent-from-textbook' || !link.reason)) fail(`Внешний текст для ${taskId} допустим только после подтверждения его отсутствия в учебнике и с объяснением.`)
    }
  }
  // @see ../docs/product/plan-generation.md#material-only-mesh-entries
  for (const entry of source.sourceOnlyEntries ?? []) {
    const target = source.subjects.find((subject) => subject.id === entry.subjectId)?.tasks.find((task) => task.id === entry.targetTaskId)
    const subject = source.subjects.find((item) => item.id === entry.subjectId)
    if (!/^mesh-\d+$/.test(entry.id ?? '') || ids.has(entry.id) || !target || target.kind !== 'written'
      || !entry.rawText?.trim() || !subject?.mesh?.includes(entry.rawText)
      || !entry.reason?.trim() || !(source.materialLinks?.[target.id] ?? []).some((link) => link.sourceType === 'teacher-attachment')) {
      fail(`Ссылка МЭШ ${entry.id} может быть исключена из действий только при подтверждённом общем файле учителя.`)
    }
  }
  if ((source.materialLinkReplacements ?? []).some((taskId) => !ids.has(taskId))) fail('Заменять материалы можно только для существующего задания.')
  const testTokens = new Set()
  for (const placement of source.testPlacements ?? []) {
    if (!placement.token || testTokens.has(placement.token) || !subjectIds.has(placement.subjectId)) fail('Нужны уникальные токены тестов и существующие предметы.')
    testTokens.add(placement.token)
    if (placement.taskId) {
      const subject = source.subjects.find((item) => item.id === placement.subjectId)
      const task = subject.tasks.find((item) => item.id === placement.taskId)
      if (!task || task.testToken !== placement.token) fail('Тест внутри задания должен совпадать с testToken этого задания.')
    }
  }
  // @see ../docs/product/day-page.md#test-progress
  for (const subject of source.subjects) for (const task of subject.tasks) {
    if (task.kind !== 'read') continue
    if (!task.testToken || !task.testSlug || !(source.testPlacements ?? []).some((placement) => placement.taskId === task.id && placement.subjectId === subject.id && placement.token === task.testToken)) {
      fail(`Устный пункт ${task.id} опубликован без связанной самопроверки Education.`)
    }
  }
  const evidenceIds = new Set()
  for (const evidence of source.historicalUploads ?? []) {
    if (!/^[a-z0-9-]+$/.test(evidence.id ?? '') || evidenceIds.has(evidence.id) || !Array.isArray(evidence.taskIds) || !evidence.taskIds.length || !evidence.taskIds.every((id) => ids.has(id))) fail('Архивному фото нужны уникальный id и существующие taskIds.')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(evidence.recordedDate ?? '') || !/^[a-z0-9-]+\.jpg$/.test(evidence.file ?? '')) fail('Архивному фото нужны дата и локальный JPEG.')
    evidenceIds.add(evidence.id)
  }
  return [...ids]
}

/** Carry a completed platform result between two views of the same assignment date. @see ../docs/product/plan-generation.md#cross-day-results */
async function reconcileEarlierEvidence(source, studentToken) {
  const owner = json(resolve(local, 'family-access.json')).legacyDayOwner
  if (!owner?.childId) fail('Нельзя сопоставить старые результаты без владельца страницы.')
  const tokens = [...new Set([studentToken, ...(source.evidenceDayTokens ?? [])])]
  const pages = []
  for (const token of tokens) {
    const [ownerDoc, pageDoc] = await Promise.all([db.doc(`dayOwners/${token}`).get(), db.doc(`dayPages/${token}`).get()])
    if (!pageDoc.exists) continue
    if (ownerDoc.data()?.childId !== owner.childId || pageDoc.data().kind !== 'student') fail('Источник предыдущего результата принадлежит другой странице или ребёнку.')
    pages.push({ token, page: pageDoc.data() })
  }
  for (const entry of source.sourceOnlyEntries ?? []) {
    for (const { token } of pages) {
      const [progress, uploads] = await Promise.all([
        db.doc(`dayProgress/${token}/items/${entry.id}`).get(),
        db.collection(`dayUploads/${token}/files`).get(),
      ])
      if (progress.exists || uploads.docs.some((upload) => upload.data().status !== 'deleted'
        && (upload.data().taskId === entry.id || upload.data().coveredTaskIds?.includes(entry.id)))) {
        fail(`У ссылки МЭШ ${entry.id} уже есть работа или разбор; нельзя скрыть её как простой файл.`)
      }
    }
  }
  for (const subject of source.subjects) for (const task of subject.tasks) {
    if (task.kind !== 'check' || !task.id.endsWith('-cdz') || task.platformResult?.state === 'completed') continue
    const candidates = pages.filter(({ page }) => page.targetDate === source.targetDate)
      .flatMap(({ page }) => page.subjects?.flatMap((item) => item.tasks ?? []) ?? [])
      .filter((prior) => prior.id === task.id && prior.meshText === task.meshText && prior.platformResult?.state === 'completed')
      .sort((a, b) => (b.platformResult.observedDate ?? '').localeCompare(a.platformResult.observedDate ?? ''))
    if (!candidates.length) continue
    if (candidates.length > 1 && candidates[0].platformResult.observedDate === candidates[1].platformResult.observedDate
      && JSON.stringify(candidates[0].platformResult) !== JSON.stringify(candidates[1].platformResult)) {
      fail(`У ЦДЗ ${task.id} конфликт результатов с одной датой; требуется сверка.`)
    }
    if (task.status === 'unknown' || task.status === 'verified') {
      task.status = 'verified'
      task.platformResult = candidates[0].platformResult
    }
  }
}

/** @see ../docs/product/access-and-state.md#state */
async function publish() {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) fail('Укажите дату YYYY-MM-DD.')
  const sourceFile = resolve(local, `day-source-${date}.json`)
  if (!existsSync(sourceFile)) fail(`Нет ${sourceFile}`)
  const source = json(sourceFile)
  const taskIds = validate(source)
  const today = json(resolve(local, `diary/snapshot-${date}.json`))
  const target = json(resolve(local, `diary/snapshot-${source.targetDate}.json`))
  if (!today?.complete) fail(`Для ${date} нужен полный снимок МЭШ.`)
  assertSourceAligned(source, target)
  const pageRefs = Object.fromEntries(Object.entries(taskPageRefs()).filter(([taskId]) => taskIds.includes(taskId)))
  // A newly synced assignment must never silently go live with an unchecked textbook source.
  // @see ../docs/product/materials.md#mandatory-source-link
  for (const task of source.subjects.flatMap((subject) => subject.tasks)) {
    const state = task.materialStatus?.state
    const hasPages = Boolean(pageRefs[task.id]?.length)
    const hasTeacherFile = source.materialLinks?.[task.id]?.some((link) => link.sourceType === 'teacher-attachment')
    if (state === 'textbook-page-needed' || (task.id.startsWith('mesh-') && !hasPages && !hasTeacherFile && !['no-textbook', 'text-absent-from-textbook'].includes(state))) {
      fail(`Источник ${task.id} ещё не сверён с учебником. Укажите точные страницы в .local/material-pages.json или причину отсутствия учебника; день не опубликован.`)
    }
    if (state === 'textbook-page-linked' && !hasPages) fail(`Для ${task.id} нет привязки к индексированной странице учебника.`)
    if (['no-textbook', 'text-absent-from-textbook'].includes(state) && !task.materialStatus?.message?.trim()) fail(`Для ${task.id} нужна причина отсутствия учебника.`)
  }
  const knownBefore = existsSync(pageLinksFile) ? json(pageLinksFile) : {}
  const neededPageIds = new Set(Object.keys(pageRefs).flatMap((taskId) => materialPlan.taskPages[taskId] || []))
  const preparedPages = new Map(preparePages().map((entry) => [entry.id, entry]))
  if ([...neededPageIds].some((id) => !knownBefore[id]?.publicUrl || knownBefore[id].imageSha256 !== preparedPages.get(id)?.imageSha256)) {
    runLocal('scripts/storage.mjs', ['sync-pages'])
  }
  const gradeSnapshot = json(resolve('../learner/grade-snapshot.json'))
  assertGradeSnapshotAligned(gradeSnapshot, latestCompleteDiarySnapshot())
  const links = existsSync(linksFile) ? json(linksFile) : {}
  const publishedPageLinks = existsSync(pageLinksFile) ? materialLinks(json(pageLinksFile)) : {}
  const allMaterialLinks = { ...(source.materialLinks || {}) }
  for (const [taskId, pageLinks] of Object.entries(publishedPageLinks)) allMaterialLinks[taskId] = [...pageLinks, ...(allMaterialLinks[taskId] || [])]
  for (const task of source.subjects.flatMap((subject) => subject.tasks)) {
    if (pageRefs[task.id]?.length && (publishedPageLinks[task.id]?.length ?? 0) !== pageRefs[task.id].length) {
      fail(`Для ${task.id} опубликованы не все страницы учебника: ${publishedPageLinks[task.id]?.length ?? 0} из ${pageRefs[task.id].length}.`)
    }
    if (task.materialStatus?.state === 'textbook-page-linked' && !allMaterialLinks[task.id]?.some((link) => link.sourceType === 'textbook-page')) fail(`Для ${task.id} указан учебник, но ссылка на точную страницу пока не опубликована.`)
  }
  if (!links[date]) links[date] = { student: randomBytes(32).toString('base64url'), parent: randomBytes(32).toString('base64url') }
  const pair = links[date]
  await reconcileEarlierEvidence(source, pair.student)
  const indexTokens = dashboardLinks()
  const base = {
    schemaVersion: 1, date, targetDate: source.targetDate, updatedAt: Timestamp.now(),
    meshFetchedAt: target.fetchedAt, todaySchedule: schedule(today), targetSchedule: schedule(target),
    subjects: source.subjects, taskIds, testPlacements: source.testPlacements ?? [], notices: source.notices ?? [],
    sourceOnlyEntries: source.sourceOnlyEntries ?? [], retiredTaskIds: source.retiredTaskIds ?? [],
    weekendSlot: source.weekendSlot ?? null, sourcePlanFingerprint: sourcePlanFingerprint(source),
    materialLinks: allMaterialLinks, materialLinkReplacements: source.materialLinkReplacements ?? [],
    taskPageRefs: pageRefs,
    evidenceDayTokens: [...new Set([pair.student, ...(source.evidenceDayTokens || [])])],
    gradeSummary: gradeSummary(gradeSnapshot), gradeAsOf: gradeSnapshot.observed_at,
    grades: gradeSnapshot.subjects.map((subject) => ({ id: subject.id, name: subject.name, displayed_average: subject.displayed_average, scenario_verified: gradeSnapshot.scenarios_verified === true, grades: subject.grades.map(([mark, weight]) => ({ mark, weight })) })),
    workingThreshold: gradeSnapshot.working_threshold,
  }
  const batch = db.batch()
  const [oldStudent, oldParent] = await Promise.all([db.doc(`dayPages/${pair.student}`).get(), db.doc(`dayPages/${pair.parent}`).get()])
  const studentPage = mergeDayPage(oldStudent.data(), { ...base, subjects: studentSubjects(source.subjects), kind: 'student', boardToken: readFileSync(resolve(local, 'learner-board-token'), 'utf8').trim() })
  const parentPage = mergeDayPage(oldParent.data(), { ...base, kind: 'parent', studentToken: pair.student, boardToken: readFileSync(resolve(local, 'parent-board-token'), 'utf8').trim(), parentNotes: source.parentNotes ?? [] })
  batch.set(db.doc(`dayPages/${pair.student}`), studentPage)
  batch.set(db.doc(`dayPages/${pair.parent}`), parentPage)
  await addDashboardDocuments(batch, links, indexTokens, { [pair.student]: studentPage, [pair.parent]: parentPage })
  const familyAccessFile = resolve(local, 'family-access.json')
  const familyOwner = existsSync(familyAccessFile) ? json(familyAccessFile).legacyDayOwner : null
  if (familyOwner?.familyId && familyOwner?.childId && oldParent.exists) {
    const before = new Map((oldParent.data().grades ?? []).map((subject) => [subject.id, subject]))
    for (const subject of base.grades) {
      const prior = before.get(subject.id)
      const change = detectGradeChange(prior, subject)
      if (!change) continue
      const fingerprint = createHash('sha256').update(JSON.stringify([subject.id, subject.displayed_average,
        subject.grades.map((grade) => `${grade.mark}:${grade.weight}`).sort()])).digest('hex')
      await stageFamilyNotice(db, batch, { ...familyOwner, key: `grade:${familyOwner.childId}:${subject.id}:${fingerprint}`, mode: 'create',
        data: { type: change.type, entityId: subject.id, subject: subject.name,
          title: change.type === 'grade_added' ? 'Появилась новая оценка' : 'Оценки уточнены',
          body: change.type === 'grade_added' && change.added.length === 1 ? `Новая отметка: ${change.added[0][0]}. Посмотрите, как изменился средний балл.` : 'Откройте обновлённую сводку оценок.',
          sourceRevision: Date.parse(gradeSnapshot.observed_at) || Date.now() } })
    }
  }
  await batch.commit()
  await verifyPublishedDay(source, pair, indexTokens, links)
  await verifyPublishedIndex(links, indexTokens)
  mkdirSync(local, { recursive: true })
  writeFileSync(linksFile, JSON.stringify(links, null, 2), { mode: 0o600 })
  writeFileSync(dashboardLinksFile, JSON.stringify(indexTokens, null, 2), { mode: 0o600 })
  console.log(JSON.stringify({ student: `${site}#/day/${pair.student}`, parent: `${site}#/day-parent/${pair.parent}`, tasks: taskIds.length }, null, 2))
}

async function publishDashboard() {
  const links = existsSync(linksFile) ? json(linksFile) : {}
  for (const role of ['student', 'parent']) {
    const index = buildDayDashboardIndex(local, links, role)
    for (const slot of index.weekendWork) {
      const page = (await db.doc(`dayPages/${slot.dayToken}`).get()).data()
      if (page?.kind !== role || page.targetDate !== slot.lessonDate
        || !slot.taskIds.every((id) => page.taskIds?.includes(id))
        || JSON.stringify(page.weekendSlot?.taskIds) !== JSON.stringify(slot.taskIds)
        || JSON.stringify(page.weekendSlot?.dates) !== JSON.stringify(slot.dates)
        || page.weekendSlot?.title !== slot.title
        || (page.weekendSlot?.dueDate || slot.dueDate) !== slot.dueDate) {
        fail(`Выходная карточка ${slot.title} не совпадает с опубликованной страницей ${role}. Сначала выпустите её через day publish.`)
      }
    }
  }
  const indexTokens = dashboardLinks()
  const batch = db.batch()
  await addDashboardDocuments(batch, links, indexTokens)
  await batch.commit()
  await verifyPublishedIndex(links, indexTokens)
  writeFileSync(dashboardLinksFile, JSON.stringify(indexTokens, null, 2), { mode: 0o600 })
  console.log(JSON.stringify({ student: `${site}#/days/${indexTokens.student}`, parent: `${site}#/days-parent/${indexTokens.parent}` }, null, 2))
}

/** @see ../docs/product/storage-privacy.md#upload-queue */
async function pull() {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) fail('Укажите дату YYYY-MM-DD.')
  const links = json(linksFile)
  const student = links[date]?.student
  if (!student) fail('Для даты ещё нет страницы.')
  const output = resolve(third ?? `../work/day-uploads-${date}`)
  mkdirSync(output, { recursive: true })
  const entries = []
  const snapshot = await db.collection(`dayUploads/${student}/files`).get()
  let storage
  for (const item of snapshot.docs) {
    const upload = item.data()
    if (upload.status !== 'pending') continue
    const match = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(upload.dataUrl ?? '')
    if (!match && !upload.storage?.path) throw new Error(`У фото ${item.id} нет изображения на Диске или в очереди.`)
    const extension = match ? match[1] === 'jpeg' ? 'jpg' : match[1] : upload.storage.path.split('.').at(-1)
    const filename = `${item.id}.${extension}`
    if (!storage && upload.storage?.path) {
      const tokenFile = resolve(local, 'yandex-disk-token')
      if (!existsSync(tokenFile)) fail('Для скачивания работ подключите Яндекс.Диск.')
      storage = new YandexDiskStorage(readFileSync(tokenFile, 'utf8').trim())
    }
    const bytes = upload.storage?.path ? await storage.getAt(upload.storage.path) : Buffer.from(match[2], 'base64')
    writeFileSync(resolve(output, filename), bytes, { mode: 0o600 })
    entries.push({ id: item.id, taskId: upload.taskId, file: filename, status: upload.status ?? 'pending', createdAt: upload.createdAt?.toDate?.().toISOString() ?? null })
  }
  writeFileSync(resolve(output, 'manifest.json'), JSON.stringify(entries, null, 2))
  console.log(JSON.stringify({ directory: output, count: entries.length, pending: entries.filter((item) => item.status === 'pending').length }, null, 2))
}

async function seedEvidence() {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) fail('Укажите дату YYYY-MM-DD.')
  const source = json(resolve(local, `day-source-${date}.json`))
  validate(source)
  const student = json(linksFile)[date]?.student
  if (!student) fail('Сначала опубликуйте страницу дня.')
  const tokenFile = resolve(local, 'yandex-disk-token')
  if (!existsSync(tokenFile)) fail('Для импорта работ подключите Яндекс.Диск.')
  const storage = new YandexDiskStorage(readFileSync(tokenFile, 'utf8').trim())
  const batch = db.batch()
  let added = 0
  let existing = 0
  for (const evidence of source.historicalUploads ?? []) {
    const file = resolve(local, 'day-evidence', evidence.file)
    const bytes = readFileSync(file)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const md5 = createHash('md5').update(bytes).digest('hex')
    const path = `app:/PETR/Работы/${date}/Архив/${sha256}.jpg`
    const saved = await storage.putAt(path, bytes, md5)
    const publicUrl = await storage.publish(path)
    for (const taskId of evidence.taskIds) {
      const ref = db.doc(`dayUploads/${student}/files/archive-${evidence.id}-${taskId}`)
      if ((await ref.get()).exists) { existing += 1; continue }
      batch.set(ref, { taskId, status: 'reviewed', origin: 'archive', recordedDate: evidence.recordedDate, createdAt: Timestamp.now(), storage: { ...saved, state: 'stored', sha256, publicUrl, syncedAt: Timestamp.now() } })
      added += 1
    }
  }
  if (added) await batch.commit()
  console.log(JSON.stringify({ imported: added, alreadyPresent: existing, sourcePhotos: source.historicalUploads?.length ?? 0 }))
}

/** Publish only source-faithful problem text and learner support; preserve live schedule, grades, uploads and reviews.
 * @see ../docs/product/adaptive-problem-card.md#выпуск-и-безопасность
 */
async function publishProblemSupport() {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) fail('Укажите дату YYYY-MM-DD.')
  const source = json(resolve(local, `day-source-${date}.json`))
  validate(source)
  const pair = json(linksFile)[date]
  if (!pair?.student || !pair?.parent) fail('Страница дня ещё не опубликована для обеих ролей.')
  const incoming = new Map(source.subjects.flatMap((subject) => subject.tasks)
    .filter((task) => task.problems?.length).map((task) => [task.id, task]))
  if (!incoming.size) fail('В исходнике нет нумерованных задач.')
  const result = await db.runTransaction(async (transaction) => {
    const refs = [db.doc(`dayPages/${pair.student}`), db.doc(`dayPages/${pair.parent}`)]
    const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)))
    if (snapshots.some((snapshot) => !snapshot.exists)) fail('Одна из страниц дня отсутствует. Сначала опубликуйте день.')
    const counts = []
    snapshots.forEach((snapshot, index) => {
      const page = snapshot.data()
      if (page.schemaVersion !== 1 || page.date !== date) fail('Ревизия или дата страницы не совпадает с исходником.')
      const changed = []
      const subjects = page.subjects.map((subject) => ({ ...subject, tasks: subject.tasks.map((task) => {
        const sourceTask = incoming.get(task.id)
        if (!sourceTask) return task
        if (task.meshText !== sourceTask.meshText || !Array.isArray(task.problems)
          || task.problems.length !== sourceTask.problems.length) fail(`Условия или число номеров ${task.id} изменились. Нужен полный разбор дня.`)
        const sourceProblems = new Map(sourceTask.problems.map((problem) => [problem.id, problem]))
        const links = page.materialLinks?.[task.id] || []
        const problems = task.problems.map((problem) => {
          const newer = sourceProblems.get(problem.id)
          if (!newer || newer.number !== problem.number || newer.title !== problem.title
            || !links.some((link) => link.sourceType === 'teacher-attachment' && link.sourceRef === newer.original.attachmentRef
              && (!newer.original.crop || validSourceCrop(newer.original.crop, link)))) {
            fail(`У ${problem.id} не совпали номер или исходное вложение в опубликованной странице.`)
          }
          const { sourceResearch: _oldResearch, ...publicProblem } = problem
          const next = { ...publicProblem, original: newer.original, support: newer.support,
            ...(index === 1 && newer.sourceResearch ? { sourceResearch: newer.sourceResearch } : {}) }
          if (JSON.stringify(next) !== JSON.stringify(problem)) changed.push(problem.id)
          return next
        })
        return { ...task, problems }
      }) }))
      counts.push(changed.length)
      if (changed.length) transaction.update(refs[index], {
        subjects, updatedAt: Timestamp.now(),
        problemSupportRevision: (page.problemSupportRevision || 0) + 1,
        problemSupportChanges: [{ at: Timestamp.now(), problemIds: changed }, ...(page.problemSupportChanges || [])].slice(0, 20),
      })
    })
    return counts
  })
  console.log(JSON.stringify({ studentProblemsChanged: result[0], parentProblemsChanged: result[1], siteReleaseNeeded: false }))
}

if (!['refresh', 'build', 'publish', 'problem-support', 'dashboard', 'pull', 'seed-evidence'].includes(command)) fail('Команды: refresh YYYY-MM-DD | build YYYY-MM-DD | publish YYYY-MM-DD | problem-support YYYY-MM-DD | dashboard | pull YYYY-MM-DD [папка] | seed-evidence YYYY-MM-DD')
if (command === 'build') {
  console.log(JSON.stringify(buildDaySource(local, date), null, 2))
  process.exit(0)
}
if (command === 'refresh') refresh()
prepareLogin()
initializeApp({ credential: applicationDefault(), projectId: 'education-9d7c6' })
const db = getFirestore()
if (command === 'publish' || command === 'refresh') await publish()
else if (command === 'dashboard') await publishDashboard()
else if (command === 'pull') await pull()
else if (command === 'problem-support') await publishProblemSupport()
else await seedEvidence()
if ((command === 'publish' || command === 'refresh') && existsSync(resolve(local, 'family-access.json'))) {
  const owner = json(resolve(local, 'family-access.json')).legacyDayOwner
  if (owner) {
    try { runLocal('scripts/family.mjs', ['attach-current-day', owner.familyId, owner.childId]) }
    catch { console.warn('Личный переход к текущему дню не обновлён; сама страница дня опубликована.') }
  }
}
if (command === 'refresh') {
  try { runLocal('scripts/storage.mjs', ['sync', date]) }
  catch { console.warn('Архив новых фото на Диске не завершён; фото остались в Education, повторите sync.') }
}
