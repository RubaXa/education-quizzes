/** @see ../docs/decisions/assignment-source-audit-corrections-2026-11-16.md */
/** @see ../docs/decisions/known-part-review-2026-11-09.md */
/** @see ../docs/decisions/moving-preparation-window-2026-11-05.md */
/** @see ../docs/decisions/review-coverage-revision-2026-11-09.md */
/** @see ../docs/decisions/personal-tutoring-2026-10-30.md */
/** @see ../docs/decisions/reviewed-photo-placement-2026-10-26.md */
/**
 * @see ../docs/product/homework-review.md
 * @see ../docs/modules/reviews/README.md
 * @see ../docs/decisions/readable-review-prose-2026-10-18.md
 * @see ../docs/decisions/math-parent-stage-review-2026-10-19.md
 */
/** @see ../docs/modules/materials/material-clarification.md */
import { sourceReviewErrors } from '../src/lib/materialRequest.ts'
import { reviewProseErrors } from '../src/lib/reviewProse.ts'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore'
import { resolveSubmission } from '../storage/submission-inbox.mjs'
import { reviewCoverage } from '../storage/review-coverage.mjs'
import { reviewPublicationPlacementPatch, relocateReviewedPhoto } from '../storage/photo-placement.mjs'
import { reviewChallengeErrors } from '../storage/review-challenge.mjs'
import { tutoringPlanErrors } from '../storage/tutoring-decision.mjs'
import { studentReviewProjection } from '../storage/review-projection.mjs'
import { validateRequirementChecks } from '../storage/review-requirements.mjs'
import {freezeCriteria,assertCriteriaCoverage,assignmentDigest,assignedCriteriaSources} from '../storage/criteria-contract.mjs'
import {learningObservation,prepareLearningWrites} from '../sync/learning-observations.mjs'
import {contextEvidenceErrors,appendContextEvidence} from '../storage/context-evidence.mjs'
/** @see ../docs/modules/reviews/criteria-and-knowledge.md */
import { assertReviewReadback, assertContextEvidenceReadback, sameReviewAssignmentAfterUpdate, reviewCorrectionStatusAllowed } from '../storage/review-readback.mjs'
import { YandexDiskStorage } from '../storage/yandex-disk.mjs'
import { notificationId, reviewAttemptKey, stageFamilyNotice, taskContext } from '../storage/inbox-notifications.mjs'
import { stageReviewPublishedEvents } from '../storage/review-publication-event.mjs'

/** Private agent inbox; file bytes stay on Yandex Disk or in ignored .local.
 * @see ../docs/modules/materials/storage-privacy.md#review-queue
 * @see ../docs/modules/reviews/adaptive-problem-card.md#слои
 * @see ../docs/modules/synchronization/change-detection-and-reconciliation.md
 */
const [command, argument, phase,output] = process.argv.slice(2)
const reviewCommand = ['review', 'validate', 'progress', 'feedback', 'relocate','criteria'].includes(command)
const dateFilter = reviewCommand || ['migrate-private-reviews', 'review-privacy-audit','criteria-export'].includes(command) ? null : argument
if (!['inbox', 'pull', 'review', 'validate', 'progress', 'relocate', 'help', 'feedback', 'feedback-audit', 'basis-audit', 'migrate-private-reviews', 'review-privacy-audit','criteria','criteria-export'].includes(command)
  || reviewCommand && !argument
  || command === 'progress' && !['download', 'source', 'review', 'publish', 'paused'].includes(phase)
  || command === 'migrate-private-reviews' && argument && argument !== '--dry-run'
  || command === 'review-privacy-audit' && argument
  || dateFilter && !/^\d{4}-\d{2}-\d{2}$/.test(dateFilter)) {
  throw new Error('Использование: npm run submissions -- inbox|pull|help|feedback-audit|basis-audit [YYYY-MM-DD] | progress .local/review-....json download|source|review|publish|paused | validate|review|feedback .local/review-....json | relocate .local/placement.json | migrate-private-reviews [--dry-run] | review-privacy-audit')
}
const local = resolve('.local')
const adcFile = resolve(local, 'adc.json')
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  if (!existsSync(adcFile)) throw new Error('Сначала войдите в Firebase CLI и создайте локальный ADC файл.')
  process.env.GOOGLE_APPLICATION_CREDENTIALS = adcFile
}
initializeApp({ credential: applicationDefault(), projectId: 'education-9d7c6' })
const db = getFirestore()

async function pendingInbox() {
  const owners = await db.collection('dayOwners').get()
  const rows = []
  for (const ownerDoc of owners.docs) {
    const owner = ownerDoc.data()
    if (dateFilter && owner.date !== dateFilter) continue
    const [pageDoc, childDoc, files] = await Promise.all([
      db.doc(`dayPages/${ownerDoc.id}`).get(),
      db.doc(`families/${owner.familyId}/children/${owner.childId}`).get(),
      db.collection(`dayUploads/${ownerDoc.id}/files`).get(),
    ])
    if (!childDoc.exists) throw new Error(`Профиль владельца дня ${owner.date} не найден.`)
    for (const file of files.docs) {
      const upload = file.data()
      if (upload.status !== 'pending') continue
      rows.push({
        context: resolveSubmission({ owner, page: pageDoc.data(), childName: childDoc.data().displayName,
          uploadId: file.id, upload }),
        upload,
      })
    }
  }
  rows.sort((a, b) => (a.context.uploadedAt ?? '').localeCompare(b.context.uploadedAt ?? ''))
  const progressByTask = new Map()
  for (const { context } of rows) {
    const key = `${context.dayDate}:${context.taskId}:${context.childId}`
    if (progressByTask.has(key)) continue
    const owner = owners.docs.find((item) => item.data().date === context.dayDate && item.data().childId === context.childId)
    if (!owner) continue
    progressByTask.set(key, db.doc(`dayProgress/${owner.id}/items/${context.taskId}`).get().then((snapshot) => {
      const progress = snapshot.data()?.processing
      return progress ? {
        phase: progress.phase,
        label: progress.label ?? null,
        reason: progress.reason ?? null,
        uploadIds: progress.uploadIds ?? [],
        updatedAt: progress.updatedAt?.toDate?.().toISOString() ?? null,
      } : null
    }))
  }
  await Promise.all(progressByTask.values())
  for (const { context } of rows) {
    context.processing = await progressByTask.get(`${context.dayDate}:${context.taskId}:${context.childId}`) ?? null
  }
  return rows
}

