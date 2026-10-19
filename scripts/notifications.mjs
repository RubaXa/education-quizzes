import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getFirestore, Timestamp } from 'firebase-admin/firestore'
import { YandexDiskStorage } from '../storage/yandex-disk.mjs'
import { notificationId, stageFamilyNotice, taskContext } from '../storage/inbox-notifications.mjs'
import { loadReleaseNote } from './release-note.mjs'
import { stageSchoolAlerts } from '../diary/application/school-alerts.mjs'
import { assertGradeNoticeOwner, createGradeNotices, gradeNoticeBackfill } from '../day/grade-notice-backfill.mjs'
import { meshChildIdentityId } from '../packages/education-runtime/identity.mjs'

/** Publish meaningful, source-linked notices as Firestore data; image bytes live on Yandex Disk.
 * @see ../docs/modules/notifications/inbox.md#notification-producers
 */
const local = resolve('.local')
const adcFile = resolve(local, 'adc.json')
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  if (!existsSync(adcFile)) throw new Error('Нет локального входа Firebase.')
  process.env.GOOGLE_APPLICATION_CREDENTIALS = adcFile
}
initializeApp({ credential: applicationDefault(), projectId: 'education-9d7c6' })
const db = getFirestore()
const [command, first, second] = process.argv.slice(2)
const fail = (message) => { throw new Error(message) }

async function mediaOnDisk(path, releaseId) {
  if (!path) return undefined
  const filename = resolve(path)
  if (!existsSync(filename) || !/\.(png|jpe?g|webp)$/i.test(filename)) fail('Нужен существующий PNG/JPEG/WebP снимок интерфейса.')
  const bytes = readFileSync(filename)
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) fail('Снимок должен быть меньше 8 МиБ.')
  const tokenFile = resolve(local, 'yandex-disk-token')
  const token = process.env.YANDEX_DISK_TOKEN || (existsSync(tokenFile) ? readFileSync(tokenFile, 'utf8').trim() : '')
  if (!token) fail('Для снимков нужен токен Яндекс.Диска.')
  const storage = new YandexDiskStorage(token)
  const sha = createHash('sha256').update(bytes).digest('hex')
  const extension = filename.split('.').at(-1).toLowerCase().replace('jpeg', 'jpg')
  const diskPath = `app:/PETR/Уведомления/${releaseId}/${sha}.${extension}`
  await storage.putAt(diskPath, bytes)
  return { provider: 'yandex-disk', path: diskPath, publicUrl: await storage.publish(diskPath) }
}
async function publishRelease(filename) {
  const { input } = loadReleaseNote(filename)
  const media = {
    ...(input.before ? { before: await mediaOnDisk(input.before, input.releaseId) } : {}),
    ...(input.after ? { after: await mediaOnDisk(input.after, input.releaseId) } : {}),
  }
  const recipients = new Map()
  const families = await db.collection('families').get()
  for (const family of families.docs) {
    const members = await db.collection(`families/${family.id}/members`).get()
    for (const member of members.docs) {
      const value = member.data()
      if (value.active !== true || !value.childIds?.length || input.audience !== 'all' && value.role !== input.audience) continue
      if (!recipients.has(member.id)) recipients.set(member.id, { familyId: family.id, childId: value.childIds[0] })
    }
  }
  const id = notificationId(`product:${input.releaseId}`)
  let count = 0
  const entries = [...recipients]
  const publishedAt = Timestamp.now()
  for (let start = 0; start < entries.length; start += 200) {
    const part = entries.slice(start, start + 200)
    const refs = part.map(([personId]) => db.doc(`users/${personId}/inbox/${id}`))
    const existing = await db.getAll(...refs)
    const batch = db.batch()
    let pending = 0
    for (let index = 0; index < part.length; index++) {
      if (existing[index].exists) continue
      const owner = part[index][1]
      batch.create(refs[index], { ...owner, type: 'product_update', entityId: input.releaseId,
        title: input.title.trim(), body: input.body.trim(), changes: input.changes.map((line) => line.trim()),
        ...(Object.keys(media).length ? { media } : {}), sourceRevision: publishedAt.toMillis(), createdAt: publishedAt })
      count++
      pending++
    }
    if (pending) await batch.commit()
  }
  console.log(JSON.stringify({ releaseId: input.releaseId, recipients: count, mediaOnYandexDisk: Object.keys(media).length }))
}
async function backfillReview(sourceDate, taskId) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sourceDate ?? '') || !/^[a-z0-9-]+$/.test(taskId ?? '')) fail('Укажите дату источника YYYY-MM-DD и ID задания.')
  const owners = (await db.collection('dayOwners').get()).docs.filter((item) => item.data().date === sourceDate)
  const matches = []
  for (const owner of owners) {
    const page = (await db.doc(`dayPages/${owner.id}`).get()).data()
    const progress = (await db.doc(`dayProgress/${owner.id}/items/${taskId}`).get()).data()
    if (page?.kind === 'student' && progress?.checkedAt && page.taskIds?.includes(taskId)) matches.push({ owner, page, progress })
  }
  if (matches.length !== 1) fail('Нужен один опубликованный разбор задания.')
  const { owner, page, progress } = matches[0]
  const corrected = Boolean(progress.correctedAt)
  const version = corrected ? progress.correctedAt.toMillis() : progress.checkedAt.toMillis()
  const context = taskContext(page, taskId)
  const body = progress.workCoverage?.state === 'complete'
    ? 'Работа сдана. Критерий качества пока уточняется; новых действий не требуется.'
    : progress.status === 'verified' ? `${context.title}: результат подтверждён.`
      : progress.status === 'needs-fix' ? 'Разбор готов. Есть пункт для исправления; откройте карточку.'
        : progress.status === 'partial' ? 'Разбор готов. Часть работы подтверждена; откройте карточку.'
          : 'Разбор фото завершён. Откройте карточку, чтобы увидеть вывод.'
  const batch = db.batch()
  const count = await stageFamilyNotice(db, batch, { familyId: owner.data().familyId, childId: owner.data().childId,
    key: `backfill-review:${owner.id}:${taskId}:${version}`, mode: 'create',
    data: { type: corrected ? 'review_updated' : 'review_ready', entityId: taskId, taskId,
      date: page.targetDate, subject: context.subject, title: corrected ? 'Результат работы уточнён' : 'Работа проверена',
      body, sourceRevision: version } })
  await batch.commit()
  console.log(JSON.stringify({ taskId, recipients: count, type: corrected ? 'review_updated' : 'review_ready' }))
}

