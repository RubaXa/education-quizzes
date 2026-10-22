/** @see ../docs/decisions/scoped-learner-flow-2026-10-21.md */
/** @see ../docs/decisions/mesh-informational-entry-2026-10-21.md */
/**
 * @see ../docs/product/school-day.md
 * @see ../docs/modules/families/README.md
 * @see ../docs/decisions/family-essay-assignment-2026-10-20.md
 * @see ../docs/decisions/source-only-mesh-publication-2026-10-20.md
 * @see ../docs/modules/reviews/card-flow-certification.md
 */
/** @see ../docs/modules/materials/material-clarification.md */
import { materialRequestErrors, openMaterialRequest } from '../src/lib/materialRequest.ts'
import { parentGuideProseErrors, taskSupportProseErrors } from '../src/lib/reviewProse.ts'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { linksFile as pageLinksFile, materialLinks, materialPlan, preparePages, taskPageRefs } from '../storage/material-pages.mjs'
import { buildDaySource, rawMeshKind } from '../day/build.mjs'
import { assertLearningRouteIdentity, learningRouteIdentity } from '../day/learning-route-identity.mjs'
import { assertWeekendWorkRetention, buildDayDashboardIndex } from '../day/dashboard-index.mjs'
import { familyDashboardDateDelta } from '../day/family-dashboard-delta.mjs'
import { mergeDayPage } from '../day/merge.mjs'
import { assertAssignmentLinksExist } from '../day/placement-integrity.mjs'
import { repairTaskPlacements } from '../day/placement-repair.mjs'
import { dayDashboardShapeErrors } from '../day/data-contract.mjs'
import { materialGrantError } from '../day/material-access.mjs'
import { teacherAttachmentOwnershipErrors } from '../day/assignment-structure.mjs'
import { canPublishSourceOnly, sourceOnlyPublicationErrors, taskMaterialPublicationError } from '../day/source-only.mjs'
import { learnerFlowErrors } from '../day/learner-flow.mjs'
import { meshNoticeEntryErrors } from '../day/mesh-notice.mjs'
import { assertMixedEntry } from '../day/mixed-assignment.mjs'
import { ownerMigrationFields } from '../day/owner-repair.mjs'
import { publicPageSubjects, publicProblem } from '../day/public-projection.mjs'
import { isExplicitCdzTask } from '../day/homework-kind.mjs'
import { cardPolicyModules, mathRouteProfile, mathRouteProfiles, missingMathRoutes, practiceVariantErrors, sourceInventoryErrors, validLearningRoute } from '../day/card-policy.mjs'
import { assertPublishedPageAligned, assertSourceAligned as assertSourceAlignedContract, sourcePlanFingerprint, textbookRefError } from '../day/pipeline-contract.mjs'
import { chooseGradeJournal, detectGradeChange, gradeDetailRows, gradeProjectionPatch } from '../day/grade-reconciliation.mjs'
import { stageGradeProjectionForRole } from '../day/grade-publication.mjs'
import { YandexDiskStorage } from '../storage/yandex-disk.mjs'
import { stageFamilyNotice } from '../storage/inbox-notifications.mjs'
import { lessonVisibility } from '../diary/application/lesson-visibility.mjs'
import { stageSchoolAlerts } from '../diary/application/school-alerts.mjs'
import { buildFamilySourceGraph } from '../day/family-source-graph.mjs'
import { isDeepStrictEqual } from 'node:util'
import { findGuidanceTarget, planRevealGuidanceRepair } from '../day/guidance-repair.mjs'
import { familyAssignmentErrors, familyAssignmentProjectionSignature, familyAssignmentRecordSignature, familyAssignmentsWithOverlay, familyGuideErrors, mergeFamilyAssignments, stableFamilyProjectionJson } from '../day/family-assignment.mjs'

const sharedLocal = resolve('.local')
const scoped = Boolean(process.env.EDUCATION_CHILD_WORKSPACE)
const local = resolve(process.env.EDUCATION_CHILD_WORKSPACE || '.local')
const site = 'https://rubaxa.github.io/education-quizzes/'
const linksFile = resolve(local, 'day-links.json')
const dashboardLinksFile = resolve(local, 'day-dashboard-links.json')
const [command, date, third] = process.argv.slice(2)