async function helpInbox() {
  const owners = await db.collection('dayOwners').get()
  const requests = []
  for (const ownerDoc of owners.docs) {
    const owner = ownerDoc.data()
    if (dateFilter && owner.date !== dateFilter) continue
    const [pageDoc, childDoc, helpDocs] = await Promise.all([
      db.doc(`dayPages/${ownerDoc.id}`).get(),
      db.doc(`families/${owner.familyId}/children/${owner.childId}`).get(),
      db.collection(`dayHelp/${ownerDoc.id}/items`).get(),
    ])
    const page = pageDoc.data()
    if (page?.kind !== 'student' || !helpDocs.size) continue
    const guidanceDocs = await db.collection(`dayGuidance/${ownerDoc.id}/items`).where('stageId', '==', 'help-response').get()
    for (const helpDoc of helpDocs.docs) {
      const help = helpDoc.data()
      const task = page.subjects?.flatMap((subject) => subject.tasks ?? []).find((entry) => entry.problems?.some((problem) => problem.id === helpDoc.id))
      const problem = task?.problems?.find((entry) => entry.id === helpDoc.id)
      requests.push({ childId: owner.childId, childName: childDoc.data()?.displayName ?? null,
        dayDate: owner.date, taskId: helpDoc.id, taskTitle: problem?.title ?? null,
        requestedAt: help.requestedAt?.toDate?.().toISOString() ?? null,
        requestKind: help.requestKind ?? null, requestText: help.requestText ?? '',
        requestedRevision: help.revision, currentSupportRevision: problem?.support?.revision ?? null,
        addressedResponses: guidanceDocs.docs.filter(doc => doc.data().taskId === helpDoc.id).map(doc => ({
          path: doc.ref.path, createdAt: doc.data().createdAt?.toDate?.().toISOString() ?? null,
          sourceRequestEventId: doc.data().sourceRequestEventId, sourceArtifactId: doc.data().sourceArtifactId,
          sourceStepId: doc.data().sourceStepId ?? null, text: doc.data().text,
        })) })
    }
  }
  requests.sort((a, b) => (b.requestedAt ?? '').localeCompare(a.requestedAt ?? ''))
  return requests
}

async function feedbackAudit() {
  const owners = await db.collection('dayOwners').get()
  const missing = []
  let checked = 0
  for (const ownerDoc of owners.docs) {
    const owner = ownerDoc.data()
    if (dateFilter && owner.date !== dateFilter) continue
    const page = (await db.doc(`dayPages/${ownerDoc.id}`).get()).data()
    if (page?.kind !== 'student') continue
    const progress = await db.collection(`dayProgress/${ownerDoc.id}/items`).get()
    for (const item of progress.docs) {
      if (!['needs-fix', 'partial'].includes(item.data().status)) continue
      checked += 1
      if (item.data().studentFeedback) continue
      missing.push({ childId: owner.childId, dayDate: owner.date, taskId: item.id,
        status: item.data().status, uploadIds: item.data().uploadIds ?? [] })
    }
  }
  return { checked, missing }
}

/** @see ../docs/modules/reviews/review-criteria-provenance.md */
async function basisAudit() {
  const owners = await db.collection('dayOwners').get()
  const missing = []
  for (const ownerDoc of owners.docs) {
    if (dateFilter && ownerDoc.data().date !== dateFilter) continue
    const page = (await db.doc(`dayPages/${ownerDoc.id}`).get()).data()
    if (page?.kind !== 'student') continue
    for (const item of (await db.collection(`dayProgress/${ownerDoc.id}/items`).get()).docs) {
      if (!item.data().status || item.data().assessmentBasis) continue
      missing.push({ childId: ownerDoc.data().childId, dayDate: ownerDoc.data().date,
        taskId: item.id, status: item.data().status })
    }
  }
  return missing
}

function privatePhoto(upload) {
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(upload.dataUrl ?? '')
  if (!match) throw new Error('Временные байты фото отсутствуют или повреждены.')
  const bytes = Buffer.from(match[2], 'base64')
  if (!bytes.length) throw new Error('Временное фото пусто.')
  return { bytes, extension: match[1] === 'jpeg' ? 'jpg' : match[1] }
}

function privateReviewFile(filename) {
  const path = resolve(filename)
  if (!path.startsWith(`${local}/`) || !path.endsWith('.json')) throw new Error('Файл разбора должен лежать в закрытой папке .local/.')
  const review = JSON.parse(readFileSync(path, 'utf8'))
  if (!/^\d{4}-\d{2}-\d{2}$/.test(review.date ?? '')
    || !Number.isInteger(review.planRevision) || !Array.isArray(review.uploadIds) || !review.uploadIds.length
    || new Set(review.uploadIds).size !== review.uploadIds.length
    || !review.uploadIds.every((id) => /^[A-Za-z0-9_-]{20,}$/.test(id))) {
    throw new Error('Нужны дата, ID задания, ревизия плана и уникальные ID фотографий.')
  }
  if (review.reviews) reviewCoverage(review)
  else if (!/^[a-z0-9-]+$/.test(review.taskId ?? '')) throw new Error('Нужен ID задания.')
  return review
}