async function backfillParentDecisions() {
  const owners = await db.collection('dayOwners').get()
  let count = 0
  for (const owner of owners.docs) {
    const events = await db.collection(`dayParentDecisions/${owner.id}/events`).get()
    const latest = new Map()
    for (const event of events.docs) {
      const value = event.data()
      const key = `${value.taskId}:${value.reviewCheckedAt?.toMillis?.()}`
      const previous = latest.get(key)
      if (!previous || (value.decidedAt?.toMillis?.() ?? 0) > (previous.data().decidedAt?.toMillis?.() ?? 0)) latest.set(key, event)
    }
    for (const event of latest.values()) {
      const value = event.data()
      const progress = (await db.doc(`dayProgress/${owner.id}/items/${value.taskId}`).get()).data()
      if (!progress?.checkedAt || progress.checkedAt.toMillis() !== value.reviewCheckedAt?.toMillis?.()) continue
      const members = await db.collection(`families/${owner.data().familyId}/members`).get()
      const batch = db.batch()
      let pending = 0
      for (const member of members.docs) {
        if (member.data().active !== true || member.data().role !== 'student' || !member.data().childIds?.includes(owner.data().childId)) continue
        const ref = db.doc(`users/${member.id}/inbox/${event.id}`)
        if ((await ref.get()).exists) continue
        batch.create(ref, { familyId: owner.data().familyId, childId: owner.data().childId,
          type: value.action === 'accept' ? 'parent_accepted' : 'parent_reopened',
          entityId: value.taskId, taskId: value.taskId, studentToken: owner.id, eventId: event.id,
          date: owner.data().targetDate, sourceRevision: 1, createdAt: value.decidedAt })
        pending++
      }
      if (pending) { await batch.commit(); count += pending }
    }
  }
  console.log(JSON.stringify({ parentDecisionNotifications: count }))
}