function fail(message) { throw new Error(message) }
function json(path) { return JSON.parse(readFileSync(path, 'utf8')) }
/** @see ../docs/modules/synchronization/plan-generation.md#assignment-routing */
function assertSourceAligned(source, snapshot) {
  return assertSourceAlignedContract(source, snapshot, {
    readSource: (date) => json(resolve(local, `day-source-${date}.json`)),
    readSnapshot: (date) => json(resolve(local, `diary/snapshot-${date}.json`)),
  })
}
function ownerContext() {
  if (scoped) {
    const file = resolve(local, 'context.json')
    if (!existsSync(file)) fail('Для отдельного ребёнка нужен закрытый context.json.')
    const owner = json(file)
    if (!owner.familyId || !owner.childId || !owner.sourceAccountId) fail('Контекст ребёнка неполный.')
    return owner
  }
  const file = resolve(local, 'family-access.json')
  return existsSync(file) ? json(file).legacyDayOwner : null
}
function boardToken(role) {
  const file = resolve(local, role === 'student' ? 'learner-board-token' : 'parent-board-token')
  if (existsSync(file)) return readFileSync(file, 'utf8').trim()
  if (!scoped) fail(`Отсутствует ${file}.`)
  const token = randomBytes(32).toString('base64url')
  mkdirSync(local, { recursive: true, mode: 0o700 })
  writeFileSync(file, token, { mode: 0o600, flag: 'wx' })
  return token
}
function completeDiarySnapshots() {
  const directory = resolve(local, 'diary')
  const names = readdirSync(directory).filter((name) => /^snapshot-\d{4}-\d{2}-\d{2}\.json$/.test(name))
  const snapshots = names.map((name) => json(resolve(directory, name))).filter((snapshot) => snapshot.complete)
  return snapshots.sort((a, b) => String(b.fetchedAt).localeCompare(String(a.fetchedAt)))
}
function latestCompleteDiarySnapshot() { return completeDiarySnapshots()[0] }
function currentGradeProjection() {
  const file = scoped ? resolve(local, 'grade-snapshot.json') : resolve('../learner/grade-snapshot.json')
  if (!existsSync(file)) fail('Для этого ребёнка ещё нет сверенного среза оценок; день не опубликован.')
  const snapshot = json(file)
  const mesh = chooseGradeJournal(snapshot, completeDiarySnapshots())
  const fields = {
    gradeSummary: gradeSummary(snapshot), gradeAsOf: snapshot.observed_at,
    grades: gradeDetailRows(snapshot, mesh), workingThreshold: snapshot.working_threshold,
  }
  const fingerprint = createHash('sha256').update(JSON.stringify(fields)).digest('hex')
  return { snapshot, mesh, fields, fingerprint }
}
function dashboardLinks() {
  return existsSync(dashboardLinksFile) ? json(dashboardLinksFile) : {
    student: randomBytes(32).toString('base64url'),
    parent: randomBytes(32).toString('base64url'),
  }
}
/** @see ../docs/modules/school-diary/dashboard.md#firestore-model */
async function addDashboardDocuments(batch, links, tokens, stagedPages = {}, gradeProjection = null) {
  const owner = ownerContext()
  if (!owner?.familyId || !owner?.childId) fail('Сначала привяжите страницы дня к ребёнку командой family attach-current-day.')
  const targetDates = [...new Set(Object.keys(links).flatMap((sourceDate) => {
    const file = resolve(local, `day-source-${sourceDate}.json`)
    return existsSync(file) ? [json(file).targetDate] : []
  }))]
  const familyTaskPages = await Promise.all(targetDates.map((targetDate) =>
    db.collection(`families/${owner.familyId}/children/${owner.childId}/tasks`).where('dueDate', '==', targetDate).get()))
  const familyAssignments = [...new Map(familyTaskPages.flatMap((page) => page.docs.map((snapshot) => [snapshot.id, { id: snapshot.id, ...snapshot.data() }]))).values()]
  const members = await db.collection(`families/${owner.familyId}/members`).get()
  const pageCache = new Map(Object.entries(stagedPages))
  const loadPage = async (token) => {
    if (pageCache.has(token)) return pageCache.get(token)
    const page = (await db.doc(`dayPages/${token}`).get()).data()
    pageCache.set(token, page)
    return page
  }
  const updatedGradeTokens = []
  if (scoped) {
    const latestDate = Object.keys(links).sort().at(-1)
    const latestPair = links[latestDate]
    for (const member of members.docs) {
      const access = member.data()
      if (access.active !== true || !access.childIds?.includes(owner.childId) || !['student', 'parent'].includes(access.role)) continue
      batch.set(db.doc(`users/${member.id}/families/${owner.familyId}/shortcuts/${owner.childId}`), {
        dayToken: latestPair[access.role], dashboardToken: tokens[access.role], sourceDate: latestDate, updatedAt: Timestamp.now(),
        dashboardTokens: { student: tokens.student, parent: tokens.parent }, dayTokens: { student: latestPair.student, parent: latestPair.parent },
      })
    }
  }
  for (const role of ['student', 'parent']) {
    const ref = db.doc(`dayDashboards/${tokens[role]}`)
    const previous = (await ref.get()).data()
    if (gradeProjection) updatedGradeTokens.push(...await stageGradeProjectionForRole({
      role, links, owner, fingerprint: gradeProjection.fingerprint,
      previousFingerprint: previous?.gradeProjectionFingerprint,
      desired: gradeProjection.fields, loadPage,
      stagePatch: (dayToken, patch) => {
        if (stagedPages[dayToken]) fail('Новая страница дня расходится с текущим срезом оценок.')
        batch.update(db.doc(`dayPages/${dayToken}`), patch)
      },
    }))
    const previousDays = new Map((previous?.days ?? []).map((day) => [day.date, day]))
    const retainedCalendar = previous?.familyId === owner.familyId && previous?.childId === owner.childId ? previous.schoolCalendar : null
    const index = buildDayDashboardIndex(local, links, role, new Date(), retainedCalendar, familyAssignments)
    const indexErrors = dayDashboardShapeErrors(index)
    if (indexErrors.length) fail(`Неверная схема календаря ${role}: ${indexErrors.join(' ')}`)
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
      const page = await loadPage(token)
      assertPublishedPageAligned(source, page, role, familyAssignments)
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
      ...learningRouteIdentity(tokens, owner),
      familyId: owner.familyId, childId: owner.childId, updatedAt: Timestamp.now(),
      ...(gradeProjection ? { gradeProjectionFingerprint: gradeProjection.fingerprint } : {}),
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
  return updatedGradeTokens
}
/** Read back only grade projections changed in this batch. No unchanged page is rewritten.
 * @see ../docs/modules/school-diary/grades.md#mesh-reconciliation
 */
async function verifyGradeProjection(tokens, desired) {
  if (!tokens.length) return
  const pages = await db.getAll(...tokens.map((token) => db.doc(`dayPages/${token}`)))
  for (const page of pages) {
    if (!page.exists || gradeProjectionPatch(page.data(), desired)) {
      fail('Подробности оценок не совпали с опубликованной страницей после записи.')
    }
  }
}
/** Read back committed role documents before reporting a successful release. */
async function verifyPublishedDay(source, pair, indexTokens, links) {
  const owner = ownerContext()
  const familyTasks = owner?.familyId && owner?.childId
    ? (await db.collection(`families/${owner.familyId}/children/${owner.childId}/tasks`).where('dueDate', '==', source.targetDate).get()).docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }))
    : []
  for (const role of ['student', 'parent']) {
    const token = pair[role]
    const [pageDoc, dashboardDoc] = await Promise.all([
      db.doc(`dayPages/${token}`).get(), db.doc(`dayDashboards/${indexTokens[role]}`).get(),
    ])
    assertPublishedPageAligned(source, pageDoc.data(), role, familyTasks)
    await assertAssignmentLinksExist(db, pageDoc.data())
    const indexed = dashboardDoc.data()?.days?.find((item) => item.date === source.targetDate)
    const expected = buildDayDashboardIndex(local, links, role, new Date(), null, familyTasks).days.find((item) => item.date === source.targetDate)
    if (!indexed || !expected || indexed.sourceRevision !== expected.sourceRevision || indexed.dayToken !== expected.dayToken
      || indexed.homeworkDayToken !== expected.homeworkDayToken
      || JSON.stringify(indexed.homework) !== JSON.stringify(expected.homework)) {
      fail(`После записи индекс ${role} не указывает на опубликованный день ${source.targetDate}.`)
    }
  }
}
async function verifyPublishedIndex(links, indexTokens) {
  const owner = ownerContext()
  const targetDates = [...new Set(Object.keys(links).flatMap((sourceDate) => {
    const file = resolve(local, `day-source-${sourceDate}.json`)
    return existsSync(file) ? [json(file).targetDate] : []
  }))]
  const familyPages = owner?.familyId && owner?.childId ? await Promise.all(targetDates.map((targetDate) =>
    db.collection(`families/${owner.familyId}/children/${owner.childId}/tasks`).where('dueDate', '==', targetDate).get())) : []
  const familyAssignments = familyPages.flatMap((page) => page.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() })))
  for (const role of ['student', 'parent']) {
    const published = (await db.doc(`dayDashboards/${indexTokens[role]}`).get()).data()
    const retainedCalendar = published?.familyId === owner?.familyId && published?.childId === owner?.childId ? published.schoolCalendar : null
    const expected = buildDayDashboardIndex(local, links, role, new Date(), retainedCalendar, familyAssignments)
    const shapeErrors = dayDashboardShapeErrors(published)
    if (shapeErrors.length) fail(`Неверная опубликованная схема календаря ${role}: ${shapeErrors.join(' ')}`)
    const keys = ['date', 'checkedAt', 'complete', 'sourceRevision', 'schedule', 'homework', 'dayToken', 'homeworkDayToken']
    const comparable = (days) => days?.map((day) => Object.fromEntries(keys.map((key) => [key, day[key]])))
    if (published?.kind !== role
      || JSON.stringify(comparable(published.days)) !== JSON.stringify(comparable(expected.days))
      || JSON.stringify(published.weekendWork) !== JSON.stringify(expected.weekendWork)
      || JSON.stringify(published.schoolCalendar ?? null) !== JSON.stringify(expected.schoolCalendar ?? null)) {
      fail(`Опубликованный индекс ${role} не совпадает с полным проверенным горизонтом.`)
    }
  }
}
function nextCalendarDate(value, days) { const date = new Date(`${value}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10) }
function runLocal(script, args) { execFileSync(process.execPath, [script, ...args], { cwd: resolve('.'), stdio: 'inherit' }) }
function refresh() {
  if (scoped) fail('Для семейного контекста сначала выполните глобальный сбор МЭШ; refresh одного дня здесь отключён.')
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
  const loginFile = resolve(sharedLocal, 'config/configstore/firebase-tools.json')
  if (!existsSync(loginFile)) fail('Сначала войдите через Firebase CLI.')
  const login = json(loginFile)
  if (!login.tokens?.refresh_token) fail('Вход Firebase CLI устарел.')
  const require = createRequire(import.meta.url)
  const { clientId, clientSecret } = require('firebase-tools/lib/api')
  const file = resolve(sharedLocal, 'adc.json')
  writeFileSync(file, JSON.stringify({ type: 'authorized_user', client_id: clientId(), client_secret: clientSecret(), refresh_token: login.tokens.refresh_token }), { mode: 0o600 })
  process.env.GOOGLE_APPLICATION_CREDENTIALS = file
}
function time(value) { return new Date(value).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow', hour: '2-digit', minute: '2-digit' }) }
/** @see ../docs/modules/school-diary/README.md#visibility */
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
/** @see ../docs/modules/synchronization/plan-generation.md#review-gate */
function validateAssignedInstruction(item, task, sourceDocument) {
  if (!item || typeof item !== 'object' || !item.text?.trim() || !item.source?.label?.trim() || !item.source?.evidence?.trim() || item.source.certainty !== 'confirmed') {
    fail(`Обязательный пункт ${task.id} без подтверждённого источника. Не публикуйте домысел как ДЗ.`)
  }
  if (item.source.kind === 'mesh') {
    if (!item.source.excerpt?.trim() || !task.meshText?.includes(item.source.excerpt) || item.source.evidence !== task.meshText) fail(`Для пункта ${task.id} нужна дословная опора в МЭШ.`)
  } else if (item.source.kind === 'textbook') {
    const error = textbookRefError(item.source.ref, materialPlan.taskPages[task.id], { path: `${task.id}.instruction.source.ref`, exact: false })
    if (error) fail(error)
  } else if (item.source.kind === 'teacher-file') {
    if (!sourceDocument.materialLinks?.[task.id]?.some((link) => link.sourceType === 'teacher-attachment' && link.title === item.source.ref)) {
      fail(`Для пункта ${task.id} нужен исходный файл учителя из МЭШ.`)
    }
  } else fail(`Пункт ${task.id} не может добавлять к заданию МЭШ обязательную работу от агента или прежнего разбора.`)
}
/** Parent-only reference material must be anchored to this exact task and family-linked pages.
 * @see ../docs/modules/reviews/subject-aware-guidance.md#parent-card */
function validateParentGuide(guide, task, sourceDocument, problem, subjectId) {
  const proseErrors = parentGuideProseErrors(guide)
  if (proseErrors.length) fail(proseErrors.join('\n'))
  if (task.id.startsWith('mesh-') && task.instructionStatus?.state !== 'reviewed' || !['structured-notes', 'worked-solution', 'text-structure'].includes(guide.kind)
    || !guide.overview?.trim() || !Array.isArray(guide.stages) || !guide.stages.length) fail(`У ${task.id} родительский ориентир не сверен.`)
  const ids = new Set()
  if (guide.presentation === 'math-route') {
    const profile = mathRouteProfile(guide)
    const roles = mathRouteProfiles[profile]
    const last = guide.stages.at(-1)
    if (guide.kind !== 'worked-solution' || !Number.isInteger(guide.revision) || guide.revision < 1
      || !roles || guide.stages.length !== roles.length
      || guide.stages.map((stage) => stage.role).join(',') !== roles.join(',')
      || profile !== 'extended' && !guide.depthReason?.trim()
      || guide.stages.some((stage) => !Array.isArray(stage.rows) || !stage.rows.length || !stage.hintPreview?.trim() || !stage.revealPreview?.trim())
      || guide.stages.slice(0, -1).some((stage) => stage.answer || stage.verification)
      || !last?.answer?.trim() || !Array.isArray(last.verification) || !last.verification.length
      || guide.stages.slice(0, -1).some((stage) => JSON.stringify(stage).includes(last.answer))) {
      fail(`У ${problem?.id ?? task.id} математический маршрут неполон или раскрывает ответ раньше последнего этапа.`)
    }
  }
  if (guide.presentation === 'learning-route') {
    if (!validLearningRoute(subjectId, task, guide)) {
      fail(`У ${task.id} текстовый маршрут не соответствует утверждённому виду и источникам.`)
    }
  }
  for (const stage of guide.stages) {
    if (!/^[a-z0-9-]+$/.test(stage.id ?? '') || ids.has(stage.id) || !stage.title?.trim() || !stage.expected?.trim()
      || !stage.source?.label?.trim() || !stage.source.excerpt?.trim()) fail(`У ${task.id} этап родительского ориентира неполон.`)
    ids.add(stage.id)
    const source = stage.source
    if (source.kind === 'mesh') {
      if (source.ref !== task.id || !task.meshText?.includes(source.excerpt)) fail(`У ${task.id} этап без точной опоры МЭШ.`)
    } else if (source.kind === 'textbook') {
      const error = textbookRefError(source.ref, materialPlan.taskPages[task.id], { path: `${task.id}.parentGuide.stages.${stage.id}.source.ref` })
      if (error) fail(error)
    } else if (source.kind === 'teacher-file') {
      if (!sourceDocument.materialLinks?.[task.id]?.some((link) => link.sourceType === 'teacher-attachment' && link.sourceRef === source.ref)
        || problem && !problem.original?.text?.includes(source.excerpt)) fail(`У ${problem?.id ?? task.id} этап без точного текста листа учителя.`)
    } else fail(`У ${task.id} неизвестный источник родительского ориентира.`)
  }
}
function validSourceCrop(crop, link) {
  if (!crop || !link?.sourceSha256 || crop.sourceSha256 !== link.sourceSha256) return false
  if (!/^[a-f0-9]{64}$/.test(crop.sourceSha256)) return false
  if (!['x', 'y', 'width', 'height', 'sourceWidth', 'sourceHeight'].every((key) => Number.isInteger(crop[key]))) return false
  return crop.x >= 0 && crop.y >= 0 && crop.width >= 10 && crop.height >= 10
    && crop.sourceWidth > 0 && crop.sourceHeight > 0
    && crop.x + crop.width <= crop.sourceWidth && crop.y + crop.height <= crop.sourceHeight
}

function validate(source, { allowUnchangedLegacyTeacherLinks = false } = {}) {
  if (!source || !Array.isArray(source.subjects) || !source.subjects.length) fail('В исходнике нужны subjects.')
  const ids = new Set()
  const subjectIds = new Set()
  for (const subject of source.subjects) {
    if (!subject.id || subjectIds.has(subject.id) || !subject.name || !Array.isArray(subject.tasks)) fail('У предмета нужны уникальный id, name и tasks.')
    subjectIds.add(subject.id)
    for (const task of subject.tasks) {
      if (!/^[a-z0-9-]+$/.test(task.id ?? '') || ids.has(task.id) || !task.title) fail('Нужны уникальные id и названия действий.')
      ids.add(task.id)
      const flowErrors = learnerFlowErrors(task, materialPlan.taskPages[task.id] ?? [])
      if (flowErrors.length) fail(flowErrors.join(' '))
      const requestErrors = [...materialRequestErrors(task), ...taskSupportProseErrors(task)]
      if (requestErrors.length) fail(requestErrors.join(' '))
      if (task.assessmentIntent) {
        const intent = task.assessmentIntent
        if (!['confirmed', 'needs-topic', 'needs-review'].includes(intent.state)) fail(`У ${task.id} неизвестно состояние решения о тесте.`)
        if (intent.state === 'confirmed' && (task.instructionStatus?.state !== 'reviewed'
          || !['ordinary', 'control-diagnostic'].includes(intent.mode)
          || !intent.topic?.trim() || !intent.evidenceRef?.trim()
          || task.kind === 'written' || task.outputKind === 'platform-result')) {
          fail(`У ${task.id} самопроверка требует сверенного вида, темы и источника; письменная работа и ЦДЗ не заменяются тестом.`)
        }
      }
      // @see ../docs/modules/school-diary/dashboard.md#reference-only-homework
      if (task.referenceDate && (!/^\d{4}-\d{2}-\d{2}$/.test(task.referenceDate)
        || task.referenceDate >= source.targetDate || task.kind !== 'check'
        || !/^смотри(?:те)?\s+(?:дз|задание)\s+на\s+/i.test(task.meshText ?? '')
        || task.problems?.length || task.testToken || task.platformResult)) {
        fail(`Указатель ${task.id} должен вести к прежнему ДЗ и не создавать отдельный результат.`)
      }
      const policy = cardPolicyModules(subject.id, task)
      const adapter = policy.adapter
      const variantErrors = practiceVariantErrors(task)
      if (variantErrors.length) fail(`У ${task.id} неверно разобраны варианты: ${variantErrors.join(' ')}`)
      const inventoryErrors = sourceInventoryErrors(task, source.materialLinks?.[task.id] ?? [])
      if (inventoryErrors.length) fail(`У ${task.id} не завершена сверка полного листа: ${inventoryErrors.join(' ')}`)
      if (task.instructionStatus?.state === 'reviewed' && task.kind === 'written' && task.cardPolicyVersion === 1
        && (adapter !== 'language-route' || task.parentGuide?.presentation !== 'learning-route')) {
        fail(`У ${task.id} письменная карточка требует предметный маршрут.`)
      }
      if (task.instructionStatus?.state === 'reviewed' && task.outputKind && adapter === 'unsupported-solution') {
        fail(`У ${task.id} вид результата не соответствует предметному адаптеру.`)
      }
      if (task.instructionStatus?.state === 'reviewed' && task.outputKind === 'worked-solution' && !task.problems?.length) {
        fail(`У ${task.id} математическое решение нужно разложить на устойчивые номера или задачи.`)
      }
      if (task.instructionStatus?.state === 'reviewed' && task.outputKind && task.problems?.length && adapter !== 'math-solution') {
        fail(`У ${task.id} номера задач не соответствуют выбранному виду результата.`)
      }
      // @see ../docs/modules/reviews/special-course-card-overlay.md#teacher-sheet
      if (policy.overlays.includes('special-course-teacher-sheet') && task.mathRoutePolicyVersion === 1 && task.instructionStatus?.state === 'reviewed'
        && source.materialLinks?.[task.id]?.some((link) => link.sourceType === 'teacher-attachment') && !task.problems?.length
        && adapter === 'unclassified') {
        fail(`У ${task.id} лист спецкурса надо разобрать на номера до публикации.`)
      }
      if (task.problems != null) {
        if (task.kind !== 'written' && !(task.kind === 'check' && task.practiceVariants?.length)
          || !Array.isArray(task.problems) || !task.problems.length) fail(`У ${task.id} номера допустимы только для решения или сверенной подготовки по листу.`)
        const routeGaps = missingMathRoutes(subject.id, task)
        if (routeGaps.length) {
          fail(`У ${task.id} каждый номер требует закрытый математический маршрут перед публикацией: ${routeGaps.join(', ')}.`)
        }
        if (task.problems.some((problem) => problem.original?.crop) && task.problems.some((problem) => !problem.original?.crop)) {
          fail(`У ${task.id} фрагменты исходного листа нужны для каждого номера.`)
        }
        const numbers = new Set()
        for (const problem of task.problems) {
          const proseErrors = taskSupportProseErrors(problem)
          if (proseErrors.length) fail(proseErrors.join('\n'))
          if (!/^[a-z0-9-]+$/.test(problem.id ?? '') || !problem.id.startsWith(`${task.id}-p`) || ids.has(problem.id)
            || !Number.isInteger(problem.number) || numbers.has(`${problem.variantId ?? ''}:${problem.number}`)
            || !problem.title?.trim() || !problem.detail?.trim() || !problem.source?.trim()) fail(`У ${task.id} каждый номер должен иметь устойчивый ID, условие и источник.`)
          // @see ../docs/modules/reviews/adaptive-problem-card.md#выпуск-и-безопасность
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
          numbers.add(`${problem.variantId ?? ''}:${problem.number}`)
          if (problem.parentGuide) validateParentGuide(problem.parentGuide, task, source, problem, subject.id)
        }
      }
      if (task.id.startsWith('mesh-')) {
        if (task.sourceOnly === true) {
          const sourceOnlyErrors = sourceOnlyPublicationErrors(task)
          if (sourceOnlyErrors.length) fail(sourceOnlyErrors.join(' '))
        }
        if (task.instructionStatus?.state === 'needs-review' && (task.detail !== task.meshText || task.kind !== rawMeshKind(task.meshText ?? '') || task.steps?.length || task.submission || task.parentGuide)) fail(`У ${task.id} разбор ещё не сверен: показывайте только точный текст МЭШ без добавленных действий и фото.`)
        if (task.instructionStatus?.state === 'reviewed') for (const step of task.steps ?? []) validateAssignedInstruction(step, task, source)
        for (const item of task.submission?.items ?? []) validateAssignedInstruction(item, task, source)
        if (task.parentGuide) validateParentGuide(task.parentGuide, task, source, undefined, subject.id)
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
      if (!allowUnchangedLegacyTeacherLinks && link.sourceType === 'teacher-attachment' && /\.(png|jpe?g|webp|pdf)(?:\?|$)/i.test(decodeURIComponent(new URL(link.url).pathname)) && new URL(link.url).hostname === 'school.mos.ru') {
        fail(`Файл учителя для ${taskId} ещё не перенесён на Яндекс.Диск. Запустите storage sync-teacher и обновите исходник дня.`)
      }
      if (link.sourceType === 'external-text' && (task.materialStatus?.state !== 'text-absent-from-textbook' || !link.reason)) fail(`Внешний текст для ${taskId} допустим только после подтверждения его отсутствия в учебнике и с объяснением.`)
    }
  }
  const attachmentErrors = teacherAttachmentOwnershipErrors(source)
  if (attachmentErrors.length) fail(attachmentErrors.join(' '))
  // @see ../docs/modules/synchronization/plan-generation.md#material-only-mesh-entries
  for (const entry of source.sourceOnlyEntries ?? []) {
    if (entry.kind === 'split') {
      const subject = source.subjects.find((item) => item.id === entry.subjectId)
      if (!/^mesh-\d+$/.test(entry.id ?? '') || ids.has(entry.id) || !entry.reason?.trim()
        || !subject?.mesh?.includes(entry.rawText)) fail('Разделение должно сохранять исходную запись и отдельные действия.')
      assertMixedEntry(entry, entry.rawText, subject.tasks)
      continue
    }
    if (entry.kind === 'notice') {
      const subject = source.subjects.find((item) => item.id === entry.subjectId)
      const errors = meshNoticeEntryErrors(entry, { subject, tasks: subject?.tasks ?? [] })
      if (errors.length) fail(errors.join(' '))
      continue
    }
    const target = source.subjects.find((subject) => subject.id === entry.subjectId)?.tasks.find((task) => task.id === entry.targetTaskId)
    const subject = source.subjects.find((item) => item.id === entry.subjectId)
    if (!/^mesh-\d+$/.test(entry.id ?? '') || ids.has(entry.id) || !target || target.kind !== 'written'
      || !entry.rawText?.trim() || !subject?.mesh?.includes(entry.rawText)
      || !entry.reason?.trim() || !(source.materialLinks?.[target.id] ?? []).some((link) => link.sourceType === 'teacher-attachment')) {
      fail(`Ссылка МЭШ ${entry.id} может быть исключена из действий только при подтверждённом общем файле учителя.`)
    }
  }
  if ((source.materialLinkReplacements ?? []).some((taskId) => !ids.has(taskId)
    && !(source.sourceOnlyEntries ?? []).some(entry => entry.kind === 'split' && entry.id === taskId))) fail('Заменять материалы можно только для существующего или проверенного разделённого задания.')
  const testTokens = new Set()
  const testTaskIds = new Set()
  for (const placement of source.testPlacements ?? []) {
    if (!/^[A-Za-z0-9_-]{24,64}$/.test(placement.token ?? '') || testTokens.has(placement.token) || !subjectIds.has(placement.subjectId)) fail('Нужны уникальные чистые токены тестов и существующие предметы.')
    testTokens.add(placement.token)
    if (placement.taskId) {
      if (testTaskIds.has(placement.taskId)) fail(`Два теста привязаны к одному заданию ${placement.taskId}.`)
      testTaskIds.add(placement.taskId)
      const subject = source.subjects.find((item) => item.id === placement.subjectId)
      const task = subject.tasks.find((item) => item.id === placement.taskId)
      if (!task || task.testToken !== placement.token) fail('Тест внутри задания должен совпадать с testToken этого задания.')
    }
  }
  // @see ../docs/modules/school-diary/day-page.md#test-progress
  for (const subject of source.subjects) for (const task of subject.tasks) {
    if (task.kind !== 'read' || openMaterialRequest(task)) continue
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

/** Carry a completed platform result between two views of the same assignment date. @see ../docs/modules/synchronization/plan-generation.md#cross-day-results */
async function reconcileEarlierEvidence(source, studentToken) {
  const owner = ownerContext()
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
      const [progress, uploads, privateReview] = await Promise.all([
        db.doc(`dayProgress/${token}/items/${entry.id}`).get(),
        db.collection(`dayUploads/${token}/files`).get(),
        db.doc(`dayReviewPrivate/${token}/items/${entry.id}`).get(),
      ])
      if (progress.exists || privateReview.exists || uploads.docs.some((upload) => upload.data().status !== 'deleted'
        && (upload.data().taskId === entry.id || upload.data().coveredTaskIds?.includes(entry.id)))) {
        fail(`У ссылки МЭШ ${entry.id} уже есть работа или разбор; нельзя скрыть её как простой файл.`)
      }
    }
  }
  for (const subject of source.subjects) for (const task of subject.tasks) {
    if (!isExplicitCdzTask(task) || task.platformResult?.state === 'completed') continue
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

/** @see ../docs/modules/families/access-and-state.md#state */
async function stagePublish(date, batch, links, indexTokens, stagedPages, notifyGrades, gradeProjection) {
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
  // @see ../docs/modules/materials/family-library.md#source-graph
  const legacyOwner = ownerContext()
  const familyTaskSnapshots = legacyOwner?.familyId && legacyOwner?.childId
    ? await db.collection(`families/${legacyOwner.familyId}/children/${legacyOwner.childId}/tasks`).where('dueDate', '==', source.targetDate).get()
    : { docs: [] }
  const familyAssignments = familyTaskSnapshots.docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() })).filter((task) =>
    task.sourceSystem === 'family' && task.publication === 'active' && task.dayProjectionVersion === 1)
  for (const task of familyAssignments) {
    const errors = familyAssignmentErrors(task, { familyId: legacyOwner.familyId, childId: legacyOwner.childId, taskId: task.id })
    if (errors.length) fail(`Семейное назначение ${task.id} не прошло проверку: ${errors.join(' ')}`)
  }
  if (scoped) {
    const [account, child, identity] = await Promise.all([
      db.doc(`sourceAccounts/${legacyOwner.sourceAccountId}`).get(),
      db.doc(`families/${legacyOwner.familyId}/children/${legacyOwner.childId}`).get(),
      db.doc(`sourceIdentities/${createHash('sha256').update(`mesh-child:${legacyOwner.sourcePersonId}`).digest('hex')}`).get(),
    ])
    if (!account.exists || account.data().familyId !== legacyOwner.familyId || account.data().disconnectedAt
      || !child.exists || String(child.data().meshPersonId) !== String(legacyOwner.sourcePersonId)
      || identity.data()?.familyId !== legacyOwner.familyId || identity.data()?.childId !== legacyOwner.childId) {
      fail('Контекст ребёнка не подтверждён семейным источником МЭШ.')
    }
  }
  let audioLinks = {}
  if (legacyOwner?.familyId && legacyOwner?.childId) {
    const graph = await buildFamilySourceGraph(db, { familyId: legacyOwner.familyId,
      childId: legacyOwner.childId, source, pageRefs })
    audioLinks = graph.audioLinks
    writeFileSync(resolve(local, `family-source-graph-${date}.json`), `${JSON.stringify(graph, null, 2)}\n`, { mode: 0o600 })
    if (graph.problems.length) fail(`${graph.problems.join(' ')} День не опубликован.`)
  }
  // A newly synced assignment must never silently go live with an unchecked textbook source.
  // @see ../docs/modules/materials/materials.md#mandatory-source-link
  for (const task of source.subjects.flatMap((subject) => subject.tasks)) {
    const state = task.materialStatus?.state
    const hasPages = Boolean(pageRefs[task.id]?.length)
    const hasTeacherFile = source.materialLinks?.[task.id]?.some((link) => link.sourceType === 'teacher-attachment')
    const materialError = taskMaterialPublicationError(task, { hasPages, hasTeacherFile })
    if (materialError) fail(materialError)
    if (state === 'textbook-page-linked' && !hasPages) fail(`Для ${task.id} нет привязки к индексированной странице учебника.`)
    if (['no-textbook', 'text-absent-from-textbook'].includes(state) && !task.materialStatus?.message?.trim()) fail(`Для ${task.id} нужна причина отсутствия учебника.`)
  }
  const knownBefore = existsSync(pageLinksFile) ? json(pageLinksFile) : {}
  const neededPageIds = new Set(Object.keys(pageRefs).flatMap((taskId) => materialPlan.taskPages[taskId] || []))
  const preparedPages = new Map(preparePages().map((entry) => [entry.id, entry]))
  for (const id of neededPageIds) {
    if (!knownBefore[id]?.publicUrl || knownBefore[id].imageSha256 !== preparedPages.get(id)?.imageSha256) {
      runLocal('scripts/storage.mjs', ['sync-pages', '--page', id])
    }
  }
  const gradeSnapshot = gradeProjection.snapshot
  const publishedPageLinks = existsSync(pageLinksFile) ? materialLinks(json(pageLinksFile)) : {}
  const allMaterialLinks = { ...(source.materialLinks || {}) }
  for (const [taskId, pageLinks] of Object.entries(publishedPageLinks)) allMaterialLinks[taskId] = [...pageLinks, ...(allMaterialLinks[taskId] || [])]
  // Audio is rebuilt from this child's current bindings, never from another family.
  // @see ../docs/modules/materials/audio-library.md#assignment
  for (const [taskId, links] of Object.entries(audioLinks)) allMaterialLinks[taskId] = [
    ...(allMaterialLinks[taskId] ?? []).filter((link) => link.sourceType !== 'audio'), ...links,
  ]
  for (const task of source.subjects.flatMap((subject) => subject.tasks)) {
    if (pageRefs[task.id]?.length && (publishedPageLinks[task.id]?.length ?? 0) !== pageRefs[task.id].length) {
      fail(`Для ${task.id} опубликованы не все страницы учебника: ${publishedPageLinks[task.id]?.length ?? 0} из ${pageRefs[task.id].length}.`)
    }
    if (task.materialStatus?.state === 'textbook-page-linked' && !allMaterialLinks[task.id]?.some((link) => link.sourceType === 'textbook-page')) fail(`Для ${task.id} указан учебник, но ссылка на точную страницу пока не опубликована.`)
  }
  if (!links[date]) links[date] = { student: randomBytes(32).toString('base64url'), parent: randomBytes(32).toString('base64url') }
  const pair = links[date]
  await reconcileEarlierEvidence(source, pair.student)
  const base = {
    schemaVersion: 1, date, targetDate: source.targetDate, updatedAt: Timestamp.now(),
    ...(legacyOwner?.familyId && legacyOwner?.childId ? { familyId: legacyOwner.familyId, childId: legacyOwner.childId } : {}),
    meshFetchedAt: target.fetchedAt, todaySchedule: schedule(today), targetSchedule: schedule(target),
    subjects: publicPageSubjects(source.subjects), taskIds,
    practiceVariantIds: source.subjects.flatMap((subject) => subject.tasks.flatMap((task) => (task.practiceVariants ?? []).map((variant) => variant.id))),
    testPlacements: source.testPlacements ?? [], notices: source.notices ?? [],
    sourceOnlyEntries: source.sourceOnlyEntries ?? [], retiredTaskIds: source.retiredTaskIds ?? [],
    assignmentRoutes: source.assignmentRoutes ?? [],
    weekendSlot: source.weekendSlot ?? null, sourcePlanFingerprint: sourcePlanFingerprint(source),
    audioProjectionVersion: 1, materialLinks: allMaterialLinks, materialLinkReplacements: source.materialLinkReplacements ?? [],
    taskPageRefs: pageRefs,
    evidenceDayTokens: [...new Set([pair.student, ...(source.evidenceDayTokens || [])])],
    ...gradeProjection.fields,
  }
  const uniquePageRefs = [...new Set(Object.values(pageRefs).flat())]
  const teacherRefs = new Set(Object.entries(pageRefs).flatMap(([taskId, refs]) =>
    (source.materialLinks?.[taskId] ?? []).some((link) => link.sourceType === 'teacher-attachment') ? refs : []))
  const catalogByBook = new Map(), bindingByBook = new Map()
  if (uniquePageRefs.length > 300) fail('В одном выпуске больше 300 страниц; разделите публикацию на безопасные пакеты.')
  if (uniquePageRefs.length && (!legacyOwner?.familyId || !legacyOwner?.childId)) fail('Нельзя выдать страницы без подтверждённой семейной связи.')
  for (const ref of uniquePageRefs) {
    const [bookId, pdfPage] = ref.split('#')
    if (!catalogByBook.has(bookId)) catalogByBook.set(bookId, db.doc(`materialBooks/${bookId}`).get())
    if (!bindingByBook.has(bookId)) bindingByBook.set(bookId, db.doc(`families/${legacyOwner.familyId}/children/${legacyOwner.childId}/books/${bookId}`).get())
    const [shared, catalog, binding] = await Promise.all([
      db.doc(`materialBooks/${bookId}/pages/${pdfPage}`).get(), catalogByBook.get(bookId), bindingByBook.get(bookId),
    ])
    const data = shared.data()
    const grantError = materialGrantError({ ref, catalog: catalog.data(), shared: data, binding: binding.data(), teacherAssigned: teacherRefs.has(ref) })
    if (grantError) fail(grantError)
    batch.set(db.doc(`families/${legacyOwner.familyId}/children/${legacyOwner.childId}/bookPages/${ref}`), {
      bookId, pdfPage: Number(pdfPage), subject: data.subject, title: data.title ?? null,
      printedPage: data.printedPage ?? null, sourceRef: data.sourceRef,
      sourceSha256: data.sourceSha256, editionStatus: data.editionStatus,
      extraction: data.extraction, state: 'published', url: data.url, updatedAt: Timestamp.now(),
    })
  }
  const [oldStudent, oldParent] = await Promise.all([db.doc(`dayPages/${pair.student}`).get(), db.doc(`dayPages/${pair.parent}`).get()])
  const currentGuideTasks = new Set(source.subjects.flatMap((subject) => subject.tasks.flatMap((task) => [task.id, ...(task.problems ?? []).map((problem) => problem.id)])))
  const priorGuideTasks = new Set((oldParent.data()?.subjects ?? []).flatMap((subject) => subject.tasks.flatMap((task) => [task.id, ...(task.problems ?? []).map((problem) => problem.id)])))
  for (const task of familyAssignments) currentGuideTasks.add(task.id)
  for (const task of source.subjects.flatMap((subject) => subject.tasks)) {
    for (const item of [task, ...(task.problems ?? [])]) {
      const ref = db.doc(`dayTaskGuides/${pair.student}/items/${item.id}`)
      if (item.parentGuide || item.sourceResearch) {
        if (!legacyOwner?.familyId || !legacyOwner?.childId) fail('Нельзя опубликовать родительский ориентир без подтверждённой семьи.')
        batch.set(ref, { familyId: legacyOwner.familyId, childId: legacyOwner.childId, taskId: item.id,
          ...(item.parentGuide ? { guide: item.parentGuide } : {}),
          ...(item.sourceResearch ? { sourceResearch: item.sourceResearch } : {}),
          sourcePlanFingerprint: sourcePlanFingerprint(source), updatedAt: Timestamp.now() })
      } else if (!familyAssignments.some((assignment) => assignment.id === item.id)) batch.delete(ref)
    }
  }
  for (const task of familyAssignments) {
    if (task.parentGuide) {
      const guideErrors = familyGuideErrors(task.parentGuide, task)
      if (guideErrors.length) fail(guideErrors.join(' '))
      batch.set(db.doc(`dayTaskGuides/${pair.student}/items/${task.id}`), { familyId: legacyOwner.familyId, childId: legacyOwner.childId,
        taskId: task.id, guide: task.parentGuide, sourceRevision: task.sourceRevision, updatedAt: Timestamp.now() })
    }
  }
  for (const taskId of priorGuideTasks) if (!currentGuideTasks.has(taskId)) batch.delete(db.doc(`dayTaskGuides/${pair.student}/items/${taskId}`))
  const routeIdentity = learningRouteIdentity(pair, legacyOwner)
  const studentPage = mergeDayPage(oldStudent.data(), { ...base, ...routeIdentity, subjects: publicPageSubjects(source.subjects), kind: 'student', boardToken: boardToken('student') })
  const parentPage = mergeDayPage(oldParent.data(), { ...base, ...routeIdentity, kind: 'parent', studentToken: pair.student, boardToken: boardToken('parent'), parentNotes: source.parentNotes ?? [] })
  const mergedStudentPage = mergeFamilyAssignments(studentPage, familyAssignments)
  const mergedParentPage = mergeFamilyAssignments(parentPage, familyAssignments)
  Object.assign(studentPage, mergedStudentPage)
  Object.assign(parentPage, mergedParentPage)
  studentPage.subjects = publicPageSubjects(studentPage.subjects)
  parentPage.subjects = publicPageSubjects(parentPage.subjects)
  await Promise.all([assertAssignmentLinksExist(db, studentPage), assertAssignmentLinksExist(db, parentPage)])
  batch.set(db.doc(`dayPages/${pair.student}`), studentPage)
  batch.set(db.doc(`dayPages/${pair.parent}`), parentPage)
  stagedPages[pair.student] = studentPage
  stagedPages[pair.parent] = parentPage
  const ownerRef = db.doc(`dayOwners/${pair.student}`)
  const priorOwner = await ownerRef.get()
  if (priorOwner.exists && (priorOwner.data().familyId !== legacyOwner?.familyId || priorOwner.data().childId !== legacyOwner?.childId)) {
    fail('Страница дня уже закреплена за другим ребёнком.')
  }
  if (legacyOwner?.familyId && legacyOwner?.childId) batch.set(ownerRef, {
    schemaVersion: 1, familyId: legacyOwner.familyId, childId: legacyOwner.childId,
    date, targetDate: source.targetDate, updatedAt: Timestamp.now(),
  }, { merge: true })
  const familyOwner = ownerContext()
  if (notifyGrades && familyOwner?.familyId && familyOwner?.childId && oldParent.exists) {
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
  // Comments on marks can contain a real lesson remark, even when MESH notifications are empty.
  // @see ../docs/modules/notifications/inbox.md#school-alerts
  if (notifyGrades && familyOwner?.familyId && familyOwner?.childId) await stageSchoolAlerts(db, batch, latestCompleteDiarySnapshot(), familyOwner)
  return { source, pair, taskIds }
}

/** All changed linked days enter the same checked Firestore batch before the
 * dashboard index is updated. The full fingerprint guard stays enabled.
 * @see ../docs/modules/school-diary/dashboard.md#sync-freshness
 */
async function publishDates(dates) {
  if (!dates.length || new Set(dates).size !== dates.length) fail('Укажите уникальные даты для выпуска.')
  const links = existsSync(linksFile) ? json(linksFile) : {}
  const indexTokens = dashboardLinks()
  const batch = db.batch()
  const stagedPages = {}
  const staged = []
  const gradeProjection = currentGradeProjection()
  for (const dayDate of dates) staged.push(await stagePublish(dayDate, batch, links, indexTokens, stagedPages, staged.length === 0, gradeProjection))
  const updatedGradeTokens = await addDashboardDocuments(batch, links, indexTokens, stagedPages, gradeProjection)
  await batch.commit()
  for (const item of staged) await verifyPublishedDay(item.source, item.pair, indexTokens, links)
  await verifyPublishedIndex(links, indexTokens)
  await verifyGradeProjection(updatedGradeTokens, gradeProjection.fields)
  mkdirSync(local, { recursive: true })
  writeFileSync(linksFile, JSON.stringify(links, null, 2), { mode: 0o600 })
  writeFileSync(dashboardLinksFile, JSON.stringify(indexTokens, null, 2), { mode: 0o600 })
  console.log(JSON.stringify(staged.map(({ source, pair, taskIds }) => ({ targetDate: source.targetDate,
    student: `${site}#/day/${pair.student}`, parent: `${site}#/day-parent/${pair.parent}`, tasks: taskIds.length })), null, 2))
}
async function publish() { return publishDates([date]) }

/** Publish one explicit family-origin written task to the already-published
 * page for its due date. MESH snapshots and source fingerprints are untouched. */
async function publishFamilyAssignment() {
  const requestFile = resolve(local, date ?? '')
  const apply = process.argv.includes('--apply')
  if (!date || !existsSync(requestFile) || process.argv.includes('--dry-run') && apply) {
    fail('Укажите путь к JSON в `.local/` и ровно один режим: `family-assignment REQUEST.json [--dry-run|--apply]`.')
  }
  const request = json(requestFile)
  if (request.schemaVersion !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(request.sourceDate ?? '') || !request.parentGuide) fail('Нужны schemaVersion 1, sourceDate и отдельный закрытый parentGuide.')
  const owner = ownerContext()
  if (!owner?.familyId || !owner?.childId) fail('Сначала подтвердите владельца через локальный family-access.')
  const allowedTaskFields = new Set(['id', 'familyId', 'childId', 'sourceSystem', 'sourceId', 'sourceRevision', 'subjectId', 'subjectName', 'dueDate', 'title', 'originalText', 'studentText', 'publication', 'evidence', 'materialIds', 'steps', 'submission', 'cardPattern', 'cardPolicyVersion', 'outputKind', 'dayProjectionVersion'])
  if (Object.keys(request.task ?? {}).some((key) => !allowedTaskFields.has(key))) fail('Каноническая задача содержит поля вне разрешённого семейного формата.')
  if (request.task?.familyId !== owner.familyId || request.task?.childId !== owner.childId) fail('ID семьи и ребёнка в запросе должны точно совпасть с локальным owner; подмена владельца запрещена.')
  const task = { ...request.task, dayProjectionVersion: 1,
    sourceEvidence: { kind: 'parent-request', excerpt: request.parentGuide.stages?.[0]?.source?.excerpt ?? '' } }
  const errors = familyAssignmentErrors(task, { familyId: owner.familyId, childId: owner.childId, taskId: task?.id })
  if (errors.length) fail(errors.join(' '))
  const links = json(linksFile)
  const candidates = Object.entries(links).flatMap(([sourceDate, pair]) => {
    if (sourceDate !== request.sourceDate) return []
    const file = resolve(local, `day-source-${sourceDate}.json`)
    if (!existsSync(file)) return []
    const source = json(file)
    return source.targetDate === task.dueDate ? [{ sourceDate, source, pair }] : []
  }).sort((a, b) => b.sourceDate.localeCompare(a.sourceDate))
  const selected = candidates[0]
  if (!selected?.pair?.student || !selected.pair.parent) fail(`Нет опубликованной пары страниц для срока ${task.dueDate}.`)
  const { sourceDate, source, pair } = selected
  assertSourceAligned(source, json(resolve(local, `diary/snapshot-${source.targetDate}.json`)))
  const taskRef = db.doc(`families/${owner.familyId}/children/${owner.childId}/tasks/${task.id}`)
  const studentRef = db.doc(`dayPages/${pair.student}`), parentRef = db.doc(`dayPages/${pair.parent}`)
  const guideRef = db.doc(`dayTaskGuides/${pair.student}/items/${task.id}`)
  const [membership, ownerSnap, taskSnap, studentSnap, parentSnap, guideSnap] = await Promise.all([
    db.collection(`families/${owner.familyId}/members`).get(), db.doc(`dayOwners/${pair.student}`).get(), taskRef.get(), studentRef.get(), parentRef.get(), guideRef.get(),
  ])
  const membershipSnap = membership.docs.find((item) => item.data().active === true && item.data().role === 'parent' && item.data().childIds?.includes(owner.childId))
  if (!membershipSnap) fail('Для ребёнка нет активного родительского членства.')
  if (!ownerSnap.exists || ownerSnap.data().familyId !== owner.familyId || ownerSnap.data().childId !== owner.childId || ownerSnap.data().targetDate !== task.dueDate) fail('Существующая карта владельца страницы не совпадает с семьёй, ребёнком и сроком.')
  if (![studentSnap.data(), parentSnap.data()].every((page, index) => page?.kind === ['student', 'parent'][index]
    && page.familyId === owner.familyId && page.childId === owner.childId && page.targetDate === task.dueDate)) fail('Опубликованные страницы не совпадают по роли, владельцу и дате.')
  const { parentGuide: _parentGuide, ...storedTaskFields } = task
  const storedTask = { ...storedTaskFields, checkedAt: Timestamp.now() }
  const guideErrors = familyGuideErrors(request.parentGuide, task)
  if (guideErrors.length) fail(guideErrors.join(' '))
  const priorTask = taskSnap.data()
  if (priorTask && priorTask.sourceSystem !== 'family') fail('Этот taskId уже принадлежит другому источнику.')
  if (priorTask && task.sourceRevision < priorTask.sourceRevision) fail('Нельзя откатить ревизию семейного задания.')
  if (priorTask && task.sourceRevision === priorTask.sourceRevision
    && stableFamilyProjectionJson(familyAssignmentRecordSignature(priorTask)) !== stableFamilyProjectionJson(familyAssignmentRecordSignature(task))) {
    fail('Содержимое семейного задания изменилось без увеличения sourceRevision.')
  }
  if (priorTask && task.sourceRevision > priorTask.sourceRevision) {
    const [progress, privateReview, uploads] = await Promise.all([
      db.doc(`dayProgress/${pair.student}/items/${task.id}`).get(),
      db.doc(`dayReviewPrivate/${pair.student}/items/${task.id}`).get(),
      db.collection(`dayUploads/${pair.student}/files`).get(),
    ])
    const hasTaskUpload = uploads.docs.some((snapshot) => snapshot.data()?.taskId === task.id
      || snapshot.data()?.coveredTaskIds?.includes(task.id))
    if (progress.exists || privateReview.exists || hasTaskUpload) {
      fail('Нельзя менять текст семейного задания после отправки или проверки работы; создайте новое назначение с новым taskId.')
    }
  }
  if (guideSnap.exists && guideSnap.data()?.sourceRevision === task.sourceRevision
    && !isDeepStrictEqual(guideSnap.data()?.guide, request.parentGuide)) fail('Родительский маршрут изменился без увеличения sourceRevision задания.')
  const studentPage = mergeFamilyAssignments(studentSnap.data(), [storedTask])
  const parentPage = mergeFamilyAssignments(parentSnap.data(), [storedTask])
  const summary = { date: sourceDate, targetDate: task.dueDate, taskId: task.id, roles: ['student', 'parent'], preflight: 'passed', applied: false }
  const datedTasks = (await db.collection(`families/${owner.familyId}/children/${owner.childId}/tasks`).where('dueDate', '==', task.dueDate).get()).docs
    .map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }))
  const projectedDatedTasks = familyAssignmentsWithOverlay(datedTasks, storedTask)
  try {
    assertPublishedPageAligned(source, studentPage, 'student', projectedDatedTasks)
    assertPublishedPageAligned(source, parentPage, 'parent', projectedDatedTasks)
  } catch (error) { fail(`Подготовленные семейные страницы не соответствуют проверенному плану МЭШ: ${error.message}`) }
  const pageCurrent = [studentSnap, parentSnap].every((snapshot, index) => {
    try { assertPublishedPageAligned(source, snapshot.data(), ['student', 'parent'][index], datedTasks); return true } catch { return false }
  })
  const taskCurrent = priorTask && stableFamilyProjectionJson(familyAssignmentRecordSignature(priorTask)) === stableFamilyProjectionJson(familyAssignmentRecordSignature(storedTask))
  const guideCurrent = guideSnap.exists && guideSnap.data()?.sourceRevision === task.sourceRevision && isDeepStrictEqual(guideSnap.data()?.guide, request.parentGuide)
  const dashboardTokens = existsSync(dashboardLinksFile) ? json(dashboardLinksFile) : null
  if (!dashboardTokens?.student || !dashboardTokens?.parent) fail('Нет существующих ролевых токенов dashboard; сначала выпустите дневник штатной командой.')
  const dashboardRefs = Object.fromEntries(['student', 'parent'].map((role) => [role, db.doc(`dayDashboards/${dashboardTokens[role]}`)]))
  const dashboardSnaps = Object.fromEntries(await Promise.all(['student', 'parent'].map(async (role) => [role, await dashboardRefs[role].get()])))
  const dashboardDeltas = {}
  const expectedDashboardDays = {}
  for (const role of ['student', 'parent']) {
    const snapshot = dashboardSnaps[role], data = snapshot.data()
    if (!snapshot.exists || data?.kind !== role || data.familyId !== owner.familyId || data.childId !== owner.childId) fail(`Dashboard ${role} не совпадает с подтверждённой семьёй и ребёнком.`)
    try { assertLearningRouteIdentity(data, learningRouteIdentity(dashboardTokens, owner)) }
    catch { fail(`Ссылки dashboard ${role} не совпадают с обеими ролевыми проекциями владельца.`) }
    const expectedIndex = buildDayDashboardIndex(local, links, role, new Date(), data.schoolCalendar, projectedDatedTasks)
    const expectedDay = expectedIndex.days.find((item) => item.date === task.dueDate)
    const projectedTask = projectedDatedTasks.find((item) => item.id === task.id)
    if (!expectedDay || expectedDay.homeworkDayToken !== pair[role]
      || projectedTask?.title !== task.title
      || !expectedDay.homework.some((item) => item.subject === (task.subjectName || 'Русский язык'))) {
      fail(`Проверенный dashboard ${role} не маршрутизирует срок ${task.dueDate} к странице семейного задания.`)
    }
    expectedDashboardDays[role] = expectedDay
    try {
      dashboardDeltas[role] = familyDashboardDateDelta(data, expectedDay, {
        familyId: owner.familyId, childId: owner.childId, role,
        changedSubject: task.subjectName || 'Русский язык', at: new Date().toISOString(),
      })
    } catch (error) { fail(error.message) }
  }
  const dashboardCurrent = ['student', 'parent'].every((role) => dashboardDeltas[role] === null)
  const taskPagesCurrent = Boolean(taskCurrent && pageCurrent && guideCurrent)
  const alreadyPublished = taskPagesCurrent && dashboardCurrent
  summary.writes = (taskPagesCurrent ? 0 : request.parentGuide ? 4 : 3) + ['student', 'parent'].filter((role) => dashboardDeltas[role]).length
  summary.dashboardDateRows = ['student', 'parent'].filter((role) => dashboardDeltas[role]).length
  if (!apply) { console.log(JSON.stringify(summary)); return }
  if (!alreadyPublished) await db.runTransaction(async (transaction) => {
    const reads = [
      transaction.get(ownerSnap.ref), transaction.get(membershipSnap.ref), transaction.get(taskRef), transaction.get(studentRef), transaction.get(parentRef), transaction.get(guideRef),
      ...(['student', 'parent'].filter((role) => dashboardDeltas[role]).map((role) => transaction.get(dashboardRefs[role]))),
    ]
    const current = await Promise.all(reads)
    const [currentOwner, currentMembership, currentTask, currentStudent, currentParent, currentGuide] = current
    const currentDashboards = Object.fromEntries(['student', 'parent'].filter((role) => dashboardDeltas[role])
      .map((role, index) => [role, current[6 + index]]))
    for (const role of Object.keys(currentDashboards)) {
      const dashboard = currentDashboards[role]
      if (!dashboard.exists || !dashboard.updateTime.isEqual(dashboardSnaps[role].updateTime)
        || dashboard.data()?.kind !== role || dashboard.data()?.familyId !== owner.familyId || dashboard.data()?.childId !== owner.childId) {
        fail(`Dashboard ${role} изменился после предпросмотра; адресное обновление отменено.`)
      }
      try { assertLearningRouteIdentity(dashboard.data(), learningRouteIdentity(dashboardTokens, owner)) }
      catch { fail(`Ссылки dashboard ${role} изменились после предпросмотра.`) }
    }
    if (!currentOwner.updateTime.isEqual(ownerSnap.updateTime)
      || !currentMembership.exists || !currentMembership.updateTime.isEqual(membershipSnap.updateTime)
      || currentMembership.data().active !== true || currentMembership.data().role !== 'parent' || !currentMembership.data().childIds?.includes(owner.childId)
      || currentTask.exists !== taskSnap.exists || currentTask.exists && !currentTask.updateTime.isEqual(taskSnap.updateTime)
      || !currentStudent.updateTime.isEqual(studentSnap.updateTime) || !currentParent.updateTime.isEqual(parentSnap.updateTime)
      || currentGuide.exists !== guideSnap.exists || currentGuide.exists && !currentGuide.updateTime.isEqual(guideSnap.updateTime)) fail('Владелец, задача или день изменились после предпросмотра; публикация отменена.')
    if (!taskPagesCurrent) {
      transaction.set(taskRef, storedTask)
      transaction.set(studentRef, { ...studentPage, updatedAt: Timestamp.now() })
      transaction.set(parentRef, { ...parentPage, updatedAt: Timestamp.now() })
      if (request.parentGuide) transaction.set(guideRef, { familyId: owner.familyId, childId: owner.childId, taskId: task.id,
        guide: request.parentGuide, sourcePlanFingerprint: sourcePlanFingerprint(source), sourceRevision: task.sourceRevision, updatedAt: Timestamp.now() })
    }
    for (const role of Object.keys(currentDashboards)) transaction.update(dashboardRefs[role], {
      days: dashboardDeltas[role].days, updatedAt: Timestamp.now(),
    })
  })
  if (!alreadyPublished) {
    const [liveTask, liveStudent, liveParent] = await Promise.all([taskRef.get(), studentRef.get(), parentRef.get()])
    if (liveTask.data()?.sourceSystem !== 'family' || ![liveStudent, liveParent].every((snap) => snap.data()?.taskIds?.includes(task.id))) fail('Обратное чтение семейного задания или taskIds не совпало.')
  }
  const liveDashboards = await Promise.all(['student', 'parent'].map((role) => dashboardRefs[role].get()))
  for (const [index, role] of ['student', 'parent'].entries()) {
    const data = liveDashboards[index].data()
    try { assertLearningRouteIdentity(data, learningRouteIdentity(dashboardTokens, owner)) }
    catch { fail(`Обратное чтение dashboard ${role} не совпало с владельцем.`) }
    const day = data?.days?.find((item) => item.date === task.dueDate)
    if (data?.kind !== role || data?.familyId !== owner.familyId || data?.childId !== owner.childId
      || day?.homeworkDayToken !== pair[role]
      || !isDeepStrictEqual(day?.homework ?? [], expectedDashboardDays[role].homework)) {
      fail(`Обратное чтение dashboard ${role} не подтвердило адресную строку ${task.dueDate}.`)
    }
    const prior = dashboardSnaps[role].data()
    const priorDaysOutsideTarget = prior.days.filter((item) => item.date !== task.dueDate)
    const liveDaysOutsideTarget = data.days.filter((item) => item.date !== task.dueDate)
    const omit = (value, fields) => Object.fromEntries(Object.entries(value ?? {}).filter(([key]) => !fields.includes(key)))
    if (!isDeepStrictEqual(priorDaysOutsideTarget, liveDaysOutsideTarget)
      || !isDeepStrictEqual(omit(prior, ['days', 'updatedAt']), omit(data, ['days', 'updatedAt']))) {
      fail(`Адресное обновление dashboard ${role} изменило несвязанные даты или поля.`)
    }
    const priorTarget = prior.days.find((item) => item.date === task.dueDate)
    if (!isDeepStrictEqual(omit(priorTarget, ['homework', 'homeworkDayToken', 'homeworkUpdate']), omit(day, ['homework', 'homeworkDayToken', 'homeworkUpdate']))) {
      fail(`Адресное обновление dashboard ${role} изменило несвязанные поля даты ${task.dueDate}.`)
    }
  }
  console.log(JSON.stringify({ ...summary, applied: true, changed: !alreadyPublished, parentGuide: Boolean(request.parentGuide), dashboard: dashboardCurrent ? 'already-current' : 'date-row-published-and-verified' }))
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
  const gradeProjection = Object.keys(links).length ? currentGradeProjection() : null
  const updatedGradeTokens = await addDashboardDocuments(batch, links, indexTokens, {}, gradeProjection)
  await batch.commit()
  await verifyPublishedIndex(links, indexTokens)
  if (gradeProjection) await verifyGradeProjection(updatedGradeTokens, gradeProjection.fields)
  writeFileSync(dashboardLinksFile, JSON.stringify(indexTokens, null, 2), { mode: 0o600 })
  console.log(JSON.stringify({ student: `${site}#/days/${indexTokens.student}`, parent: `${site}#/days-parent/${indexTokens.parent}` }, null, 2))
}