function reviewTarget(page,taskId){
 const task=page.subjects?.flatMap(s=>s.tasks??[]).find(t=>t.id===taskId||t.problems?.some(p=>p.id===taskId))
 if(!task)throw Error('Задание отсутствует в текущей странице.')
 const problem=task.problems?.find(p=>p.id===taskId)
 return problem?{...task,id:problem.id,problems:[problem]}:task
}
function criteriaSourceRefs(page,taskId){
 return assignedCriteriaSources(page,taskId).sourceRefs
}
function criteriaSourceFingerprint(page,taskId){
 return assignedCriteriaSources(page,taskId).sourceFingerprint
}
function reviewObservation(owner,entry,contract,supersedes=null){
 const criteria=(contract?.criteria??[]).map(c=>({...c,finding:entry.criteriaChecks?.find(f=>f.id===c.id)})).filter(c=>c.finding)
 return learningObservation({owner:owner.data(),taskId:entry.taskId,attemptRef:`dayUploads/${owner.id}:${[...entry.uploadIds].sort().join(',')}`,sourceRevision:entry.criteriaFingerprint??entry.planRevision??null,
  criteria,outcome:entry.status??'source-received',scope:entry.purpose==='source-material'?'source-material':'assignment',helpLevel:entry.tutoringPlan?.state?.unsuccessfulHelp>0?'guided':'unknown',supersedes,correctionReason:entry.correctionReason??null})
}
async function assertCurrentSnapshots(transaction,snapshots){
 const current=await Promise.all(snapshots.map(s=>transaction.get(s.ref)))
 if(current.some((s,i)=>s.exists!==snapshots[i].exists||s.exists&&!s.updateTime.isEqual(snapshots[i].updateTime)))throw Error('Источник, критерии или прежний результат изменились перед записью; нужен свежий пакет.')
}
async function publishCriteria(filename){
 const path=resolve(filename)
 if(!path.startsWith(`${local}/`)||!path.endsWith('.json'))throw Error('Опись хранится в закрытом .local/.')
 const packet=JSON.parse(readFileSync(path,'utf8'))
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(packet.dayToken??'')||!packet.familyId||!packet.childId||!/^[a-z0-9-]+$/.test(packet.taskId??''))throw Error('Нужны точный владелец, день и задание.')
 const ref=db.doc(`dayTaskGuides/${packet.dayToken}/items/${packet.taskId}/criteriaContract/current`)
 const result=await db.runTransaction(async tx=>{
  const [owner,pageDoc,old]=await Promise.all([tx.get(db.doc(`dayOwners/${packet.dayToken}`)),tx.get(db.doc(`dayPages/${packet.dayToken}`)),tx.get(ref)])
  if(owner.data()?.familyId!==packet.familyId||owner.data()?.childId!==packet.childId||pageDoc.data()?.kind!=='student')throw Error('Опись принадлежит другому владельцу.')
  const page=pageDoc.data(),contract=freezeCriteria(packet.manifest,{task:reviewTarget(page,packet.taskId),planRevision:page.planRevision,sourceRefs:criteriaSourceRefs(page,packet.taskId),sourceFingerprint:criteriaSourceFingerprint(page,packet.taskId)})
  if(old.data()?.criteriaContract?.fingerprint===contract.fingerprint)return contract.fingerprint
  if((old.data()?.criteriaContract?.fingerprint??null)!==(packet.priorCriteriaFingerprint??null))throw Error('Опись критериев уже изменена: перечитайте свежий экспорт.')
  if(old.exists&&!packet.reason?.trim())throw Error('Изменение сохранённых критериев требует причины.')
  const history=db.doc(`${ref.path}/criteriaHistory/${contract.fingerprint}`),prior=await tx.get(history)
  if(!prior.exists)tx.create(history,{...contract,createdAt:Timestamp.now()})
  tx.set(ref,{...(old.data()??{}),criteriaContract:contract},{merge:true})
  return contract.fingerprint
 })
 if((await ref.get()).data()?.criteriaContract?.fingerprint!==result)throw Error('Опись не подтверждена readback.')
 console.log(JSON.stringify({published:true,verified:true,criteriaFingerprint:result}))
}
async function exportCriteria(dayToken,taskId,filename){
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(dayToken??'')||!/^[a-z0-9-]+$/.test(taskId??''))throw Error('Нужен точный день и ID задания.')
 const path=resolve(filename??'')
 if(!path.startsWith(`${local}/`)||!path.endsWith('.json'))throw Error('Экспорт критериев сохраняется только в .local/.')
 const [owner,pageDoc,current]=await db.getAll(db.doc(`dayOwners/${dayToken}`),db.doc(`dayPages/${dayToken}`),db.doc(`dayTaskGuides/${dayToken}/items/${taskId}/criteriaContract/current`))
 if(!owner.data()?.familyId||!owner.data()?.childId||pageDoc.data()?.kind!=='student')throw Error('Не найден владелец ученического дня.')
 const page=pageDoc.data(),task=reviewTarget(page,taskId),refs=criteriaSourceRefs(page,taskId),primary=task.familyOrigin?'family':'mesh'
 const prior=current.data()?.criteriaContract,compatible=prior?.assignmentDigest===assignmentDigest(task)&&prior?.materialFingerprint===criteriaSourceFingerprint(page,taskId)
 const manifest={...(compatible?prior:{}),taskId,planRevision:page.planRevision,assignmentDigest:assignmentDigest(task),materialFingerprint:criteriaSourceFingerprint(page,taskId),
  sources:compatible?prior.sources:[{ref:primary,text:task.familyOrigin?task.detail:task.meshText??task.detail,segments:[]},...refs.map(ref=>({ref,text:'',segments:[]}))],criteria:compatible?prior.criteria:[]}
 const parent=page.subjects.flatMap(s=>s.tasks).find(t=>t.id===taskId||t.problems?.some(p=>p.id===taskId))
 mkdirSync(resolve(path,'..'),{recursive:true,mode:0o700})
 writeFileSync(path,JSON.stringify({dayToken,taskId,familyId:owner.data().familyId,childId:owner.data().childId,priorCriteriaFingerprint:prior?.fingerprint??null,manifest,context:{task,materialLinks:page.materialLinks?.[parent?.id]??[],taskPageRefs:page.taskPageRefs?.[parent?.id]??[]}},null,2),{mode:0o600})
 console.log(JSON.stringify({exported:true,path,needsSourceReview:!compatible}))
}

async function linkedReviewPhotos(review, shared = false) {
  const owners = (await db.collection('dayOwners').where('date', '==', review.date).get()).docs
  const matches = []
  for (const owner of owners) {
    const refs = review.uploadIds.map((id) => db.doc(`dayUploads/${owner.id}/files/${id}`))
    const photos = await Promise.all(refs.map((ref) => ref.get()))
    if (photos.every((photo) => photo.exists)) matches.push({ owner, refs, photos })
  }
  if (matches.length !== 1) throw new Error('Не удалось однозначно связать разбор с ребёнком и набором фотографий.')
  const { owner, refs, photos } = matches[0]
  const pageDoc = await db.doc(`dayPages/${owner.id}`).get()
  const page=pageDoc.data()
  const targets = shared ? review.reviews.map((item) => item.taskId) : [review.taskId]
  if (page?.kind !== 'student' || page.planRevision !== review.planRevision || targets.some((id) => !page.taskIds?.includes(id))) {
    throw new Error('Задание изменилось после скачивания фото. Сначала сверяйте новый план.')
  }
  if (shared && targets.some((id) => page.subjects?.some((subject) => subject.tasks?.some((task) => task.id === id && task.problems?.length)))) {
    throw new Error('Лист с отдельными номерами разбирайте по ID каждого номера, а не по ID всего листа.')
  }
  if (photos.some((photo) => photo.data().status !== 'pending'
    || (shared ? !page.taskIds?.includes(photo.data().taskId) : photo.data().taskId !== review.taskId))) {
    throw new Error('Фото уже удалено, проверено или не относится к заданию.')
  }
  return { owner, refs, photos, page,pageDoc }
}