async function publishSchoolAlerts() {
  const directory = resolve(local, 'diary')
  const snapshots = readdirSync(directory).filter((name) => /^snapshot-\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .map((name) => JSON.parse(readFileSync(resolve(directory, name), 'utf8')))
    .filter((snapshot) => snapshot.complete)
    .sort((a, b) => String(b.fetchedAt).localeCompare(String(a.fetchedAt)))
  if (!snapshots.length) fail('Нет полного снимка МЭШ для школьных сообщений.')
  const ownerFile = resolve(local, 'family-access.json')
  if (!existsSync(ownerFile)) fail('Нет подтверждённой семейной связи.')
  const owner = JSON.parse(readFileSync(ownerFile, 'utf8')).legacyDayOwner
  const batch = db.batch()
  const recipients = await stageSchoolAlerts(db, batch, snapshots[0], owner)
  if (recipients) await batch.commit()
  console.log(JSON.stringify({ sourceDate: snapshots[0].fetchedAt, recipients }))
}

/** @see ../docs/modules/notifications/inbox.md#notification-producers */
async function backfillGrades(beforePath, afterPath) {
  const sourceRoot = resolve(local, 'diary')
  for (const path of [beforePath, afterPath]) if (!resolve(path).startsWith(`${sourceRoot}/`)) fail('Нужны сохранённые журналы текущего локального ребёнка.')
  const before = JSON.parse(readFileSync(resolve(beforePath), 'utf8'))
  const after = JSON.parse(readFileSync(resolve(afterPath), 'utf8'))
  const ledger = JSON.parse(readFileSync(resolve('../learner/grade-snapshot.json'), 'utf8'))
  const owner = JSON.parse(readFileSync(resolve(local, 'family-access.json'), 'utf8')).legacyDayOwner
  if (!owner?.familyId || !owner?.childId) fail('Нет подтверждённой семейной связи.')
  const family = await db.doc(`families/${owner.familyId}`).get()
  const child = await db.doc(`families/${owner.familyId}/children/${owner.childId}`).get()
  const identityId = meshChildIdentityId(child.data()?.meshPersonId)
  if (!family.exists || !child.exists || !identityId) fail('Нет действующего владельца МЭШ.')
  const identity = await db.doc(`sourceIdentities/${identityId}`).get()
  assertGradeNoticeOwner(before, after, { ...owner, family: family.data(), child: child.data(),
    identity: identity.exists ? { ...identity.data(), id: identity.id } : null })
  const notices = gradeNoticeBackfill(before, after, ledger, owner.childId)
  const members = await db.collection(`families/${owner.familyId}/members`).get()
  const recipients = members.docs.filter((member) => member.data().active === true
    && ['parent', 'student'].includes(member.data().role) && member.data().childIds?.includes(owner.childId))
  if (notices.length && !recipients.length) fail('Нет подтверждённых адресатов.')
  const refs = notices.flatMap((notice) => recipients.map((member) => db.doc(`users/${member.id}/inbox/${notificationId(notice.key)}`)))
  const created = await createGradeNotices(db, owner, notices)
  const readback = refs.length ? await db.getAll(...refs) : []
  if (readback.some((doc) => !doc.exists || doc.data().familyId !== owner.familyId
    || doc.data().childId !== owner.childId || doc.data().type !== 'grade_added')) fail('Уведомления оценок не подтвердились.')
  console.log(JSON.stringify({ grades: notices.length, recipientDocuments: refs.length,
    created, verified: true }))
}

if (command === 'backfill-grades' && first && second) await backfillGrades(first, second)
else if (command === 'publish' && first && !second) await publishRelease(first)
else if (command === 'backfill-review' && first && second) await backfillReview(first, second)
else if (command === 'backfill-parent' && !first) await backfillParentDecisions()
else if (command === 'school-alerts' && !first) await publishSchoolAlerts()
else fail('Использование: notifications publish .local/release.json | backfill-review YYYY-MM-DD taskId | backfill-grades BEFORE.json AFTER.json | backfill-parent | school-alerts')