/** Addressed repair for an already published grade projection; default is read-only.
 * @see ../docs/modules/school-diary/grades.md#mesh-reconciliation
 */
async function reconcilePublishedGrades(apply) {
  const links = json(linksFile)
  const tokens = dashboardLinks()
  const owner = ownerContext()
  if (!owner?.familyId || !owner?.childId) fail('Для сверки оценок нужен подтверждённый семейный владелец.')
  const projection = currentGradeProjection()
  const batch = db.batch()
  const changed = { parent: [], student: [] }
  let indexUpdates = 0
  for (const role of ['student', 'parent']) {
    const dashboard = db.doc(`dayDashboards/${tokens[role]}`)
    const previous = (await dashboard.get()).data()
    const cache = new Map()
    changed[role] = await stageGradeProjectionForRole({
      role, links, owner, fingerprint: projection.fingerprint, previousFingerprint: null,
      desired: projection.fields,
      loadPage: async (token) => {
        if (!cache.has(token)) cache.set(token, (await db.doc(`dayPages/${token}`).get()).data())
        return cache.get(token)
      },
      stagePatch: (token, patch) => batch.update(db.doc(`dayPages/${token}`), patch),
    })
    if (previous?.gradeProjectionFingerprint !== projection.fingerprint) {
      batch.set(dashboard, { gradeProjectionFingerprint: projection.fingerprint }, { merge: true })
      indexUpdates++
    }
  }
  const writes = changed.parent.length + changed.student.length + indexUpdates
  if (apply && writes) {
    await batch.commit()
    await verifyGradeProjection([...changed.parent, ...changed.student], projection.fields)
    for (const role of ['student', 'parent']) {
      const index = (await db.doc(`dayDashboards/${tokens[role]}`).get()).data()
      if (index?.gradeProjectionFingerprint !== projection.fingerprint) fail(`Ревизия оценок ${role} не сохранилась.`)
    }
  }
  console.log(JSON.stringify({ mode: apply ? 'applied' : 'dry-run', linkedDays: Object.keys(links).length,
    changedPages: { parent: changed.parent.length, student: changed.student.length }, indexUpdates,
    verified: apply ? writes === 0 ? 'already-current' : 'read-back' : 'pending' }))
}