/** @see ../docs/modules/notifications/inbox.md#notification-producers */
async function stageReviewNotice(batch, owner, page, review, entries, type, now) {
  const familyId = owner.data().familyId
  const childId = owner.data().childId
  if (!familyId || !childId) return
  const context = taskContext(page, entries[0].taskId)
  const one = entries.length === 1
  const key = reviewAttemptKey(owner.id, review.uploadIds, entries.map((entry) => entry.taskId))
  const statuses = entries.map((entry) => entry.status)
  const body = entries[0].purpose === 'source-material' && type === 'review_ready' ? 'Материал прочитан. Тема и следующий шаг указаны в карточке; выполнение ДЗ отдельно не оценивалось.' : type === 'review_started' ? one ? `Начали разбирать ${context.title}. Повторно загружать фото не нужно.` : `Начали разбирать ${entries.length} заданий с загруженного фото.`
    : type === 'review_paused' ? 'Разбор приостановлен. Фото сохранено; повторно загружать его не нужно. Причина указана в карточке.'
    : type === 'review_updated' ? entries[0].workCoverage?.state === 'complete' ? 'Работа сдана. Критерий качества пока уточняется; новых действий не требуется.' : 'Вывод по работе уточнён. Откройте текущий разбор.'
      : statuses.every((status) => status === 'verified') ? one ? `${context.title}: всё подтверждено.` : `Проверено ${entries.length} заданий. Все подтверждены.`
        : statuses.some((status) => status === 'needs-fix') ? 'Разбор готов. Есть пункт для исправления; откройте карточку.'
          : statuses.some((status) => status === 'partial') ? 'Разбор готов. Часть работы подтверждена; откройте карточку.'
            : 'Разбор фото готов. Откройте карточку, чтобы увидеть вывод.'
  const correctionKey = type === 'review_updated'
    ? `${key}:correction:${notificationId(JSON.stringify([entries[0].status, entries[0].summary, entries[0].items, entries[0].workCoverage]))}` : key
  await stageFamilyNotice(db, batch, { familyId, childId, key: correctionKey,
    mode: type === 'review_started' ? 'start' : type === 'review_updated' ? 'create' : 'replace',
    data: { type, entityId: entries[0].taskId, taskId: one ? entries[0].taskId : null,
      date: page.targetDate, subject: context.subject, title: entries[0].purpose === 'source-material' && type === 'review_ready' ? 'Материал прочитан' : type === 'review_started' ? 'Начали проверку работы'
        : type === 'review_paused' ? 'Проверка задержана'
        : type === 'review_updated' ? 'Результат работы уточнён' : 'Работа проверена',
      body, sourceRevision: now.toMillis() } })
}

/** @see ../docs/modules/materials/storage-privacy.md#review-publication */
async function publishProgress(filename, phase) {
  const review = privateReviewFile(filename)
  if(review.purpose==='context-evidence')throw Error('Квитанция контекста использует только validate/review, без этапов учебной проверки.')
  const shared = Boolean(review.reviews)
  const { owner, refs: photoRefs, page } = await linkedReviewPhotos(review, shared)
  const labels = { download: 'Открываем фото для проверки', source: 'Сверяем с учебником', review: 'Разбираем ответы', publish: 'Сохраняем результат', paused: 'Фото получено · техническая задержка' }
  const entries = review.reviews ?? [review]
  const refs = entries.map((entry) => db.doc(`dayProgress/${owner.id}/items/${entry.taskId}`))
  const previous = await Promise.all(refs.map(async (ref) => (await ref.get()).data()?.processing))
  const now = Timestamp.now()
  const batch = db.batch()
  entries.forEach((entry, index) => {
    const old = previous[index]
    const samePhotos = old?.uploadIds?.length === entry.uploadIds.length && old.uploadIds.every((id) => entry.uploadIds.includes(id))
    batch.set(refs[index], { date: review.date, taskId: entry.taskId, planRevision: review.planRevision,
      processing: { phase, label: labels[phase], ...(phase === 'paused' ? { reason: review.pausedReason?.trim() || 'Причина остановки пока не указана. Фото получено; повторно загружать его не нужно.' } : {}), uploadIds: entry.uploadIds, startedAt: samePhotos ? old.startedAt : now, updatedAt: now } }, { merge: true })
  })
  if (shared) {
    const coverage = reviewCoverage(review)
    photoRefs.forEach((ref, index) => batch.update(ref, { processingTaskIds: coverage.get(review.uploadIds[index]).taskIds }))
  }
  if (['download', 'source', 'review'].includes(phase)) await stageReviewNotice(batch, owner, page, review, entries, 'review_started', now)
  if (phase === 'paused') await stageReviewNotice(batch, owner, page, review, entries, 'review_paused', now)
  await batch.commit()
  console.log(JSON.stringify({ phase, publishedToFirebase: true }))
}

/** @see ../docs/modules/reviews/review-criteria-provenance.md#second-pass */
function validateReviewResult(review, page, guide, { requireChallenge = false,criteriaContract } = {}) {
  if(review.purpose==='context-evidence'){
    const errors=[...contextEvidenceErrors(review),...reviewProseErrors({summary:review.evidence?.summary})]
    if(errors.length)throw Error(errors.join(' '))
    return
  }
  const proseErrors = reviewProseErrors(review)
  if (proseErrors.length) throw new Error(proseErrors.join('\n'))
  const sourceTask = page.subjects?.flatMap(subject => subject.tasks ?? []).find(task => task.id === review.taskId)
  const target=reviewTarget(page,review.taskId)
  const sourceErrors = sourceReviewErrors(review, sourceTask ?? {})
  if (sourceErrors.length) throw new Error(sourceErrors.join(' '))
  if (review.purpose === 'source-material') {
    if (![review.summary, review.nextStep, review.source].every(value => typeof value === 'string' && value.trim().length >= 8)) throw new Error('У разбора материала нужны итог, следующий шаг и источник.')
    return
  }
  assertCriteriaCoverage(review,criteriaContract,{task:target,planRevision:page.planRevision,sourceRefs:criteriaSourceRefs(page,review.taskId),sourceFingerprint:criteriaSourceFingerprint(page,review.taskId)})
  const statuses = new Set(['verified', 'needs-fix', 'partial', 'cannot-assess'])
  const itemStatuses = new Set(['correct', 'incorrect', 'partial', 'cannot-assess'])
  if (!statuses.has(review.status)
    || !review.summary?.trim() || !review.nextStep?.trim() || !review.source?.trim()
    || !Array.isArray(review.items) || !review.items.length
    || !review.items.every((item) => item.label?.trim() && item.observed?.trim() && item.note?.trim() && itemStatuses.has(item.status))) {
    throw new Error('Неполный или некорректный разбор. Нужны дата, ревизия плана, фото, итог, действие, источник и проверенные пункты.')
  }
  if (review.status === 'verified' && review.items.some((item) => item.status !== 'correct')) {
    throw new Error('Нельзя отметить всю работу проверенной при ошибке в подпункте.')
  }
  if (review.items.some((item) => Object.hasOwn(item, 'expected'))) {
    throw new Error('items.expected нельзя публиковать в ученический dayProgress; ключ храните в закрытом source-pack.')
  }
  if (review.checkableStageIds && (!Array.isArray(review.checkableStageIds) || review.checkableStageIds.length < 1
    || review.checkableStageIds.length > 30 || new Set(review.checkableStageIds).size !== review.checkableStageIds.length
    || !review.checkableStageIds.every((id) => typeof id === 'string' && /^[a-z0-9-]{2,64}$/.test(id))
    || !review.checkableStageIds.every((id) => review.items.some((item) => item.stageId === id))
    || review.items.some((item) => item.stageId && !review.checkableStageIds.includes(item.stageId)))) {
    throw new Error('Проверяемые этапы должны иметь устойчивые ID и сопоставленный пункт разбора.')
  }
  if (['learning-route', 'math-route'].includes(guide?.presentation)) {
    const stageIds = guide.stages.map((stage) => stage.id)
    if (!Array.isArray(review.checkableStageIds) || review.checkableStageIds.length !== stageIds.length
      || stageIds.some((id) => !review.checkableStageIds.includes(id)
        || !review.items.some((item) => item.stageId === id))) {
      throw new Error('Каждый этап опубликованного родительского маршрута должен иметь сопоставленный пункт разбора.')
    }
  }
  validateAssessmentBasis(review)
  validateRequirementChecks(review)
  validateWorkCoverage(review)
  if (!review.purpose) validateStudentFeedback(review)
  const subject = page.subjects?.find((entry) => entry.tasks?.some((task) => task.id === review.taskId || task.problems?.some((problem) => problem.id === review.taskId)))
  const task = subject?.tasks?.find((entry) => entry.id === review.taskId || entry.problems?.some((problem) => problem.id === review.taskId))
  const challengeErrors = reviewChallengeErrors(review, task, { required: requireChallenge })
  if (challengeErrors.length) throw new Error(challengeErrors.join(' '))
  if (subject && ['math', 'special'].includes(subject.id) && task?.kind === 'written') {
    const reasoning = review.mathReasoning
    const answerStates = new Set(['correct', 'incorrect', 'uncertain'])
    const argumentStates = new Set(['sufficient', 'incomplete', 'not-shown', 'unreadable', 'not-required'])
    if (!reasoning || !answerStates.has(reasoning.answer) || !argumentStates.has(reasoning.argument)
      || !reasoning.observed?.trim()
      || ['incomplete', 'not-shown'].includes(reasoning.argument) && !reasoning.minimumNeeded?.trim()
      || reasoning.argument === 'not-required' && !reasoning.criterionSource?.trim()) {
      throw new Error('Для математического номера отдельно укажите ответ, видимый ход и один недостающий переход.')
    }
    if (review.status === 'verified' && (reasoning.answer !== 'correct' || !['sufficient', 'not-required'].includes(reasoning.argument))) {
      throw new Error('Полная проверка математического номера требует верного ответа и достаточного хода.')
    }
    if (reasoning.answer === 'correct' && ['incomplete', 'not-shown'].includes(reasoning.argument) && review.status !== 'partial') {
      throw new Error('Верный ответ без достаточного хода отмечается отдельно как частичный результат, не как ошибка ответа.')
    }
  }
  return criteriaContract?.fingerprint
}

