import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { initializeApp as clientApp, deleteApp as deleteClientApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, signInAnonymously } from 'firebase/auth'
import { connectFirestoreEmulator, getDoc, setDoc, updateDoc, doc, getFirestore, serverTimestamp, writeBatch } from 'firebase/firestore'
import { initializeApp as adminApp, deleteApp as deleteAdminApp } from 'firebase-admin/app'
import { getFirestore as adminDb } from 'firebase-admin/firestore'
import { createEducationEvent } from '../packages/education-events/envelope.mjs'
import { prepareEventTaskArtifact } from '../sync/event-task-artifact.mjs'
import { syncJobId } from '../sync/job-queue.mjs'
import { publishHelpResponse } from '../sync/help-response.mjs'
import { familyAssignmentErrors, learnerOriginErrors, mergeFamilyAssignments } from '../day/family-assignment.mjs'
import { linkOlympiadSource } from '../day/olympiad-source-link.mjs'

const enabled = Boolean(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST && /^demo-/.test(process.env.GCLOUD_PROJECT || ''))
describe.skipIf(!enabled)('shared photo help rules emulator', () => {
  let client, admin, db, store, uid
  const family = `help${Date.now()}`, day = `day${Date.now()}`, token = 'z'.repeat(43), photo = 'upload-request-1234567890'
  beforeAll(async () => {
    client = clientApp({ apiKey: 'fake', projectId: process.env.GCLOUD_PROJECT }, family)
    admin = adminApp({ projectId: process.env.GCLOUD_PROJECT }, family)
    const auth = getAuth(client)
    connectAuthEmulator(auth, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}`, { disableWarnings: true })
    db = getFirestore(client)
    const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':'); connectFirestoreEmulator(db, host, Number(port))
    store = adminDb(admin); uid = (await signInAnonymously(auth)).user.uid
    const entries = {
      [`deviceSessions/${uid}`]: { linkToken: token }, [`accessLinks/${token}`]: { active: true, personId: 'p' },
      [`families/${family}`]: { active: true }, [`families/${family}/children/c`]: { active: true },
      [`families/${family}/members/p`]: { active: true, role: 'student', childIds: ['c'] },
      [`dayOwners/${day}`]: { familyId: family, childId: 'c', date: '2026-10-28' },
      [`dayPages/${day}`]: { kind: 'student', date: '2026-10-28', planRevision: 1, taskIds: ['task', 'source-sheet'], subjects: [{ name: 'Математика', tasks: [{ id: 'task', title: 'Практика' }, { id: 'source-sheet', title: 'Свои задачи', optional: true, learningContext: { kind: 'olympiad', id: 'olymp' }, sourceIntake: { kind: 'olympiad-sheet' } }] }] },
      [`dayUploads/${day}/files/${photo}`]: { taskId: 'task', status: 'pending', storage: { state: 'stored', path: 'private', sha256: 'a'.repeat(64) } },
    }
    await Promise.all(Object.entries(entries).map(([path, value]) => store.doc(path).set(value)))
  })
  afterAll(async () => { if (client) await deleteClientApp(client); if (admin) await deleteAdminApp(admin) })
  it('accepts a learner source photo and routes the confirmed upload as an olympiad sheet', async () => {
    const fileId = 'source-upload-12345678901', operationId = `upload-transfer:${fileId}:requested`
    const sourcePath = `dayUploads/${day}/files/${fileId}`
    const sourceRef = { kind: 'upload', documentPath: sourcePath, dayToken: day, recordId: fileId, taskId: 'source-sheet' }
    const event = await createEducationEvent({ eventType: 'upload.transfer_requested', familyId: family, childId: 'c', source: 'firestore', sourceRef, operationId, actor: { type: 'user', uid } }, serverTimestamp())
    const batch = writeBatch(db)
    batch.set(doc(db, sourcePath), { taskId: 'source-sheet', planRevision: 1, deviceUid: uid, contentType: 'image/jpeg', size: 100, sha256: 'a'.repeat(64), status: 'requested', createdAt: serverTimestamp(), eventOperationId: operationId, eventReceiptId: event.eventId, eventProducerVersion: 1 })
    batch.set(doc(db, `educationEvents/${event.eventId}`), event)
    await batch.commit()
    expect((await getDoc(doc(db, sourcePath))).data().taskId).toBe('source-sheet')
    await store.doc(sourcePath).update({ status: 'pending', storage: { state: 'stored', path: 'private', sha256: 'a'.repeat(64) } })
    const confirmed = await createEducationEvent({ eventType: 'upload.confirmed', familyId: family, childId: 'c', source: 'firestore', sourceRef, operationId: `upload-confirmed:${fileId}`, actor: { type: 'user', uid } }, serverTimestamp())
    const prepared = await prepareEventTaskArtifact(store, confirmed)
    const artifact = (await store.doc(prepared.artifactPath).get()).data()
    expect(artifact.inputs.route.next).toBe('ingest-olympiad-sheet')
    expect(artifact.instruction).toContain('не решение ученика')
    // A deterministic operator fixture stands in for visual transcription and mathematical review.
    const task = { id: 'learner-task', sourceSystem: 'family', sourceId: 'learner-task', sourceRevision: 1, dayProjectionVersion: 1, familyId: family, childId: 'c', subjectId: 'math', subjectName: 'Математика', dueDate: '2026-10-28', title: 'Пример задачи', originalText: 'Условие из учебного листа.', steps: ['Реши задачу'], submission: { buttonLabel: 'Загрузить решение', lead: 'Запиши решение.', photo: 'Страница с решением.' }, publication: 'active', evidence: 'photo', materialIds: [], optional: true, testPlacements: [], learningContext: { kind: 'olympiad', id: 'olymp' }, learnerOrigin: { intakeTaskId: 'source-sheet', uploadIds: [fileId] } }
    const intake = { familyId: family, childId: 'c', learningContext: task.learningContext, sourceIntake: { kind: 'olympiad-sheet' }, projectionSourceDate: '2026-10-28' }
    const photoData = (await store.doc(sourcePath).get()).data()
    expect(familyAssignmentErrors(task, { familyId: family, childId: 'c', taskId: task.id })).toEqual([])
    expect(learnerOriginErrors(task, intake, [{ id: fileId, ...photoData }], '2026-10-28')).toEqual([])
    expect(learnerOriginErrors(task, { ...intake, childId: 'other' }, [{ id: fileId, ...photoData }], '2026-10-28')).not.toEqual([])
    const studentPage = mergeFamilyAssignments({ kind: 'student', date: '2026-10-28', targetDate: '2026-10-28', planRevision: 1, subjects: [] }, [task])
    const parentPage = mergeFamilyAssignments({ kind: 'parent', date: '2026-10-28', targetDate: '2026-10-28', planRevision: 1, subjects: [] }, [task])
    expect(studentPage.subjects[0].tasks[0].learnerOrigin).toEqual(parentPage.subjects[0].tasks[0].learnerOrigin)
    await store.doc(`families/${family}/children/c/tasks/${task.id}`).set(task)
    expect((await getDoc(doc(db, `families/${family}/children/c/tasks/${task.id}`))).data().learnerOrigin.uploadIds).toEqual([fileId])
  })

  it('links a verified duplicate to both role pages without replacing task progress and is idempotent', async () => {
    const priorPage = (await store.doc(`dayPages/${day}`).get()).data()
    const fileId = 'source-upload-duplicate-01', parentToken = 'parent-token', sourcePath = `dayUploads/${day}/files/${fileId}`
    const intake = { id: 'source-sheet', familyId: family, childId: 'c', dueDate: '2026-10-28', projectionSourceDate: '2026-10-28', learningContext: { kind: 'olympiad', id: 'olymp' }, sourceIntake: { kind: 'olympiad-sheet' } }
    const task = { id: 'existing-olympiad-task', sourceSystem: 'family', sourceId: 'existing-olympiad-task', sourceRevision: 1, dayProjectionVersion: 1, familyId: family, childId: 'c', subjectId: 'math', subjectName: 'Математика', dueDate: intake.dueDate, projectionSourceDate: intake.projectionSourceDate, title: 'Задача', originalText: 'Найдите сумму чисел.', steps: ['Реши задачу'], submission: { buttonLabel: 'Загрузить решение', lead: 'Запиши решение.', photo: 'Страница решения.' }, publication: 'active', evidence: 'photo', materialIds: [], optional: true, learningContext: intake.learningContext }
    const page = { kind: 'student', date: intake.projectionSourceDate, targetDate: intake.dueDate, familyId: family, childId: 'c', planRevision: 1, subjects: [{ id: 'math', name: 'Математика', tasks: [{ id: 'source-sheet', title: 'Свои задачи', optional: true, learningContext: intake.learningContext, sourceIntake: intake.sourceIntake }] }] }
    const studentPage = mergeFamilyAssignments(page, [task]); studentPage.subjects[0].tasks.find(t => t.id === task.id).status = 'verified'
    const parentPage = { ...structuredClone(studentPage), kind: 'parent' }
    await Promise.all([
      store.doc(`families/${family}/children/c/tasks/source-sheet`).set(intake),
      store.doc(`families/${family}/children/c/tasks/${task.id}`).set(task),
      store.doc(`dayPages/${day}`).set(studentPage), store.doc(`dayPages/${parentToken}`).set(parentPage),
      store.doc(sourcePath).set({ taskId: intake.id, status: 'pending', storage: { state: 'stored', path: 'private', sha256: 'c'.repeat(64) } }),
    ])
    const sourceRef = { kind: 'upload', documentPath: sourcePath, dayToken: day, recordId: fileId, taskId: intake.id }
    const event = await createEducationEvent({ eventType: 'upload.confirmed', familyId: family, childId: 'c', source: 'firestore', sourceRef, operationId: `upload-confirmed:${fileId}`, actor: { type: 'user', uid } }, new Date())
    await store.doc(`educationEvents/${event.eventId}`).set(event)
    const artifact = await prepareEventTaskArtifact(store, event)
    const request = { eventId: event.eventId, artifactId: artifact.artifactId, taskId: task.id, condition: task.originalText, figuresVerified: true }
    const context = { familyId: family, childId: 'c', studentToken: day, parentToken, sourceDate: intake.projectionSourceDate }
    await expect(linkOlympiadSource(store, { ...request, condition: 'Другое условие' }, context)).rejects.toThrow('source_link_evidence_mismatch')
    expect(await linkOlympiadSource(store, request, context)).toMatchObject({ verified: true, unchanged: false })
    expect(await linkOlympiadSource(store, request, context)).toMatchObject({ verified: true, unchanged: true })
    for (const token of [day, parentToken]) {
      const saved = (await store.doc(`dayPages/${token}`).get()).data().subjects[0].tasks.find(t => t.id === task.id)
      expect(saved.status).toBe('verified')
      expect(saved.learnerSources).toEqual([{ intakeTaskId: intake.id, uploadIds: [fileId] }])
    }
    expect((await store.doc(sourcePath).get()).data().status).toBe('pending')
    await expect(linkOlympiadSource(store, request, { ...context, childId: 'other' })).rejects.toThrow()
    await store.doc(`dayPages/${day}`).set(priorPage)
  })

  it('atomically saves an immutable photo request and rejects changes', async () => {
    const operationId = randomUUID(), sourcePath = `dayHelp/${day}/items/task`
    const event = await createEducationEvent({ eventType: 'help.requested', familyId: family, childId: 'c', source: 'firestore',
      sourceRef: { kind: 'help', documentPath: sourcePath, dayToken: day, taskId: 'task' }, operationId, actor: { type: 'user', uid } }, serverTimestamp())
    const request = { taskId: 'task', revision: 1, requestKind: 'step', requestText: '', photoUploadIds: [photo], planRevision: 1, requestedAt: serverTimestamp(),
      eventOperationId: operationId, eventReceiptId: event.eventId, eventProducerVersion: 1 }
    const history = doc(db, `${sourcePath}/requests/${event.eventId}`), batch = writeBatch(db)
    batch.set(doc(db, sourcePath), request); batch.set(history, request); batch.set(doc(db, `educationEvents/${event.eventId}`), event)
    await batch.commit()
    expect((await getDoc(history)).data().photoUploadIds).toEqual([photo])
    // The same receipt may not be reused to mutate the current projection.
    await expect(updateDoc(doc(db, sourcePath), { requestText: 'forged', requestedAt: serverTimestamp() })).rejects.toMatchObject({ code: 'permission-denied' })
    const nextId = randomUUID()
    const nextEvent = await createEducationEvent({ eventType: 'help.requested', familyId: family, childId: 'c', source: 'firestore',
      sourceRef: { kind: 'help', documentPath: sourcePath, dayToken: day, taskId: 'task' }, operationId: nextId, actor: { type: 'user', uid } }, serverTimestamp())
    const next = { ...request, requestedAt: serverTimestamp(), requestText: 'дополнение', eventOperationId: nextId, eventReceiptId: nextEvent.eventId }
    const incomplete = writeBatch(db); incomplete.set(doc(db, sourcePath), next); incomplete.set(doc(db, `educationEvents/${nextEvent.eventId}`), nextEvent)
    await expect(incomplete.commit()).rejects.toMatchObject({ code: 'permission-denied' })
    const complete = writeBatch(db); complete.set(doc(db, sourcePath), next); complete.set(doc(db, `${sourcePath}/requests/${nextEvent.eventId}`), next); complete.set(doc(db, `educationEvents/${nextEvent.eventId}`), nextEvent)
    await complete.commit()
    expect((await getDoc(history)).data().requestText).toBe('')
    expect((await getDoc(doc(db, sourcePath))).data().requestText).toBe('дополнение')
    const savedEvent = (await store.doc(`educationEvents/${event.eventId}`).get()).data()
    const artifact = await prepareEventTaskArtifact(store, savedEvent)
    await store.doc(`operatorSyncJobs/${syncJobId('triage-help', family, 'c', event.eventId)}`).set({ kind: 'triage-help', familyId: family, childId: 'c', eventId: event.eventId, sourceId: event.eventId, status: 'queued', artifactPath: artifact.artifactPath, fingerprint: artifact.fingerprint })
    const publication = await publishHelpResponse(store, { eventId: event.eventId, artifactId: artifact.artifactId, text: 'Проверь сумму.' })
    expect(publication.verified).toBe(true)
    const answer = doc(db, `dayGuidance/${day}/items/help-${event.eventId}`)
    expect((await getDoc(answer)).data().sourceRequestEventId).toBe(event.eventId)
    await expect(updateDoc(answer, { text: 'Подмена' })).rejects.toMatchObject({ code: 'permission-denied' })
    expect((await getDoc(doc(db, sourcePath))).data().eventReceiptId).toBe(nextEvent.eventId)

    await expect(updateDoc(history, { requestText: 'changed' })).rejects.toMatchObject({ code: 'permission-denied' })
    await expect(setDoc(doc(db, `${sourcePath}/requests/${'b'.repeat(64)}`), { ...request, eventReceiptId: 'b'.repeat(64) })).rejects.toMatchObject({ code: 'permission-denied' })
  })
  it('routes an answer/stuck without photos, returns a checked next step and protects every boundary', async()=>{
    const activity={kind:'write',label:'Твоя связь',instruction:'Запиши вывод.',tokens:[{id:'own',text:'Вывод'}],frame:[{slotId:'own'}]}
    const checkedAt=new Date('2026-11-01T12:00:00Z')
    const review={taskId:'task',status:'partial',checkedAt,studentFeedback:{title:'Проверь связь',confirmed:'Первая связь есть.',focus:'Нужно отрицание.',question:'Что верно о сумме?',presentation:{version:1,activity}}}
    await store.doc(`dayProgress/${day}/items/task`).set(review)
    const send=async(reply,change={})=>{
      const operationId=randomUUID(),sourcePath=`dayHelp/${day}/items/task`
      const event=await createEducationEvent({eventType:'help.requested',familyId:family,childId:'c',source:'firestore',sourceRef:{kind:'help',documentPath:sourcePath,dayToken:day,taskId:'task'},operationId,actor:{type:'user',uid}},serverTimestamp())
      const request={taskId:'task',revision:1,requestKind:reply.intent==='stuck'?'step':'check',requestText:'',planRevision:1,reviewReply:reply,requestedAt:serverTimestamp(),eventOperationId:operationId,eventReceiptId:event.eventId,eventProducerVersion:1,...change}
      const batch=writeBatch(db);batch.set(doc(db,sourcePath),request);batch.set(doc(db,`${sourcePath}/requests/${event.eventId}`),request);batch.set(doc(db,`educationEvents/${event.eventId}`),event)
      await batch.commit();return event.eventId
    }
    const reply={version:1,sourceId:'review',checkedAt,correctedAt:null,step:{question:review.studentFeedback.question,activity},intent:'answer',value:JSON.stringify({selected:[],groups:{},written:{own:'Мой вывод'}})}
    for(const forged of [{...reply,step:{...reply.step,question:'Подмена'}},{...reply,checkedAt:new Date('2020-01-01')},{...reply,sourceId:`help-${'f'.repeat(64)}`}]) await expect(send(forged)).rejects.toMatchObject({code:'permission-denied'})
    const eventId=await send(reply)
    const event=(await store.doc(`educationEvents/${eventId}`).get()).data()
    const artifact=await prepareEventTaskArtifact(store,event)
    expect((await store.doc(artifact.artifactPath).get()).data().inputs.source.reviewReply.value).toBe(reply.value)
    const jobPath=`operatorSyncJobs/${syncJobId('triage-help',family,'c',eventId)}`
    await store.doc(jobPath).set({kind:'triage-help',familyId:family,childId:'c',eventId,sourceId:eventId,status:'queued',artifactPath:artifact.artifactPath,fingerprint:artifact.fingerprint})
    const reviewResponse={outcome:'partial',message:'Ты учёл первую фразу. Проверь, что именно отрицается.',next:{title:'Сравни фразы',confirmed:'Первую связь сохраняем.',focus:'Осталась вторая фраза.',question:'Какое требование из неё следует?',presentation:{version:1,activity}}}
    const args={eventId,artifactId:artifact.artifactId,reviewResponse,decision:{reason:'Проверена собственная запись ученика и точный закрытый критерий перехода.',semanticChecked:true,noAnswerChecked:true}}
    expect(await publishHelpResponse(store,args)).toMatchObject({verified:true,unchanged:false})
    expect(await publishHelpResponse(store,args)).toMatchObject({verified:true,unchanged:true})
    const responseRef=doc(db,`dayGuidance/${day}/items/help-${eventId}`)
    const response=(await getDoc(responseRef)).data()
    expect(response.reviewResponse).toEqual(reviewResponse);expect(response.pedagogicalDecision).toBeUndefined()
    await expect(updateDoc(responseRef,{reviewResponse:{outcome:'correct',message:'Подмена',complete:true}})).rejects.toMatchObject({code:'permission-denied'})
    // The next response targets exactly the released model, and stuck needs no text.
    await send({...reply,sourceId:`help-${eventId}`,intent:'stuck',step:{question:reviewResponse.next.question,activity},value:JSON.stringify({selected:[],groups:{},written:{}})})
    await expect(send({...reply,sourceId:`help-${eventId}`})).rejects.toMatchObject({code:'permission-denied'})
    // Client cannot replace a closed solution or act through a parent membership.
    await expect(getDoc(doc(db,`dayReviewPrivate/${day}/items/task`))).rejects.toMatchObject({code:'permission-denied'})
    await store.doc(`families/${family}/members/p`).update({role:'parent'})
    await expect(send(reply)).rejects.toMatchObject({code:'permission-denied'})
    await store.doc(`families/${family}/members/p`).update({role:'student'})
    expect((await store.doc(`dayProgress/${day}/items/task`).get()).data().status).toBe('partial')
  })

})