/** @see ../docs/modules/materials/storage-privacy.md#upload-queue */
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
 * @see ../docs/modules/reviews/adaptive-problem-card.md#выпуск-и-безопасность
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
    const ownerRef = db.doc(`dayOwners/${pair.student}`)
    const [ownerSnapshot, ...snapshots] = await Promise.all([ownerRef, ...refs].map((ref) => transaction.get(ref)))
    if (snapshots.some((snapshot) => !snapshot.exists)) fail('Одна из страниц дня отсутствует. Сначала опубликуйте день.')
    const owner = ownerSnapshot.data()
    if (!owner?.familyId || !owner?.childId) fail('Для защищённого разбора нужна подтверждённая семья и ребёнок.')
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
          const next = { ...publicProblem(problem), original: newer.original, support: newer.support }
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
    for (const problem of [...incoming.values()].flatMap((task) => task.problems)) {
      const guideRef = db.doc(`dayTaskGuides/${pair.student}/items/${problem.id}`)
      if (problem.parentGuide || problem.sourceResearch) transaction.set(guideRef, {
        familyId: owner.familyId, childId: owner.childId, taskId: problem.id,
        ...(problem.parentGuide ? { guide: problem.parentGuide } : {}),
        ...(problem.sourceResearch ? { sourceResearch: problem.sourceResearch } : {}),
        sourcePlanFingerprint: sourcePlanFingerprint(source), updatedAt: Timestamp.now(),
      })
      else transaction.delete(guideRef)
    }
    return counts
  })
  console.log(JSON.stringify({ studentProblemsChanged: result[0], parentProblemsChanged: result[1], siteReleaseNeeded: false }))
}