/** @see ../docs/modules/reviews/review-criteria-provenance.md#work-coverage */
function validateWorkCoverage(review) {
  if (!review.workCoverage) return
  const coverage = review.workCoverage
  if (review.status !== 'cannot-assess' || review.assessmentBasis?.outcome !== 'unresolved'
    || coverage.state !== 'complete'
    || typeof coverage.note !== 'string' || coverage.note.trim().length < 12 || coverage.note.length > 300
    || typeof coverage.sourceRef !== 'string'
    || !review.assessmentBasis.sources.some((source) => source.role === 'requirement' && source.ref === coverage.sourceRef)) {
    throw new Error('Полноту сданной работы можно отметить только по сверенному требованию при неясном критерии оценки.')
  }
}

/** @see ../docs/modules/reviews/review-criteria-provenance.md */
function validateAssessmentBasis(review) {
  const basis = review.assessmentBasis
  // dayProgress is readable by the learner; answer keys belong in the private source pack.
  // @see ../docs/modules/reviews/review-criteria-provenance.md
  const sourceKinds = new Set(['teacher', 'mesh', 'textbook', 'method-guide', 'curriculum'])
  if (!basis || !Number.isInteger(basis.grade) || basis.grade < 1 || basis.grade > 11
    || !/^20\d{2}\/\d{2}$/.test(basis.schoolYear)
    || !['requirement', 'observed', 'comparison'].every((key) => typeof basis[key] === 'string' && basis[key].trim().length >= 8)
    || !Array.isArray(basis.sources) || !basis.sources.length
    || !basis.sources.every((source) => sourceKinds.has(source.kind) && ['requirement', 'context'].includes(source.role)
      && source.ref?.trim() && source.excerpt?.trim() && source.excerpt.length <= 250)) {
    throw new Error('Для разбора нужен безопасный для ученика источник требования: класс, учебный год, наблюдение и сверенные ссылки. Официальный ключ оставьте в закрытом источник-пакете.')
  }
  const expectedOutcome = review.status === 'verified' ? 'met' : review.status === 'cannot-assess' ? 'unresolved' : 'not-met'
  if (basis.outcome !== expectedOutcome) throw new Error('Вердикт и вывод из критерия противоречат друг другу.')
  if (basis.outcome === 'not-met' && !basis.sources.some((source) => source.role === 'requirement' && ['teacher', 'mesh', 'textbook'].includes(source.kind))) {
    throw new Error('Отрицательный вердикт нельзя основывать только на общей программе или методическом совете.')
  }
  if (basis.outcome === 'unresolved' && !basis.limitation?.trim()) throw new Error('Если итог нельзя установить, объясните, каких именно данных или критериев не хватает.')
  if (basis.unresolvedReason && (basis.outcome !== 'unresolved'
    || !['missing-evidence', 'criterion-unclear'].includes(basis.unresolvedReason))) {
    throw new Error('Причина неустановленного результата должна отличать недостающую работу от неясного критерия.')
  }
  if (basis.disputedRequirements) {
    const disputes = basis.disputedRequirements
    if (basis.outcome !== 'unresolved' || !Array.isArray(disputes) || disputes.length < 1 || disputes.length > 10
      || !Array.isArray(basis.disputedRequirementIds)
      || JSON.stringify(basis.disputedRequirementIds) !== JSON.stringify(disputes.map((item) => item.id))
      || new Set(basis.disputedRequirementIds).size !== disputes.length
      || !disputes.every((item) => /^[a-z0-9-]{3,48}$/.test(item.id)
        && typeof item.action === 'string' && item.action.trim().length >= 12 && item.action.length <= 180
        && typeof item.meshExcerpt === 'string' && item.meshExcerpt.trim().length >= 4 && item.meshExcerpt.length <= 250
        && ['textbook', 'model-inference'].includes(item.sourceKind)
        && typeof item.sourceExcerpt === 'string' && item.sourceExcerpt.trim().length >= 4 && item.sourceExcerpt.length <= 250
        && typeof item.sourceRef === 'string' && item.sourceRef.trim().length >= 4
        && typeof item.uncertainty === 'string' && item.uncertainty.trim().length >= 12)) {
      throw new Error('Спорные семейные действия требуют стабильных ID, точного происхождения и явной неопределённости.')
    }
  }
}

/** @see ../docs/modules/reviews/adaptive-problem-card.md#адресный-разбор */
function validateStudentFeedback(review) {
  const tutoringErrors = tutoringPlanErrors(review)
  if (tutoringErrors.length) throw new Error(tutoringErrors.join('\n'))
  const feedback = review.studentFeedback
  if(['partial','needs-fix'].includes(review.status)&&!feedback?.presentation?.activity)throw new Error('Для текущего вопроса нужна проверенная наглядная модель presentation.activity, без ключа и автоматического зачёта.')
  if (!feedback || !['title', 'confirmed', 'focus', 'question'].every((key) => typeof feedback[key] === 'string' && feedback[key].trim().length >= 8 && feedback[key].length <= 700)
    || feedback.anchor && (!review.uploadIds?.includes(feedback.anchor.uploadId) || typeof feedback.anchor.location !== 'string' || !feedback.anchor.location.trim())) {
    throw new Error('Нужны проверенные ученические фразы: что получилось, точное место, один вопрос и короткий заголовок. Привязка к фото должна входить в текущий набор.')
  }
}

function resultRecord(review, previous, now, date, planRevision) {
  const context=previous?.contextEvidence?.length?{contextEvidence:previous.contextEvidence}:{}
  const priorReviews = previous?.status || previous?.purpose === 'source-material' ? [...(previous.history ?? []), Object.fromEntries(Object.entries(previous).filter(([key]) => key !== 'history' && key !== 'processing'))] : previous?.history ?? []
  if (review.purpose === 'source-material') return { date, taskId: review.taskId, planRevision, uploadIds: review.uploadIds, purpose: 'source-material', sourceAnalysis: review.sourceAnalysis, summary: review.summary, nextStep: review.nextStep, source: review.source, checkedAt: now, history: priorReviews.slice(-20),...context }
  const { taskId, uploadIds, status, summary, nextStep, source, items, checkableStageIds, requirementChecks, mathReasoning, studentFeedback, assessmentBasis, workCoverage, challengeReview, tutoringPlan, workScope } = review
  return { date, taskId, planRevision, uploadIds, status, summary, nextStep, source, items,...context,
    ...(review.criteriaFingerprint?{criteriaFingerprint:review.criteriaFingerprint,criteriaChecks:review.criteriaChecks}:{}),
    ...(review.learningObservationId?{learningObservationId:review.learningObservationId}:{}),
    ...(workScope ? { workScope } : {}),
    ...(checkableStageIds ? { checkableStageIds } : {}),
    ...(requirementChecks ? { requirementChecks } : {}),
    ...(mathReasoning ? { mathReasoning } : {}), ...(studentFeedback ? { studentFeedback } : {}),
    ...(tutoringPlan ? { tutoringPlan } : {}),
    ...(assessmentBasis ? { assessmentBasis } : {}), ...(challengeReview ? { challengeReview } : {}),
    ...(workCoverage ? { workCoverage: { ...workCoverage, reviewCheckedAt: now, recordedAt: now } } : {}),
    checkedAt: now, history: priorReviews.slice(-20) }
}

/** Correct a previously published explanation for the same reviewed photo without inventing a new learner attempt. */
async function publishFeedbackCorrection(filename) {
  const correction = privateReviewFile(filename)
  if(correction.purpose==='context-evidence')throw Error('Квитанция контекста не является коррекцией оценки; используйте validate/review с новым ожидающим снимком.')
  if (correction.reviews || !correction.correctionReason?.trim()) throw new Error('Исправление одного номера требует correctionReason.')
  if (!correction.purpose) validateStudentFeedback(correction)
  const owners = (await db.collection('dayOwners').where('date', '==', correction.date).get()).docs
  const matches = []
  for (const owner of owners) {
    const [pageDoc, progressDoc, privateDoc, ...photos] = await Promise.all([
      db.doc(`dayPages/${owner.id}`).get(), db.doc(`dayProgress/${owner.id}/items/${correction.taskId}`).get(),
      db.doc(`dayReviewPrivate/${owner.id}/items/${correction.taskId}`).get(),
      ...correction.uploadIds.map((id) => db.doc(`dayUploads/${owner.id}/files/${id}`).get()),
    ])
    if (pageDoc.data()?.kind === 'student' && progressDoc.exists && photos.every((photo) => photo.exists)) {
      matches.push({ owner, page: pageDoc.data(),pageDoc, progressDoc, privateDoc, photos })
    }
  }
  if (matches.length !== 1) throw new Error('Исправление не связано однозначно с одним ребёнком, заданием и набором фото.')
  const { owner, page,pageDoc, progressDoc, privateDoc, photos } = matches[0]
  const previous = privateDoc.data() ?? progressDoc.data()
  const currentTask = page.subjects?.flatMap(subject => subject.tasks ?? []).find(task => task.id === correction.taskId)
  const sameAssignmentAfterPageUpdate = sameReviewAssignmentAfterUpdate(page, correction, currentTask)
  const expectedPriorStatus = correction.previousStatus ?? correction.status
  if (page.planRevision !== correction.planRevision && !sameAssignmentAfterPageUpdate
    || previous.planRevision !== correction.planRevision
    || previous.status !== expectedPriorStatus || !Array.isArray(previous.uploadIds) || previous.uploadIds.length !== correction.uploadIds.length
    || !previous.uploadIds.every(id => correction.uploadIds.includes(id))
    || !page.taskIds?.includes(correction.taskId) || photos.some(photo => photo.data().status !== 'reviewed')) {
    throw new Error('После проверки изменились статус, ревизия, список фото или привязка задания; исправление остановлено.')
  }
  const [guideSnapshot,criteriaSnapshot]=await db.getAll(db.doc(`dayTaskGuides/${owner.id}/items/${correction.taskId}`),db.doc(`dayTaskGuides/${owner.id}/items/${correction.taskId}/criteriaContract/current`))
  const guideDoc={...guideSnapshot.data(),criteriaContract:criteriaSnapshot.data()?.criteriaContract}
  const criteriaReceipt=validateReviewResult(correction, page, guideDoc?.guide, { requireChallenge: previous.status !== 'verified',criteriaContract:guideDoc?.criteriaContract })
  if(!reviewCorrectionStatusAllowed(expectedPriorStatus,correction.status,{criteriaFingerprint:criteriaReceipt}))throw Error('Недопустимая коррекция без повторно проверенных критериев.')
  const now = Timestamp.now()
  const observation=reviewObservation(owner,correction,guideDoc?.criteriaContract,previous.learningObservationId)
  const knowledge=await prepareLearningWrites(db,[observation],now)
  const oldRecord = { at: now, reason: correction.correctionReason,
    priorStatus: previous.status, priorFeedbackTitle: previous.studentFeedback?.title ?? null }
  const corrected = { ...previous, status: correction.status, summary: correction.summary, nextStep: correction.nextStep,
    items: correction.items,learningObservationId:observation.id,
    ...(correction.criteriaFingerprint?{criteriaFingerprint:correction.criteriaFingerprint,criteriaChecks:correction.criteriaChecks}:{}),
    ...(correction.checkableStageIds ? { checkableStageIds: correction.checkableStageIds } : {}),
    ...(correction.requirementChecks ? { requirementChecks: correction.requirementChecks } : {}),
    ...(correction.mathReasoning ? { mathReasoning: correction.mathReasoning } : {}),
    studentFeedback: correction.studentFeedback ?? null,
    tutoringPlan: correction.tutoringPlan ?? previous.tutoringPlan ?? null,
    assessmentBasis: correction.assessmentBasis,
    challengeReview: correction.challengeReview ?? previous.challengeReview ?? null,
    workCoverage: correction.workCoverage
      ? { ...correction.workCoverage, reviewCheckedAt: previous.checkedAt, recordedAt: now }
      : null,
    correctedAt: now, feedbackCorrections: [...(previous.feedbackCorrections ?? []), oldRecord].slice(-10) }
  await db.runTransaction(async batch=>{
  await assertCurrentSnapshots(batch,[owner,pageDoc,progressDoc,privateDoc,guideSnapshot,criteriaSnapshot,...photos])
  knowledge.stage(batch)
  batch.set(privateDoc.ref, corrected)
  batch.set(progressDoc.ref, studentReviewProjection(corrected))
  await stageReviewPublishedEvents(db, batch, owner, [{ ...correction, correctionPublishedAt: now.toMillis() }])
  await stageReviewNotice(batch, owner, page, correction, [correction], 'review_updated', now)
  })
  await knowledge.verify()
  const readback = await db.getAll(privateDoc.ref, progressDoc.ref, ...photos.map(photo => photo.ref))
  const verified = assertReviewReadback({ entries: [correction], planRevision: previous.planRevision,
    privateDocs: [readback[0].data()], publicDocs: [readback[1].data()],
    uploads: readback.slice(2).map(photo => photo.data()) })
  console.log(JSON.stringify({ correctedTask: correction.taskId, childId: owner.data().childId,
    preservedAttemptCount: previous.history?.length ?? 0, correctedLiveFeedback: verified.verified }))
}