/** Read-only audit of the published graph. Run after releases and during sync.
 * @see ../docs/modules/families/access-and-state.md#integrity-gates */
async function auditPublishedDays() {
  const started = performance.now()
  const links = json(linksFile)
  const dates = date ? [date] : Object.keys(links).sort()
  const problems = []
  const rows = []
  const catalogCache = new Map(), bindingCache = new Map(), sharedCache = new Map(), familyCache = new Map()
  const reads = { rolePages: 0, materialRefs: 0,
    sharedPages: 0, familyPages: 0, catalogs: 0, bindings: 0 }
  let placementChecks = 0
  const roleTimings = []
  const measuredDays = new Map()
  let next = 0
  await Promise.all(Array.from({ length: Math.min(3, dates.length) }, async () => {
    while (next < dates.length) {
      const dayDate = dates[next++]
      const dayStarted = performance.now()
      const dayProblems = [], dayRows = []
      const pair = links[dayDate]
      if (!pair?.student || !pair?.parent) {
        dayProblems.push(`${dayDate}: нет двух ролевых ссылок`)
        measuredDays.set(dayDate, { problems: dayProblems, rows: dayRows, ms: Math.round(performance.now() - dayStarted) })
        continue
      }
      const pages = {}
      for (const role of ['student', 'parent']) {
        const roleStarted = performance.now()
        const roleTime = { date: dayDate, role }
        try {
          reads.rolePages++
          const snapshot = await db.doc(`dayPages/${pair[role]}`).get()
          roleTime.pageGetMs = Math.round(performance.now() - roleStarted)
          if (!snapshot.exists) throw new Error('Страница роли отсутствует.')
          const page = snapshot.data()
          if (page.schemaVersion !== 1 || page.kind !== role || page.date !== dayDate) throw new Error('Версия, роль или дата страницы неверна.')
          placementChecks += (page.testPlacements ?? []).length
          const placementStarted = performance.now()
          await assertAssignmentLinksExist(db, page)
          roleTime.assignmentLinksMs = Math.round(performance.now() - placementStarted)
          const materialStarted = performance.now()
          const refs = [...new Set(Object.values(page.taskPageRefs ?? {}).flat())]
          reads.materialRefs += refs.length
          const teacherRefs = new Set(Object.entries(page.taskPageRefs ?? {}).flatMap(([taskId, taskRefs]) =>
            (page.materialLinks?.[taskId] ?? []).some((link) => link.sourceType === 'teacher-attachment') ? taskRefs : []))
          const refErrors = []
          for (let offset = 0; offset < refs.length; offset += 12) {
            const settled = await Promise.allSettled(refs.slice(offset, offset + 12).map(async (ref) => {
              const [bookId, pdfPage] = ref.split('#')
              if (!catalogCache.has(bookId)) {
                reads.catalogs++
                catalogCache.set(bookId, db.doc(`materialBooks/${bookId}`).get())
              }
              const bindingKey = `${page.familyId}/${page.childId}/${bookId}`
              if (page.familyId && page.childId && !bindingCache.has(bindingKey)) {
                reads.bindings++
                bindingCache.set(bindingKey, db.doc(`families/${page.familyId}/children/${page.childId}/books/${bookId}`).get())
              }
              const familyKey = `${page.familyId}/${page.childId}/${ref}`
              if (!sharedCache.has(ref)) {
                reads.sharedPages++
                sharedCache.set(ref, db.doc(`materialBooks/${bookId}/pages/${pdfPage}`).get())
              }
              if (page.familyId && page.childId && !familyCache.has(familyKey)) {
                reads.familyPages++
                familyCache.set(familyKey, db.doc(`families/${page.familyId}/children/${page.childId}/bookPages/${ref}`).get())
              }
              const [shared, family, catalog, binding] = await Promise.all([
                sharedCache.get(ref), familyCache.get(familyKey) ?? null,
                catalogCache.get(bookId), bindingCache.get(bindingKey) ?? null,
              ])
              const grantError = materialGrantError({ ref, catalog: catalog.data(), shared: shared.data(), binding: binding?.data(), teacherAssigned: teacherRefs.has(ref) })
              if (grantError) throw new Error(grantError)
              if (family && !family.exists) throw new Error(`Нет семейной проекции страницы ${ref}.`)
              if (family && family.data().sourceRef !== shared.data().sourceRef) throw new Error(`Семейная связь страницы ${ref} не совпадает с общим каталогом.`)
            }))
            for (const result of settled) if (result.status === 'rejected') refErrors.push(result.reason instanceof Error ? result.reason.message : String(result.reason))
          }
          if (refErrors.length) {
            const counts = new Map()
            for (const message of refErrors) counts.set(message, (counts.get(message) ?? 0) + 1)
            throw new Error([...counts].sort(([a], [b]) => a.localeCompare(b, 'ru')).map(([message, count]) =>
              count > 1 ? `${message} (${count} стр.)` : message).join(' '))
          }
          roleTime.materialRefsMs = Math.round(performance.now() - materialStarted)
          pages[role] = page
          dayRows.push({ date: dayDate, role, tasks: page.subjects.flatMap((subject) => subject.tasks).length, tests: page.testPlacements?.length ?? 0, pages: refs.length })
        } catch (error) { dayProblems.push(`${dayDate} ${role}: ${error instanceof Error ? error.message : String(error)}`) }
        finally {
          roleTime.totalMs = Math.round(performance.now() - roleStarted)
          roleTimings.push(roleTime)
        }
      }
      if (pages.parent && pages.student) {
        const ids = (page) => page.subjects.flatMap((subject) => subject.tasks.map((task) => task.id)).sort()
        if (JSON.stringify(ids(pages.parent)) !== JSON.stringify(ids(pages.student))) dayProblems.push(`${dayDate}: ролевые страницы содержат разные taskId.`)
        if (pages.parent.studentToken !== pair.student) dayProblems.push(`${dayDate}: родительская страница указывает на другого ученика.`)
      }
      measuredDays.set(dayDate, { problems: dayProblems, rows: dayRows, ms: Math.round(performance.now() - dayStarted) })
    }
  }))
  for (const dayDate of dates) {
    const result = measuredDays.get(dayDate)
    problems.push(...result.problems)
    rows.push(...result.rows)
  }
  console.log(JSON.stringify({ checkedDates: dates.length, rows, problems,
    measurements: { totalMs: Math.round(performance.now() - started), dayMs: Object.fromEntries(dates.map((dayDate) => [dayDate, measuredDays.get(dayDate).ms])),
      roleMs: roleTimings.sort((a, b) => a.date.localeCompare(b.date) || a.role.localeCompare(b.role)),
      sdkDocumentGets: reads, placementChecks,
      note: 'SDK calls, not billed Firestore reads; dates checked with concurrency 3' } }, null, 2))
  if (problems.length) fail(`Аудит обнаружил ${problems.length} несогласованных связей.`)
}