/** Shared, read-only validation for a proposed review and its exact source context.
 * @see ../docs/services/operator-cli/README.md#decision-packets */
async function preparedReview(filename) {
  const review = privateReviewFile(filename)
  const shared = Boolean(review.reviews)
  const coverage = shared ? reviewCoverage(review) : null
  const { owner, refs, photos, page,pageDoc } = await linkedReviewPhotos(review, shared)
  const entries = review.reviews ?? [review]
  if(entries.some(entry=>entry.purpose==='context-evidence')){
    if(shared)throw Error('Квитанция контекста публикуется отдельно от проверки работы.')
    validateReviewResult(review,page)
    if(photos.some(photo=>photo.data().storage?.state!=='stored'))throw Error('Фото ещё не перенесено на Диск.')
    return {review,coverage,owner,refs,photos,page,entries,guides:new Map(),fence:[owner,pageDoc,...photos]}
  }
  const routeEntries = entries
  const guideDocs = routeEntries.length
    ? await db.getAll(...routeEntries.map((entry) => db.doc(`dayTaskGuides/${owner.id}/items/${entry.taskId}`))) : []
  const guides = new Map(routeEntries.map((entry, index) => [entry.taskId, guideDocs[index].data()]))
  const criteriaDocs=await db.getAll(...entries.map(entry=>db.doc(`dayTaskGuides/${owner.id}/items/${entry.taskId}/criteriaContract/current`)))
  entries.forEach((entry,index)=>guides.set(entry.taskId,{...guides.get(entry.taskId),criteriaContract:criteriaDocs[index].data()?.criteriaContract}))
  entries.forEach((entry) => validateReviewResult(entry, page, guides.get(entry.taskId)?.guide,{criteriaContract:guides.get(entry.taskId)?.criteriaContract}))
  if (photos.some((photo) => photo.data().storage?.state !== 'stored')) throw new Error('Фото ещё не перенесено на Диск.')
  return { review, coverage, owner, refs, photos, page, entries,guides,fence:[owner,pageDoc,...photos,...guideDocs,...criteriaDocs] }
}

async function validateReviewFile(filename) {
  const { entries, refs } = await preparedReview(filename)
  console.log(JSON.stringify({ valid: true, taskIds: entries.map((entry) => entry.taskId), reviewedPhotos: refs.length,
    publishedToFirebase: false }))
}

/** @see ../docs/modules/materials/storage-privacy.md#multi-task-photo */
async function publishReview(filename) {
  const { review, coverage, owner, refs, photos, page, entries,guides,fence } = await preparedReview(filename)
  if(review.purpose==='context-evidence')return publishContextEvidence({review,owner,refs,fence})
  const reviewRefs = entries.map((entry) => db.doc(`dayProgress/${owner.id}/items/${entry.taskId}`))
  const privateRefs = entries.map((entry) => db.doc(`dayReviewPrivate/${owner.id}/items/${entry.taskId}`))
  const previousSnapshots=await db.getAll(...privateRefs,...reviewRefs)
  const previous=privateRefs.map((_,index)=>previousSnapshots[index].data()??previousSnapshots[index+privateRefs.length].data())
  const now = Timestamp.now()
  const observations=entries.map((entry,index)=>reviewObservation(owner,entry,guides.get(entry.taskId)?.criteriaContract,previous[index]?.learningObservationId))
  const knowledge=await prepareLearningWrites(db,observations,now)
  await db.runTransaction(async batch=>{
  await assertCurrentSnapshots(batch,[...fence,...previousSnapshots])
  knowledge.stage(batch)
  await stageReviewPublishedEvents(db, batch, owner, entries.map(entry=>({...entry,publicationCheckedAt:now.toMillis()})))
  entries.forEach((entry, index) => {
    const full = resultRecord({...entry,learningObservationId:observations[index].id}, previous[index], now, review.date, review.planRevision)
    batch.set(privateRefs[index], full)
    batch.set(reviewRefs[index], studentReviewProjection(full))
  })
  refs.forEach((ref, index) => {
    const id = review.uploadIds[index]
    const photo = photos[index].data()
    const proven = coverage?.get(id)
    const placement = proven?.taskIds.length === 1 && proven.taskIds[0] !== photo.taskId
      ? reviewPublicationPlacementPatch({ ...photo, coveredTaskIds: proven.taskIds }, {
        fromTaskId: photo.taskId, toTaskId: proven.taskIds[0], taskIds: page.taskIds,
        planRevision: review.planRevision, reason: proven.observed, now }) : null
    batch.update(ref, { status: 'reviewed', reviewedAt: now, processingTaskIds: FieldValue.delete(),
      ...(placement ?? {}),
      ...(coverage ? { coveredTaskIds: coverage.get(id).taskIds, coverageNote: coverage.get(id).observed } : {}) })
  })
  await stageReviewNotice(batch, owner, page, review, entries, 'review_ready', now)
  })
  await knowledge.verify()
  const readback = await db.getAll(...privateRefs, ...reviewRefs, ...refs)
  const verified = assertReviewReadback({ entries, planRevision: review.planRevision,
    privateDocs: readback.slice(0, entries.length).map((item) => item.data()),
    publicDocs: readback.slice(entries.length, entries.length * 2).map((item) => item.data()),
    uploads: readback.slice(entries.length * 2).map((item) => item.data()) })
  console.log(JSON.stringify({ reviewedPhotos: refs.length, taskStatuses: entries.map(({ taskId, status }) => ({ taskId, status })),
    publishedToFirebase: true, verified: verified.verified }))
}

/** No grading, knowledge writes, assignment mutation or review-publication event.
 * @see ../docs/modules/reviews/review-criteria-provenance.md#context-evidence */
async function publishContextEvidence({review,owner,refs,fence}){
 const privateRef=db.doc(`dayReviewPrivate/${owner.id}/items/${review.taskId}`)
 const publicRef=db.doc(`dayProgress/${owner.id}/items/${review.taskId}`)
 const snapshots=await db.getAll(privateRef,publicRef)
 const previous=snapshots[0].data()??snapshots[1].data()
 const now=Timestamp.now(),full=appendContextEvidence(previous,review,now)
 await db.runTransaction(async tx=>{
  await assertCurrentSnapshots(tx,[...fence,...snapshots])
  tx.set(privateRef,full)
  tx.set(publicRef,studentReviewProjection(full))
  refs.forEach(ref=>tx.update(ref,{status:'reviewed',reviewedAt:now,processingTaskIds:FieldValue.delete()}))
 })
 const readback=await db.getAll(privateRef,publicRef,...refs)
 const verified=assertContextEvidenceReadback({entry:review,previous,privateDoc:readback[0].data(),publicDoc:readback[1].data(),uploads:readback.slice(2).map(s=>({id:s.id,...s.data()}))})
 console.log(JSON.stringify({purpose:review.purpose,taskId:review.taskId,reviewedPhotos:refs.length,publishedToFirebase:true,verified:verified.verified,learningObservationCreated:false,assignmentAssessed:false}))
}

/** Moves legacy expert prose out of learner-readable documents without losing history. */
async function migratePrivateReviews(dryRun, auditOnly = false) {
  const owners = await db.collection('dayOwners').get()
  let examined = 0
  let migrated = 0
  let missingPrivate = 0
  let unsafePublic = 0
  for (const owner of owners.docs) {
    const page = await db.doc(`dayPages/${owner.id}`).get()
    if (page.data()?.kind !== 'student') continue
    const reviews = await db.collection(`dayProgress/${owner.id}/items`).get()
    for (const publicDoc of reviews.docs) {
      const current = publicDoc.data()
      if (!current.status) continue
      examined += 1
      const privateRef = db.doc(`dayReviewPrivate/${owner.id}/items/${publicDoc.id}`)
      const stored = await privateRef.get()
      const full = stored.data() ?? current
      const projected = studentReviewProjection(full)
      const publicProjection = { ...projected, ...(current.processing ? { processing: current.processing } : {}) }
      const publicMatches = isDeepStrictEqual(current, publicProjection)
      if (!stored.exists) missingPrivate += 1
      if (!publicMatches) unsafePublic += 1
      if (publicMatches && stored.exists) continue
      migrated += 1
      if (dryRun || auditOnly) continue
      const batch = db.batch()
      if (!stored.exists) batch.set(privateRef, full)
      batch.set(publicDoc.ref, publicProjection)
      await batch.commit()
    }
  }
  console.log(JSON.stringify({ examined, migrated, missingPrivate, unsafePublic, dryRun, auditOnly }))
  if (auditOnly && (missingPrivate || unsafePublic)) process.exitCode = 1
}

if (command === 'criteria-export') {
  await exportCriteria(argument,phase,output)
} else if (command === 'criteria') {
  await publishCriteria(argument)
} else if (command === 'relocate') {
  const filename = resolve(argument)
  if (!filename.startsWith(`${local}/`) || !filename.endsWith('.json')) throw new Error('Нужен закрытый JSON запроса переноса.')
  console.log(JSON.stringify(await relocateReviewedPhoto(db, JSON.parse(readFileSync(filename, 'utf8')), Timestamp.now())))
} else if (command === 'validate') {
  await validateReviewFile(argument)
} else if (command === 'review') {
  await publishReview(argument)
} else if (command === 'feedback') {
  await publishFeedbackCorrection(argument)
} else if (command === 'progress') {
  await publishProgress(argument, phase)
} else if (command === 'inbox') {
  const rows = await pendingInbox()
  console.log(JSON.stringify({ pending: rows.length, works: rows.map(({ context }) => context) }, null, 2))
} else if (command === 'help') {
  const requests = await helpInbox()
  console.log(JSON.stringify({ captured: requests.length, requests }, null, 2))
} else if (command === 'feedback-audit') {
  const audit = await feedbackAudit()
  console.log(JSON.stringify({ reviewedWithOpenFix: audit.checked, missingAddressedFeedback: audit.missing.length, works: audit.missing }, null, 2))
} else if (command === 'basis-audit') {
  const missing = await basisAudit()
  console.log(JSON.stringify({ missingAssessmentBasis: missing.length, works: missing }, null, 2))
} else if (command === 'migrate-private-reviews') {
  await migratePrivateReviews(argument === '--dry-run')
} else if (command === 'review-privacy-audit') {
  await migratePrivateReviews(true, true)
} else {
  const rows = await pendingInbox()
  const output = resolve(local, 'submission-inbox')
  mkdirSync(output, { recursive: true, mode: 0o700 })
  const tokenFile = resolve(local, 'yandex-disk-token')
  const diskToken = process.env.YANDEX_DISK_TOKEN || (existsSync(tokenFile) ? readFileSync(tokenFile, 'utf8').trim() : '')
  const storage = diskToken ? new YandexDiskStorage(diskToken) : null
  const manifest = []
  for (const { context, upload } of rows) {
    if (context.fileState === 'missing-file') throw new Error(`У ожидающего фото ${context.uploadId} нет файла.`)
    if (context.fileState === 'on-disk' && !storage) throw new Error('Для скачивания работ подключите Яндекс.Диск.')
    const photo = context.fileState === 'on-disk'
      ? { bytes: await storage.getAt(context.diskPath), extension: context.diskPath.split('.').at(-1) }
      : privatePhoto(upload)
    if (upload.storage?.sha256 && createHash('sha256').update(photo.bytes).digest('hex') !== upload.storage.sha256) {
      throw new Error(`Контрольная сумма фото ${context.uploadId} не совпала.`)
    }
    const file = `${context.dayDate}-${context.uploadId}.${photo.extension}`
    writeFileSync(resolve(output, file), photo.bytes, { mode: 0o600 })
    manifest.push({ ...context, file })
  }
  writeFileSync(resolve(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
  console.log(JSON.stringify({ directory: output, pending: manifest.length,
    needsManualLink: manifest.filter((item) => item.resolution !== 'linked').length }, null, 2))
}