/** Narrow, reversible-by-evidence migration: repair the task-to-quiz edge only.
 * A private snapshot is retained; a rollback requires the old graph to pass the
 * current contract and is never applied automatically.
 * @see ../docs/shared/data/firestore.md#migration */
async function repairPublishedPlacements() {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) fail('Укажите дату YYYY-MM-DD.')
  const pair = json(linksFile)[date]
  if (!pair?.student || !pair?.parent) fail('Для дня нет обеих ролевых страниц.')
  const roles = await Promise.all(['student', 'parent'].map(async (role) => {
    const ref = db.doc(`dayPages/${pair[role]}`)
    const snapshot = await ref.get()
    if (!snapshot.exists) fail(`Нет страницы ${role}.`)
    const before = snapshot.data()
    if (before.schemaVersion !== 1 || before.kind !== role || before.date !== date) fail(`Неверная схема, роль или дата страницы ${role}.`)
    const after = repairTaskPlacements(before)
    await assertAssignmentLinksExist(db, after)
    return { role, ref, snapshot, before, after }
  }))
  const changed = roles.filter((item) => JSON.stringify(item.before.testPlacements ?? []) !== JSON.stringify(item.after.testPlacements))
  const summary = { date, pages: roles.map(({ role, before, after }) => ({ role, before: before.testPlacements?.length ?? 0, after: after.testPlacements?.length ?? 0 })), changed: changed.length }
  if (!process.argv.includes('--apply') || !changed.length) { console.log(JSON.stringify({ ...summary, applied: false })); return }
  const backupPath = resolve(local, `day-placement-migration-${date}-${Date.now()}.json`)
  writeFileSync(backupPath, JSON.stringify({ date, pages: roles.map(({ role, before, snapshot }) => ({
    role, updateTime: snapshot.updateTime.toMillis(), testPlacements: before.testPlacements ?? [],
    taskTestTokens: before.subjects.flatMap((subject) => subject.tasks.filter((task) => task.testToken)
      .map((task) => ({ id: task.id, subjectId: subject.id, token: task.testToken }))),
  })) }, null, 2), { mode: 0o600, flag: 'wx' })
  await db.runTransaction(async (transaction) => {
    const current = await Promise.all(roles.map(({ ref }) => transaction.get(ref)))
    for (const [index, item] of roles.entries()) {
      if (!current[index].updateTime.isEqual(item.snapshot.updateTime)) fail('Страница изменилась после проверки; миграция отменена.')
      if (changed.includes(item)) transaction.update(item.ref, { testPlacements: item.after.testPlacements, updatedAt: Timestamp.now() })
    }
  })
  for (const item of roles) {
    const live = (await item.ref.get()).data()
    if (JSON.stringify(live.testPlacements ?? []) !== JSON.stringify(item.after.testPlacements)) fail(`Связи ${item.role} после миграции не совпали.`)
    await assertAssignmentLinksExist(db, live)
  }
  console.log(JSON.stringify({ ...summary, applied: true, backupPath }))
}

/** Restore only a teacher-assigned page projection. A textbook needs the
 * family's own book binding and is deliberately excluded from this repair. */
async function repairTeacherProjections() {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) fail('Укажите дату YYYY-MM-DD.')
  const pair = json(linksFile)[date]
  if (!pair?.student || !pair?.parent) fail('Для дня нет обеих ролевых страниц.')
  const snapshots = await Promise.all(['student', 'parent'].map((role) => db.doc(`dayPages/${pair[role]}`).get()))
  const pages = snapshots.map((snapshot) => snapshot.data())
  if (pages.some((page, index) => !page || page.kind !== ['student', 'parent'][index] || page.date !== date)
    || !pages[0].familyId || !pages[0].childId || pages[0].familyId !== pages[1].familyId
    || pages[0].childId !== pages[1].childId) fail('Роли, дата или семья не совпадают.')
  const candidates = new Set()
  for (const page of pages) for (const [taskId, refs] of Object.entries(page.taskPageRefs ?? {})) {
    if (!(page.materialLinks?.[taskId] ?? []).some((link) => link.sourceType === 'teacher-attachment')) continue
    for (const ref of refs) candidates.add(ref)
  }
  const missing = []
  for (const ref of candidates) {
    if (!pages.every((page) => Object.values(page.taskPageRefs ?? {}).flat().includes(ref))) fail(`Роли расходятся по странице ${ref}.`)
    const [bookId, pdfPage] = ref.split('#')
    const [catalog, shared, family] = await Promise.all([
      db.doc(`materialBooks/${bookId}`).get(), db.doc(`materialBooks/${bookId}/pages/${pdfPage}`).get(),
      db.doc(`families/${pages[0].familyId}/children/${pages[0].childId}/bookPages/${ref}`).get(),
    ])
    if (catalog.data()?.role === 'student-textbook') fail(`Учебник ${bookId} требует загрузки и связи семьи; миграция листа учителя запрещена.`)
    if (!shared.exists || shared.data().state !== 'published' || typeof shared.data().url !== 'string'
      || !shared.data().url.startsWith('https://')) fail(`Общий лист ${ref} не опубликован.`)
    if (family.exists) {
      if (family.data().sourceSha256 !== shared.data().sourceSha256) fail(`Семейный лист ${ref} уже связан с другим оригиналом.`)
      continue
    }
    missing.push({ ref, shared: shared.data() })
  }
  const summary = { date, checked: candidates.size, missing: missing.map((item) => item.ref) }
  if (!process.argv.includes('--apply') || !missing.length) { console.log(JSON.stringify({ ...summary, applied: false })); return }
  const backupPath = resolve(local, `teacher-page-migration-${date}-${Date.now()}.json`)
  writeFileSync(backupPath, JSON.stringify({ date, missingBefore: missing.map((item) => item.ref),
    roleUpdateTimes: snapshots.map((item) => item.updateTime.toMillis()) }, null, 2), { mode: 0o600, flag: 'wx' })
  await db.runTransaction(async (transaction) => {
    const current = await Promise.all(['student', 'parent'].map((role) => transaction.get(db.doc(`dayPages/${pair[role]}`))))
    if (current.some((item, index) => !item.updateTime.isEqual(snapshots[index].updateTime))) fail('Страница изменилась после проверки; миграция отменена.')
    const refs = missing.map(({ ref }) => db.doc(`families/${pages[0].familyId}/children/${pages[0].childId}/bookPages/${ref}`))
    const existing = await Promise.all(refs.map((ref) => transaction.get(ref)))
    if (existing.some((item) => item.exists)) fail('Семейная страница уже появилась; повторите проверку.')
    for (const [index, item] of missing.entries()) {
      const data = item.shared
      transaction.create(refs[index], {
        bookId: data.bookId, pdfPage: data.pdfPage, subject: data.subject ?? null,
        title: data.title ?? null, printedPage: data.printedPage ?? null,
        ...(data.sourceRef ? { sourceRef: data.sourceRef } : {}),
        sourceSha256: data.sourceSha256, editionStatus: data.editionStatus ?? null,
        extraction: data.extraction ?? null, state: 'published', url: data.url,
        updatedAt: Timestamp.now(),
      })
    }
  })
  for (const item of missing) {
    const live = (await db.doc(`families/${pages[0].familyId}/children/${pages[0].childId}/bookPages/${item.ref}`).get()).data()
    if (live?.sourceSha256 !== item.shared.sourceSha256 || live?.url !== item.shared.url) fail(`Лист ${item.ref} не совпал после записи.`)
  }
  console.log(JSON.stringify({ ...summary, applied: true, backupPath }))
}

/** Restore only owner fields from the existing trusted dayOwners record. */
async function repairPublishedOwner() {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) fail('Укажите дату YYYY-MM-DD.')
  const pair = json(linksFile)[date]
  if (!pair?.student || !pair?.parent) fail('Для дня нет обеих ролевых страниц.')
  const ownerRef = db.doc(`dayOwners/${pair.student}`)
  const refs = ['student', 'parent'].map((role) => db.doc(`dayPages/${pair[role]}`))
  const [ownerSnap, ...snaps] = await Promise.all([ownerRef.get(), ...refs.map((ref) => ref.get())])
  if (!ownerSnap.exists || snaps.some((snap) => !snap.exists)) fail('Нет записи владельца или страницы роли.')
  const owner = ownerSnap.data()
  const fields = snaps.map((snap, index) => {
    const page = snap.data()
    if (page.schemaVersion !== 1 || page.kind !== ['student', 'parent'][index]) fail('Неверная версия или роль страницы.')
    return ownerMigrationFields(page, owner)
  })
  const changed = snaps.filter((snap) => snap.data().familyId !== owner.familyId || snap.data().childId !== owner.childId).length
  const summary = { date, changed, ownerRecord: 'verified', preserved: 'tasks, attempts, photos, reviews, statuses' }
  if (!process.argv.includes('--apply') || !changed) { console.log(JSON.stringify({ ...summary, applied: false })); return }
  const backupPath = resolve(local, `day-owner-migration-${date}-${Date.now()}.json`)
  writeFileSync(backupPath, JSON.stringify({ date, pages: snaps.map((snap, index) => ({
    role: ['student', 'parent'][index], updateTime: snap.updateTime.toMillis(),
    familyId: snap.data().familyId ?? null, childId: snap.data().childId ?? null,
  })) }, null, 2), { mode: 0o600, flag: 'wx' })
  await db.runTransaction(async (transaction) => {
    const [currentOwner, ...current] = await Promise.all([transaction.get(ownerRef), ...refs.map((ref) => transaction.get(ref))])
    if (!currentOwner.updateTime.isEqual(ownerSnap.updateTime)
      || current.some((snap, index) => !snap.updateTime.isEqual(snaps[index].updateTime))) fail('Владелец или страница изменились после проверки.')
    for (const [index, ref] of refs.entries()) transaction.update(ref, { ...fields[index], updatedAt: Timestamp.now() })
  })
  for (const ref of refs) {
    const live = (await ref.get()).data()
    if (live.familyId !== owner.familyId || live.childId !== owner.childId) fail('Владелец после миграции не совпал.')
  }
  console.log(JSON.stringify({ ...summary, applied: true, backupPath }))
}

/** Atomically add a reviewed private route to several already-published views of one task.
 * Existing photos, reviews, task statuses and dashboard links are never rewritten.
 * The old fingerprint must prove the source differs only by approved route fields.
 * @see ../docs/modules/reviews/russian-language-route.md#pipeline */
async function publishGuideUpgrade() {
  const dates = (date ?? '').split(',')
  const taskId = third
  if (!dates.length || dates.some((item) => !/^\d{4}-\d{2}-\d{2}$/.test(item)) || !/^[a-z0-9-]+$/.test(taskId ?? '')) {
    fail('Укажите guide-upgrade YYYY-MM-DD[,YYYY-MM-DD] task-id [--dry-run].')
  }
  const links = json(linksFile)
  const upgrades = dates.map((sourceDate) => {
    const source = json(resolve(local, `day-source-${sourceDate}.json`))
    // Route-only upgrades prove the rest of the historical plan is byte-for-byte unchanged below.
    // Old MESH links remain a release blocker for a full day publish, not for a private guide addition.
    validate(source, { allowUnchangedLegacyTeacherLinks: true })
    assertSourceAligned(source, json(resolve(local, `diary/snapshot-${source.targetDate}.json`)))
    const matches = source.subjects.flatMap((subject) => subject.tasks.filter((task) => task.id === taskId).map((task) => ({ subjectId: subject.id, task })))
    if (matches.length !== 1 || !matches[0].task.parentGuide || matches[0].task.parentGuide.presentation !== 'learning-route') fail(`Нет единственного сверенного маршрута ${taskId} на ${sourceDate}.`)
    const pair = links[sourceDate]
    if (!pair?.student || !pair?.parent) fail(`Страницы ${sourceDate} ещё не опубликованы для обеих ролей.`)
    const unitBaselineFile = resolve(local, `day-source-${sourceDate}.pre-assigned-units.json`)
    const baselineFile = existsSync(unitBaselineFile) ? unitBaselineFile : resolve(local, `day-source-${sourceDate}.pre-learning-route.json`)
    const baseline = existsSync(baselineFile) ? json(baselineFile) : structuredClone(source)
    const oldTask = baseline.subjects.flatMap((subject) => subject.tasks).find((task) => task.id === taskId)
    if (!oldTask || baseline.targetDate !== source.targetDate) fail(`Исходный план ${sourceDate} до маршрута не найден.`)
    if (!existsSync(baselineFile)) for (const field of ['outputKind', 'cardPattern', 'cardPolicyVersion', 'parentGuide']) delete oldTask[field]
    const stripRoute = (document) => {
      const copy = structuredClone(document)
      const matching = copy.subjects.flatMap((subject) => subject.tasks).find((task) => task.id === taskId)
      for (const field of ['outputKind', 'cardPattern', 'cardPolicyVersion', 'parentGuide', 'instructionStatus']) delete matching[field]
      return copy
    }
    if (JSON.stringify(stripRoute(baseline)) !== JSON.stringify(stripRoute(source))
      || oldTask.instructionStatus?.state && oldTask.instructionStatus.state !== 'reviewed') {
      fail(`План ${sourceDate} меняет данные за пределами маршрута ${taskId}.`)
    }
    return { sourceDate, source, pair, subjectId: matches[0].subjectId, task: matches[0].task,
      before: sourcePlanFingerprint(baseline), after: sourcePlanFingerprint(source) }
  })
  const upgradeOwner = ownerContext()
  if (upgradeOwner?.familyId && upgradeOwner?.childId) await Promise.all(upgrades.map(async (item) => {
    item.familyAssignments = (await db.collection(`families/${upgradeOwner.familyId}/children/${upgradeOwner.childId}/tasks`)
      .where('dueDate', '==', item.source.targetDate).get()).docs.map((snapshot) => ({ id: snapshot.id, ...snapshot.data() }))
  }))
  const inspect = async (transaction) => {
    const refs = upgrades.flatMap(({ pair }) => [db.doc(`dayPages/${pair.student}`), db.doc(`dayPages/${pair.parent}`)])
    const owners = upgrades.map(({ pair }) => db.doc(`dayOwners/${pair.student}`))
    const snapshots = await Promise.all([...refs, ...owners].map((ref) => transaction ? transaction.get(ref) : ref.get()))
    const pageSnapshots = snapshots.slice(0, refs.length)
    const ownerSnapshots = snapshots.slice(refs.length)
    const updates = []
    for (let index = 0; index < upgrades.length; index += 1) {
      const item = upgrades[index]
      const owner = ownerSnapshots[index].data()
      if (!owner?.familyId || !owner?.childId || owner.targetDate !== item.source.targetDate) fail(`Семейная связь ${item.sourceDate} не подтверждена.`)
      for (let roleIndex = 0; roleIndex < 2; roleIndex += 1) {
        const role = roleIndex ? 'parent' : 'student'
        const snapshot = pageSnapshots[index * 2 + roleIndex]
        const page = snapshot.data()
        const expectedTasks = item.source.subjects.flatMap((subject) => subject.tasks.map((task) => `${subject.id}:${task.id}:${task.meshText}`)).sort()
        const publishedTasks = page?.subjects?.flatMap((subject) => subject.tasks.map((task) => `${subject.id}:${task.id}:${task.meshText}`)).sort()
        const legacy = page?.sourcePlanFingerprint == null
          && page?.schemaVersion === 1 && page?.date === item.sourceDate
          && JSON.stringify(publishedTasks) === JSON.stringify(expectedTasks)
        if (!page || page.kind !== role || page.targetDate !== item.source.targetDate
          || page.familyId && page.familyId !== owner.familyId || page.childId && page.childId !== owner.childId
          || !legacy && ![item.before, item.after].includes(page.sourcePlanFingerprint)) {
          fail(`Страница ${item.sourceDate} ${role} изменилась помимо разрешённого маршрута: ${JSON.stringify({
            exists: Boolean(page), roleMatches: page?.kind === role, dateMatches: page?.targetDate === item.source.targetDate,
            familyMatches: !page?.familyId || page.familyId === owner.familyId, childMatches: !page?.childId || page.childId === owner.childId,
            fingerprintMatches: legacy || [item.before, item.after].includes(page?.sourcePlanFingerprint), legacy,
          })}`)
        }
        const matches = page.subjects.flatMap((subject) => subject.tasks.filter((task) => subject.id === item.subjectId && task.id === taskId))
        if (matches.length !== 1 || matches[0].meshText !== item.task.meshText) fail(`Условие ${taskId} на странице ${item.sourceDate} ${role} не совпало с МЭШ.`)
        const subjects = page.subjects.map((subject) => subject.id !== item.subjectId ? subject : {
          ...subject, tasks: subject.tasks.map((task) => task.id !== taskId ? task : {
            ...task, outputKind: item.task.outputKind, cardPattern: item.task.cardPattern, cardPolicyVersion: item.task.cardPolicyVersion,
            instructionStatus: item.task.instructionStatus,
          }),
        })
        const next = { ...page, familyId: owner.familyId, childId: owner.childId, subjects, sourcePlanFingerprint: item.after }
        assertPublishedPageAligned(item.source, next, role, item.familyAssignments ?? [])
        updates.push({ ref: refs[index * 2 + roleIndex], fields: { familyId: owner.familyId, childId: owner.childId, subjects, sourcePlanFingerprint: item.after, updatedAt: Timestamp.now() } })
      }
      item.owner = owner
    }
    return updates
  }
  if (process.argv.includes('--dry-run')) {
    await inspect(null)
    console.log(JSON.stringify({ taskId, dates, preflight: 'passed', writes: upgrades.length * 3 }))
    return
  }
  await db.runTransaction(async (transaction) => {
    const updates = await inspect(transaction)
    for (const update of updates) transaction.update(update.ref, update.fields)
    for (const item of upgrades) transaction.set(db.doc(`dayTaskGuides/${item.pair.student}/items/${taskId}`), {
      familyId: item.owner.familyId, childId: item.owner.childId, taskId,
      guide: item.task.parentGuide, sourcePlanFingerprint: item.after, updatedAt: Timestamp.now(),
    })
  })
  for (const item of upgrades) {
    for (const role of ['student', 'parent']) {
      const page = (await db.doc(`dayPages/${item.pair[role]}`).get()).data()
      assertPublishedPageAligned(item.source, page, role, item.familyAssignments ?? [])
      if (page.subjects.flatMap((subject) => subject.tasks).some((task) => task.parentGuide)) fail('Закрытый разбор попал в публичную страницу.')
    }
    const guide = (await db.doc(`dayTaskGuides/${item.pair.student}/items/${taskId}`).get()).data()?.guide
    if (guide?.revision !== item.task.parentGuide.revision || guide?.pattern !== item.task.cardPattern) fail(`После записи маршрут ${taskId} на ${item.sourceDate} не совпал с источником.`)
  }
  console.log(JSON.stringify({ taskId, dates, published: true, preserved: 'task IDs, photos, reviews, statuses, dashboards' }))
}

/** Add the already-approved stage presentation to one existing reveal event, in place.
 * No inbox/event/timestamp documents are created or changed.
 * @see ../docs/modules/reviews/subject-aware-guidance.md#data-contract */
async function repairReleasedGuidance() {
  const taskId = third
  const stageId = process.argv[5]
  const apply = process.argv.includes('--apply')
  const dryRun = process.argv.includes('--dry-run') || !apply
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || !/^[a-z0-9-]+$/.test(taskId ?? '')
    || !/^[a-z0-9-]+$/.test(stageId ?? '') || apply && process.argv.includes('--dry-run')) {
    fail('Укажите repair-guidance YYYY-MM-DD task-id stage-id [--dry-run|--apply].')
  }
  const source = json(resolve(local, `day-source-${date}.json`))
  validate(source, { allowUnchangedLegacyTeacherLinks: true })
  const target = findGuidanceTarget(source, taskId)
  if (!target) fail('В сохранённом источнике нет единственного родительского маршрута для выбранного задания или номера.')
  const { task, problem, guide } = target
  if (!Number.isInteger(guide.revision)) fail('У сохранённого маршрута отсутствует целая версия.')
  const pair = json(linksFile)[date]
  if (!pair?.student || !pair?.parent) fail('Нет двух опубликованных страниц выбранного дня.')
  const eventCollection = db.collection(`dayGuidance/${pair.student}/items`)
  const [ownerSnap, pageSnap, guideSnap, events] = await Promise.all([
    db.doc(`dayOwners/${pair.student}`).get(), db.doc(`dayPages/${pair.student}`).get(),
    db.doc(`dayTaskGuides/${pair.student}/items/${taskId}`).get(), (async () => {
      const found = []
      let page = await eventCollection.where('taskId', '==', taskId).limit(100).get()
      while (!page.empty) {
        found.push(...page.docs)
        if (page.size < 100) break
        page = await eventCollection.where('taskId', '==', taskId).limit(100).startAfter(page.docs.at(-1)).get()
      }
      return found
    })(),
  ])
  const owner = ownerSnap.data()
  const savedGuide = guideSnap.data()?.guide
  if (!ownerSnap.exists || !owner?.familyId || !owner?.childId || owner.targetDate !== source.targetDate
    || !pageSnap.exists || pageSnap.data()?.kind !== 'student' || pageSnap.data()?.targetDate !== source.targetDate
    || pageSnap.data()?.familyId !== owner.familyId || pageSnap.data()?.childId !== owner.childId
    || pageSnap.data()?.sourcePlanFingerprint && pageSnap.data().sourcePlanFingerprint !== sourcePlanFingerprint(source)
    || !guideSnap.exists || !isDeepStrictEqual(savedGuide, guide)) {
    fail('Владелец, опубликованная страница или сохранённый закрытый маршрут не совпали с локальным источником; ремонт остановлен.')
  }
  const publishedMatches = pageSnap.data().subjects?.flatMap((subject) => subject.tasks.flatMap((item) => {
    if (item.id !== task.id || item.meshText !== task.meshText) return []
    if (target.kind === 'task') return item.id === taskId ? [item] : []
    return (item.problems ?? []).filter((entry) => entry.id === taskId && entry.number === problem.number
      && entry.title === problem.title && entry.original?.text === problem.original?.text
      && entry.original?.attachmentRef === problem.original?.attachmentRef)
  })) ?? []
  if (publishedMatches.length !== 1) fail('Задание или номер на опубликованной ученической странице не совпало с источником.')
  const candidates = events.filter((snapshot) => {
    const event = snapshot.data()
    return event.taskId === taskId && event.stageId === stageId && event.level === 'reveal'
  })
  if (candidates.length !== 1) {
    console.log(JSON.stringify({ date, taskId, stageId, status: 'skipped', reason: candidates.length ? 'ambiguous-release' : 'no-existing-release', applied: false }))
    return
  }
  const eventSnap = candidates[0]
  const plan = planRevealGuidanceRepair({ event: eventSnap.data(), guide: savedGuide, taskId, stageId })
  if (plan.status !== 'repair') {
    console.log(JSON.stringify({ date, taskId, stageId, status: plan.status, reason: plan.reason ?? 'already-current', applied: false }))
    return
  }
  const summary = { date, taskId, stageId, status: 'ready', fields: ['revealContent'], applied: false }
  if (dryRun) { console.log(JSON.stringify(summary)); return }
  await db.runTransaction(async (transaction) => {
    const [currentOwner, currentPage, currentGuide, currentEvent] = await Promise.all([
      transaction.get(ownerSnap.ref), transaction.get(pageSnap.ref), transaction.get(guideSnap.ref), transaction.get(eventSnap.ref),
    ])
    if (![ownerSnap, pageSnap, guideSnap, eventSnap].every((prior, index) => {
      const current = [currentOwner, currentPage, currentGuide, currentEvent][index]
      return current.exists && current.updateTime?.isEqual(prior.updateTime)
    })) fail('Связь владельца, страницы, маршрута или выбранный выпуск изменились после предпросмотра.')
    const currentGuideValue = currentGuide.data()?.guide
    const currentPlan = planRevealGuidanceRepair({ event: currentEvent.data(), guide: currentGuideValue, taskId, stageId })
    if (!isDeepStrictEqual(currentGuideValue, guide) || currentPlan.status !== 'repair'
      || !isDeepStrictEqual(currentPlan.revealContent, plan.revealContent)) fail('Предусловия выбранного выпуска изменились; запись отменена.')
    transaction.update(eventSnap.ref, { revealContent: plan.revealContent })
  })
  const readback = (await eventSnap.ref.get()).data()
  if (!isDeepStrictEqual(readback?.revealContent, plan.revealContent)) fail('Обратное чтение показа этапа не совпало с ожидаемым содержимым.')
  console.log(JSON.stringify({ ...summary, status: 'repaired', applied: true }))
}

  if (!['refresh', 'build', 'validate', 'publish', 'publish-batch', 'guide-upgrade', 'repair-guidance', 'problem-support', 'dashboard', 'reconcile-grades', 'pull', 'seed-evidence', 'audit', 'repair-placements', 'repair-teacher-projections', 'repair-owner', 'family-assignment'].includes(command)) fail('Команды: refresh YYYY-MM-DD | build YYYY-MM-DD | validate YYYY-MM-DD | publish YYYY-MM-DD | publish-batch YYYY-MM-DD YYYY-MM-DD ... | audit [YYYY-MM-DD] | reconcile-grades [--apply] | repair-placements YYYY-MM-DD [--apply] | repair-teacher-projections YYYY-MM-DD [--apply] | repair-owner YYYY-MM-DD [--apply] | guide-upgrade YYYY-MM-DD[,YYYY-MM-DD] task-id [--dry-run] | repair-guidance YYYY-MM-DD task-id stage-id [--dry-run|--apply] | family-assignment REQUEST.json [--dry-run|--apply] | problem-support YYYY-MM-DD | dashboard | pull YYYY-MM-DD [папка] | seed-evidence YYYY-MM-DD')
if (command === 'build') {
  console.log(JSON.stringify(buildDaySource(local, date), null, 2))
  process.exit(0)
}
if (command === 'validate') {
  const source = json(resolve(local, `day-source-${date}.json`))
  const taskIds = validate(source)
  console.log(JSON.stringify({ date, targetDate: source.targetDate, tasks: taskIds.length, valid: true }))
  process.exit(0)
}
if (command === 'refresh') refresh()
prepareLogin()
initializeApp({ credential: applicationDefault(), projectId: 'education-9d7c6' })
const db = getFirestore()
if (command === 'publish' || command === 'refresh') await publish()
else if (command === 'publish-batch') await publishDates(process.argv.slice(3))
else if (command === 'dashboard') await publishDashboard()
else if (command === 'reconcile-grades') await reconcilePublishedGrades(date === '--apply')
else if (command === 'pull') await pull()
else if (command === 'problem-support') await publishProblemSupport()
else if (command === 'guide-upgrade') await publishGuideUpgrade()
else if (command === 'repair-guidance') await repairReleasedGuidance()
else if (command === 'audit') await auditPublishedDays()
else if (command === 'repair-placements') await repairPublishedPlacements()
else if (command === 'repair-teacher-projections') await repairTeacherProjections()
else if (command === 'repair-owner') await repairPublishedOwner()
else if (command === 'family-assignment') await publishFamilyAssignment()
else await seedEvidence()
if ((command === 'publish' || command === 'publish-batch' || command === 'refresh') && !scoped) {
  const owner = ownerContext()
  if (owner) {
    try { runLocal('scripts/family.mjs', ['attach-current-day', owner.familyId, owner.childId]) }
    catch { console.warn('Личный переход к текущему дню не обновлён; сама страница дня опубликована. Выпуск частичный.'); process.exitCode = 1 }
  }
}
if (command === 'refresh') {
  try { runLocal('scripts/storage.mjs', ['sync', date]) }
  catch { console.warn('Архив новых фото на Диске не завершён; фото остались в Education, повторите sync.') }
}
// @see ../docs/decisions/released-stage-parity-2026-10-20.md
