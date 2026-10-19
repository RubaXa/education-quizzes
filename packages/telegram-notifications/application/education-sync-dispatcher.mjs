import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { chmodSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { Timestamp } from '@google-cloud/firestore'
import { prepareEventTaskArtifact } from '../../../sync/event-task-artifact.mjs'

/** @see ../../../docs/services/telegram-bot/education-sync-dispatch.md */
export class EducationSyncDispatcher {
  constructor({ store, threadId, codexPath, projectRoot, remote = null, clock = () => new Date(), uuid = randomUUID,
    db = null, prepareArtifact = prepareEventTaskArtifact,
    spawnProcess = spawn, debounceMs = 20_000, timeoutMs = 15_000, terminationGraceMs = 2_000,
    forcedSettlementMs = 4_000, maxOutputBytes = 16_384, env = process.env }) {
    if (!store || !['recordSourceChange', 'read', 'claim', 'markQueued', 'markUncertain', 'fail', 'claimRequest'].every((key) => typeof store[key] === 'function')) throw new Error('education_sync_store_unavailable')
    if (!isUuid(threadId) || typeof codexPath !== 'string' || !codexPath.startsWith('/')
      || typeof projectRoot !== 'string' || !projectRoot.startsWith('/')) throw new Error('education_sync_codex_config_invalid')
    if (remote !== null && (typeof remote !== 'string' || !remote.startsWith('unix://'))) throw new Error('education_sync_remote_invalid')
    this.store = store
    this.db = db
    this.prepareArtifact = prepareArtifact
    this.threadId = threadId
    this.codexPath = codexPath
    this.claimScriptPath = resolve(projectRoot, 'scripts/education-sync-dispatch.mjs')
    this.projectRoot = projectRoot
    this.remote = remote
    this.clock = clock
    this.uuid = uuid
    this.spawnProcess = spawnProcess
    this.debounceMs = debounceMs
    this.timeoutMs = timeoutMs
    this.terminationGraceMs = terminationGraceMs
    this.forcedSettlementMs = forcedSettlementMs
    this.maxOutputBytes = maxOutputBytes
    this.childEnv = safeCodexEnvironment(env)
  }

  /** Accepts only a stable event key; source payloads never cross this boundary. */
  async enqueueMeshChange(eventKey) {
    if (typeof eventKey !== 'string' || !eventKey || eventKey.length > 512) throw new Error('education_sync_event_key_invalid')
    const now = this.clock().toISOString()
    return this.store.recordSourceChange({ eventDigest: digest(eventKey), kind: 'mesh', now, debounceUntil: new Date(Date.parse(now) + this.debounceMs).toISOString() })
  }

  async enqueueWorkChange(event) {
    if (!event || event.source !== 'firestore' || !['upload.confirmed', 'quiz.submitted'].includes(event.eventType)
      || ![event.scopeKey, event.sourceEventKey].every((value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value))) throw new Error('education_sync_event_key_invalid')
    const now = this.clock().toISOString()
    return this.store.recordSourceChange({ eventDigest: workEventDigest(event), kind: 'work', now, debounceUntil: new Date(Date.parse(now) + this.debounceMs).toISOString() })
  }

  /** Prepare one exact source artifact and atomically attach its typed task to this dispatch generation. */
  async enqueueAction(event) {
    if (!this.db || typeof this.store.recordAction !== 'function') throw new Error('education_sync_action_store_unavailable')
    const kind = ACTION_KINDS[event?.eventType]
    if (!kind) throw new Error('unsupported_education_action')
    if (event.eventType === 'material.ready') {
      const source = await this.db.doc(event.sourceRef.documentPath).get()
      if (!source.exists) return { status: 'blocked', safeErrorCode: 'task_source_missing' }
      if (source.data()?.status === 'linked') return { status: 'completed' }
      if (source.data()?.status !== 'needs-identification') return { status: 'blocked', safeErrorCode: 'material_not_needs_identification' }
    }
    const artifact = await this.prepareArtifact(this.db, event)
    const now = this.clock().toISOString()
    return this.store.recordAction({ event, kind, artifact, now,
      debounceUntil: new Date(Date.parse(now) + this.debounceMs).toISOString() })
  }

  /** Queue acknowledgement means Codex accepted the message, not that EducationSync finished. */
  async dispatchDue() {
    const now = this.clock().toISOString()
    const item = await this.store.claim({ now, workerId: this.uuid() })
    if (!item) return { status: 'idle' }
    const requestId = item.requestId ?? this.uuid()
    const workerId = item.workerId
    try {
      const args = ['queue', '--thread', this.threadId, '--message', buildMessage(requestId, this.claimScriptPath, item.workKinds, item)]
      if (this.remote) args.push('--remote', this.remote)
      const output = await this.#run(args)
      const receipt = output.match(/\bQueued message ([0-9a-f-]{36})\b/i)?.[1] ?? null
      await this.store.markQueued({ requestId, workerId, now: this.clock().toISOString(), ...(receipt ? { queueReceiptId: receipt } : {}) })
      return { status: 'queued', requestId }
    } catch (error) {
      if (error?.code === 'codex_spawn_failed') {
        const retryAt = new Date(Date.parse(this.clock().toISOString()) + 60_000).toISOString()
        await this.store.fail({ requestId, workerId, now: this.clock().toISOString(), retryAt })
        return { status: 'retry', requestId, code: safeCode(error) }
      }
      // The CLI may have queued the message before a timeout or pipe failure. Keep the same
      // request ID so retries are recognizable and never claim sync completion here.
      await this.store.markUncertain({ requestId, workerId, now: this.clock().toISOString(), code: safeCode(error) })
      return { status: 'uncertain', requestId, code: safeCode(error) }
    }
  }

  async runOne() { const result = await this.dispatchDue(); return result.status !== 'idle' }

  async claimRequest(requestId) {
    if (typeof requestId !== 'string' || !requestId) throw new Error('education_sync_request_id_invalid')
    const token = this.uuid()
    const result = await this.store.claimRequest({ requestId, tokenHash: digest(token), now: this.clock().toISOString() })
    if (result.status !== 'claimed') return result
    const claimPath = resolve(this.projectRoot, '.local/education-sync-dispatch/claims', `${requestId}.json`)
    const temporary = `${claimPath}.${this.uuid()}.tmp`
    try {
      mkdirSync(dirname(claimPath), { recursive: true, mode: 0o700 })
      writeFileSync(temporary, JSON.stringify({ requestId, token }), { mode: 0o600, flag: 'wx' })
      chmodSync(temporary, 0o600)
      renameSync(temporary, claimPath)
      chmodSync(claimPath, 0o600)
    } catch {
      rmSync(temporary, { force: true })
      await this.store.failClaim({ requestId, tokenHash: digest(token), now: this.clock().toISOString(), retryAt: this.clock().toISOString() })
      return { status: 'claim_file_unavailable' }
    }
    return { status: 'claimed', claimPath }
  }

  #run(args) {
    return new Promise((resolve, reject) => {
      let child
      try { child = this.spawnProcess(this.codexPath, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: this.childEnv }) }
      catch { reject(dispatchError('codex_spawn_failed')); return }
      let bytes = 0
      let overflow = false
      const chunks = []
      let timedOut = false
      let killTimer = null
      let hardKillTimer = null
      const capture = (chunk) => {
        bytes += chunk.length
        if (bytes > this.maxOutputBytes) overflow = true
        else chunks.push(Buffer.from(chunk))
      }
      child.stdout?.on('data', capture)
      child.stderr?.on('data', capture)
      let settled = false
      const finish = (error, value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        clearTimeout(killTimer)
        clearTimeout(hardKillTimer)
        if (error) reject(error)
        else resolve(value)
      }
      const timer = setTimeout(() => {
        timedOut = true
        child.kill('SIGTERM')
        killTimer = setTimeout(() => child.kill('SIGKILL'), this.terminationGraceMs)
        hardKillTimer = setTimeout(() => finish(dispatchError('codex_timeout')), this.forcedSettlementMs)
        killTimer.unref?.(); hardKillTimer.unref?.()
      }, this.timeoutMs)
      child.once('error', () => finish(dispatchError(timedOut ? 'codex_timeout' : 'codex_spawn_failed')))
      child.once('close', (code) => {
        if (timedOut) return finish(dispatchError('codex_timeout'))
        if (overflow) return finish(dispatchError('codex_output_limit'))
        if (code !== 0) return finish(dispatchError('codex_exit_nonzero'))
        finish(null, Buffer.concat(chunks).toString('utf8'))
      })
    })
  }
}

export function createFirestoreEducationSyncStore(db, { collection = 'educationSyncDispatch' } = {}) {
  const ref = db.collection(collection).doc('current')
  const eventCollection = db.collection(`${collection}Events`)
  return Object.freeze({
    async recordMeshChange(args) { return this.recordSourceChange({ ...args, kind: 'mesh' }) },
    async recordSourceChange({ eventDigest, kind = 'mesh', now, debounceUntil }) {
      if (!['mesh', 'work'].includes(kind)) throw new Error('education_sync_kind_invalid')
      return db.runTransaction(async (tx) => {
        const eventRef = eventCollection.doc(eventDigest)
        const eventSnap = await tx.get(eventRef)
        if (eventSnap.exists) return { status: 'duplicate' }
        const snap = await tx.get(ref)
        const state = snap.exists ? snap.data() : { generation: 0, status: 'idle' }
        const generation = (state.generation ?? 0) + 1
        const holdState = ['queued', 'sending', 'uncertain', 'running', 'blocked'].includes(state.status)
        tx.create(eventRef, { acceptedAt: now })
        const activeLegacy = state.generation && ['pending', 'sending', 'queued', 'uncertain', 'running', 'blocked'].includes(state.status)
        const existingKinds = Array.isArray(state.pendingKinds) ? state.pendingKinds
          : Number.isInteger(state.sendingGeneration) ? [] : (activeLegacy ? ['mesh'] : [])
        const pendingKinds = [...new Set([...existingKinds, kind])]
        const hasFrozenBatch = (Array.isArray(state.sendingKinds) && state.sendingKinds.length > 0)
          || Number.isInteger(state.sendingGeneration)
        const clearStaleBatch = ['completed', 'idle'].includes(state.status) || !hasFrozenBatch
        const preserveRetry = holdState || hasFrozenBatch
        tx.set(ref, { ...state, generation, pendingKinds, changedAt: now, debounceUntil,
          status: holdState ? state.status : 'pending', retryAt: preserveRetry ? state.retryAt ?? null : null,
          ...(clearStaleBatch ? { sendingGeneration: null, sendingKinds: null } : {}) }, { merge: false })
        const retryDue = preserveRetry && state.retryAt ? state.retryAt : null
        const nextDueAt = [debounceUntil, retryDue].filter(Boolean).sort().at(-1)
        return { status: 'accepted', generation, ...(!holdState ? { nextDueAt } : {}) }
      })
    },
    async recordAction({ event, kind, artifact, now, debounceUntil }) {
      if (!event || !ACTION_KINDS[event.eventType] || ACTION_KINDS[event.eventType] !== kind
        || !/^[a-f0-9]{64}$/.test(event.eventId ?? '') || !artifact?.artifactPath
        || !/^[a-f0-9]{64}$/.test(artifact.fingerprint ?? '')) throw new Error('education_sync_action_invalid')
      const generationRef = eventCollection.doc(digest(`action:${event.eventId}`))
      const jobId = digest(JSON.stringify([kind, event.familyId, event.childId, event.eventId]))
      const jobRef = db.collection('operatorSyncJobs').doc(jobId)
      return db.runTransaction(async (tx) => {
        // Firestore requires every read to precede the first write.
        const generationSnap = await tx.get(generationRef)
        const jobSnap = await tx.get(jobRef)
        const stateSnap = await tx.get(ref)
        if (generationSnap.exists) return { status: 'duplicate', jobId, artifactId: artifact.artifactPath.split('/').at(-1), generation: generationSnap.data().generation }
        const state = stateSnap.exists ? stateSnap.data() : { generation: 0, status: 'idle' }
        const generation = (state.generation ?? 0) + 1
        const holdState = ['queued', 'sending', 'uncertain', 'running', 'blocked'].includes(state.status)
        const frozen = Number.isInteger(state.sendingGeneration) || Number.isInteger(state.actionThroughGeneration)
        const pendingActionAfterGeneration = Number.isInteger(state.pendingActionAfterGeneration)
          ? state.pendingActionAfterGeneration : (state.completedActionGeneration ?? 0)
        const pendingActionThroughGeneration = generation
        const task = { kind, familyId: event.familyId, childId: event.childId, sourceId: event.eventId,
          source: event.source, fingerprint: artifact.fingerprint, priority: 50, runId: null,
          status: jobSnap.exists && jobSnap.data()?.fingerprint === artifact.fingerprint ? jobSnap.data().status : 'queued',
          phase: 'discovered', reason: null, attempt: (jobSnap.data()?.attempt ?? 0) + 1,
          createdAt: jobSnap.data()?.createdAt ?? Timestamp.fromDate(new Date(now)),
          discoveredAt: Timestamp.fromDate(new Date(now)), updatedAt: Timestamp.fromDate(new Date(now)),
          completedAt: null, evidence: null, eventId: event.eventId, eventType: event.eventType,
          sourceRef: event.sourceRef, artifactPath: artifact.artifactPath }
        const eventRow = { kind: 'action', taskKind: kind, eventId: event.eventId, eventType: event.eventType, sourceRef: event.sourceRef,
          jobId, artifactPath: artifact.artifactPath, observationPath: artifact.observationPath ?? `operatorSyncTaskObservations/${event.eventId}`,
          generation, acceptedAt: Timestamp.fromDate(new Date(now)) }
        tx.create(generationRef, eventRow)
        if (!jobSnap.exists || jobSnap.data()?.fingerprint !== artifact.fingerprint) tx.set(jobRef, task, { merge: false })
        tx.set(ref, { ...state, generation, actionAfterGeneration: pendingActionAfterGeneration,
          actionThroughGeneration: pendingActionThroughGeneration,
          pendingActionAfterGeneration, pendingActionThroughGeneration,
          pendingKinds: [...new Set([...(state.pendingKinds ?? []), 'action'])], changedAt: now, debounceUntil,
          status: holdState ? state.status : 'pending', retryAt: holdState ? state.retryAt ?? null : null,
          ...(!frozen ? { sendingGeneration: null, sendingKinds: null, sendingActionAfterGeneration: null, sendingActionThroughGeneration: null } : {})
        }, { merge: false })
        const nextDueAt = [debounceUntil, holdState ? state.retryAt : null].filter(Boolean).sort().at(-1)
        return { status: 'accepted', generation, jobId, artifactId: artifact.artifactPath.split('/').at(-1), nextDueAt: holdState ? undefined : nextDueAt }
      })
    },
    async read() {
      const snap = await ref.get()
      return snap.exists ? snap.data() : null
    },
    async readActionTasks({ requestId, cursor = null, limit = 100 }) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('education_sync_action_page_invalid')
      const snap = await ref.get()
      if (!snap.exists) throw new Error('education_sync_action_request_missing')
      const state = snap.data()
      if (state.requestId !== requestId || state.status !== 'running' || !state.claimTokenHash
        || !Number.isInteger(state.sendingActionThroughGeneration)) throw new Error('education_sync_action_request_unclaimed')
      const lower = state.sendingActionAfterGeneration ?? 0
      const upper = state.sendingActionThroughGeneration
      const after = cursor ? decodeActionCursor(cursor) : { requestId, lower, upper, generation: lower, id: '' }
      if (after.requestId !== requestId || after.lower !== lower || after.upper !== upper) throw new Error('education_sync_action_cursor_invalid')
      if (after.generation < (state.sendingActionAfterGeneration ?? 0)
        || after.generation > state.sendingActionThroughGeneration) throw new Error('education_sync_action_cursor_invalid')
      let query = eventCollection.where('kind', '==', 'action')
        .where('generation', '>', state.sendingActionAfterGeneration ?? 0)
        .where('generation', '<=', state.sendingActionThroughGeneration)
        .orderBy('generation').orderBy('__name__').limit(limit + 1)
      if (cursor) query = query.startAfter(after.generation, after.id)
      const page = await query.get()
      const docs = page.docs.slice(0, limit)
      const tasks = docs.map((doc) => ({ ...doc.data(), kind: doc.data().taskKind, eventId: doc.data().eventId ?? doc.id }))
      const hasMore = page.docs.length > limit
      const last = docs.at(-1)
      return { tasks, nextCursor: hasMore && last ? encodeActionCursor({ requestId, lower, upper,
        generation: last.data().generation, id: last.id }) : null, complete: true }
    },
    async claim({ now, workerId }) {
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref)
        if (!snap.exists) return null
        const state = snap.data()
        if (state.status === 'sending') {
          if (state.leaseUntil > now) return null
          tx.set(ref, { ...state, status: 'uncertain', uncertainAt: now, lastErrorCode: 'dispatch_lease_expired',
            retryAt: now, leaseUntil: null }, { merge: false })
          return null
        }
        if (state.status === 'running') {
          if (state.workflowLeaseUntil > now) return null
          tx.set(ref, { ...state, status: 'uncertain', uncertainAt: now, lastErrorCode: 'workflow_lease_expired',
            claimTokenHash: null, workflowLeaseUntil: null, retryAt: now }, { merge: false })
          return null
        }
        if (state.status === 'queued') {
          const queuedAt = Date.parse(state.queuedAt ?? '')
          if (Number.isFinite(queuedAt) && Date.parse(now) >= queuedAt + 10 * 60_000) {
            tx.set(ref, { ...state, status: 'uncertain', uncertainAt: now, lastErrorCode: 'queue_ack_expired', retryAt: now }, { merge: false })
          }
          return null
        }
        if (state.status === 'running') return null
        if (state.status === 'uncertain' && state.retryAt && state.retryAt > now) return null
        if (!['pending', 'uncertain'].includes(state.status) || state.debounceUntil > now || (state.retryAt && state.retryAt > now)) return null
        const leaseUntil = new Date(Date.parse(now) + 30_000).toISOString()
        const requestId = state.requestId ?? randomUUID()
        const continuingBatch = Array.isArray(state.sendingKinds) && state.sendingKinds.length > 0
          || Number.isInteger(state.sendingGeneration)
        const workKinds = Array.isArray(state.sendingKinds) && state.sendingKinds.length ? state.sendingKinds
          : continuingBatch ? ['mesh'] : (Array.isArray(state.pendingKinds) ? state.pendingKinds : ['mesh'])
        tx.set(ref, { ...state, status: 'sending', requestId,
          sendingGeneration: continuingBatch ? state.sendingGeneration : state.generation,
          sendingKinds: workKinds, pendingKinds: continuingBatch ? (state.pendingKinds ?? []) : [],
          sendingActionAfterGeneration: continuingBatch ? state.sendingActionAfterGeneration ?? 0 : state.pendingActionAfterGeneration ?? state.completedActionGeneration ?? 0,
          sendingActionThroughGeneration: continuingBatch ? state.sendingActionThroughGeneration ?? null : state.pendingActionThroughGeneration ?? null,
          pendingActionAfterGeneration: continuingBatch ? state.pendingActionAfterGeneration : null,
          pendingActionThroughGeneration: continuingBatch ? state.pendingActionThroughGeneration : null,
          workerId, leaseUntil }, { merge: false })
        return { requestId, generation: continuingBatch ? state.sendingGeneration : state.generation, workKinds,
          actionAfterGeneration: continuingBatch ? state.sendingActionAfterGeneration ?? 0 : state.pendingActionAfterGeneration ?? state.completedActionGeneration ?? 0,
          actionThroughGeneration: continuingBatch ? state.sendingActionThroughGeneration ?? null : state.pendingActionThroughGeneration ?? null,
          workerId }
      })
    },
    async markQueued({ requestId, workerId, now, queueReceiptId = null }) {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref)
        if (!snap.exists || snap.data().requestId !== requestId || snap.data().workerId !== workerId
          || snap.data().status !== 'sending' || !(snap.data().leaseUntil > now)) return
        const state = snap.data()
        tx.set(ref, { ...state, status: 'queued', queuedAt: now, leaseUntil: null, retryAt: null,
          ...(queueReceiptId ? { queueReceiptId } : {}) }, { merge: false })
      })
    },
    async markUncertain({ requestId, workerId, now, code }) {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref)
        if (!snap.exists || snap.data().requestId !== requestId || snap.data().workerId !== workerId || snap.data().status !== 'sending') return
        const state = snap.data()
        tx.set(ref, { ...state, status: 'uncertain', uncertainAt: now, lastErrorCode: code,
          retryAt: new Date(Date.parse(now) + 60_000).toISOString(), leaseUntil: null }, { merge: false })
      })
    },
    async claimRequest({ requestId, tokenHash, now }) {
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref)
        if (!snap.exists) return { status: 'missing' }
        const state = snap.data()
        if (state.requestId !== requestId) return { status: 'stale_request' }
        if (state.status === 'running' && state.workflowLeaseUntil > now) return { status: 'running' }
        if (!['sending', 'queued', 'uncertain', 'running'].includes(state.status)) return { status: state.status }
        tx.set(ref, { ...state, status: 'running', claimTokenHash: tokenHash, claimedAt: now,
          workflowLeaseUntil: new Date(Date.parse(now) + 6 * 60 * 60_000).toISOString() }, { merge: false })
        return { status: 'claimed' }
      })
    },
    async heartbeatClaim({ requestId, tokenHash, now }) {
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref)
        if (!snap.exists || snap.data().requestId !== requestId || snap.data().claimTokenHash !== tokenHash
          || snap.data().status !== 'running' || !(snap.data().workflowLeaseUntil > now)) return { status: 'invalid_claim' }
        tx.set(ref, { ...snap.data(), workflowLeaseUntil: new Date(Date.parse(now) + 6 * 60 * 60_000).toISOString(), heartbeatAt: now }, { merge: false })
        return { status: 'running' }
      })
    },
    async completeClaim({ requestId, tokenHash, now }) {
      const preliminary = await ref.get()
      if (!preliminary.exists || preliminary.data().requestId !== requestId || preliminary.data().claimTokenHash !== tokenHash
        || preliminary.data().status !== 'running') return { status: 'invalid_claim' }
      const frozenAfter = preliminary.data().sendingActionAfterGeneration ?? 0
      const frozenThrough = preliminary.data().sendingActionThroughGeneration
      if (Number.isInteger(frozenThrough) && frozenThrough > frozenAfter) {
        let cursor = null
        while (true) {
          let query = eventCollection.where('kind', '==', 'action').where('generation', '>', frozenAfter)
            .where('generation', '<=', frozenThrough).orderBy('generation').orderBy('__name__').limit(100)
          if (cursor) query = query.startAfter(cursor.generation, cursor.id)
          const page = await query.get()
          if (!page.docs.length) break
          const jobs = await Promise.all(page.docs.map((eventDoc) => db.doc(`operatorSyncJobs/${eventDoc.data().jobId}`).get()))
          if (jobs.some((job) => !job.exists || job.data()?.status !== 'done')) return { status: 'incomplete_actions' }
          const last = page.docs.at(-1)
          cursor = { generation: last.data().generation, id: last.id }
          if (page.docs.length < 100) break
        }
      }
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref)
        if (!snap.exists || snap.data().requestId !== requestId || snap.data().claimTokenHash !== tokenHash
          || snap.data().status !== 'running' || !(snap.data().workflowLeaseUntil > now)) return { status: 'invalid_claim' }
        const state = snap.data()
        const completedActions = state.sendingActionThroughGeneration ?? state.completedActionGeneration ?? 0
        const pending = (state.generation ?? 0) > (state.sendingGeneration ?? 0)
          || (state.pendingActionThroughGeneration ?? 0) > completedActions
        tx.set(ref, { ...state, status: pending ? 'pending' : 'completed', completedRequestId: requestId,
          completedAt: now, requestId: null, claimTokenHash: null, workflowLeaseUntil: null, retryAt: null, leaseUntil: null,
          completedActionGeneration: Math.max(state.completedActionGeneration ?? 0, completedActions),
          sendingKinds: null, sendingGeneration: null, sendingActionAfterGeneration: null, sendingActionThroughGeneration: null,
          actionAfterGeneration: null, actionThroughGeneration: null }, { merge: false })
        return { status: pending ? 'pending' : 'completed' }
      })
    },
    async failClaim({ requestId, tokenHash, now, retryAt }) {
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref)
        if (!snap.exists || snap.data().requestId !== requestId || snap.data().claimTokenHash !== tokenHash
          || snap.data().status !== 'running' || !(snap.data().workflowLeaseUntil > now)) return { status: 'invalid_claim' }
        const state = snap.data()
        tx.set(ref, { ...state, status: 'pending', failedAt: now, requestId: null, claimTokenHash: null, workflowLeaseUntil: null, retryAt }, { merge: false })
        return { status: 'pending' }
      })
    },
    async blockClaim({ requestId, tokenHash, reasonCode, now }) {
      if (!['permission_required', 'source_unavailable', 'manual_review_required'].includes(reasonCode)) return { status: 'invalid_reason' }
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref)
        if (!snap.exists || snap.data().requestId !== requestId || snap.data().claimTokenHash !== tokenHash
          || snap.data().status !== 'running' || !(snap.data().workflowLeaseUntil > now)) return { status: 'invalid_claim' }
        tx.set(ref, { ...snap.data(), status: 'blocked', blockedReasonCode: reasonCode, blockedAt: now,
          claimTokenHash: null, workflowLeaseUntil: null, retryAt: null }, { merge: false })
        return { status: 'blocked', reasonCode }
      })
    },
    async resumeBlocked({ requestId, now }) {
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref)
        if (!snap.exists || snap.data().requestId !== requestId || snap.data().status !== 'blocked') return { status: 'not_blocked' }
        const state = snap.data()
        tx.set(ref, { ...state, status: 'pending', blockedReasonCode: null, resumedAt: now,
          retryAt: null,
          debounceUntil: state.debounceUntil > now ? state.debounceUntil : now }, { merge: false })
        return { status: 'pending', requestId }
      })
    },
    async fail({ requestId, workerId, now, retryAt }) {
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref)
        if (!snap.exists || snap.data().requestId !== requestId || snap.data().workerId !== workerId || snap.data().status !== 'sending') return { status: 'stale_request' }
        const state = snap.data()
        tx.set(ref, { ...state, status: 'pending', retryAt, failedAt: now, leaseUntil: null }, { merge: false })
        return { status: 'pending' }
      })
    },
  })
}

export function buildMessage(requestId, claimScriptPath = '/PATH/scripts/education-sync-dispatch.mjs', workKinds = ['mesh'], batch = {}) {
  const run = (action) => `${shellQuote(process.execPath)} ${shellQuote(claimScriptPath)} ${action}`
  const claimFile = '"/ABSOLUTE/CLAIM/PATH/FROM/COMMAND/OUTPUT"'
  const hasActions = Number.isInteger(batch.actionThroughGeneration) && batch.actionThroughGeneration > (batch.actionAfterGeneration ?? 0)
  const actionInstruction = hasActions
    ? `Process only this frozen event-action range with the exact task exporter: run ${run(`tasks --request ${requestId} --claim-file ${claimFile}`)}, then follow the private manifest references. Do not scan the global inbox or broaden the event range.`
    : ''
  const hasMesh = !Array.isArray(workKinds) || workKinds.includes('mesh')
  const meshInstruction = hasMesh
    ? 'Run $education-sync for the confirmed Mesh changes, using its normal safeguards and complete global connected-family scope with no family cap. The user has authorized standard Mesh material synchronization using the established family archive and public-link workflow without per-file confirmation prompts.'
    : ''
  const legacyWork = workKinds.includes('work') && !hasActions
    ? 'Follow the claimed work-only inbox route using the established npm run sync:inbox review workflow; do not run full project.collect or collect Mesh. Process only naturally confirmed Firestore work.' : ''
  const instruction = [actionInstruction, meshInstruction, legacyWork].filter(Boolean).join(' ')
  return `${instruction} This message is only a dispatch request. Request ID: ${requestId}. First claim it with: ${run(`claim --request ${requestId}`)}. If the result is busy, running, completed, blocked, or anything other than claimed, stop without syncing. Keep the private claim file path returned by claim. Renew the claim with ${run(`heartbeat --request ${requestId} --claim-file ${claimFile}`)} between long workflow stages. After the requested workflow succeeds, run ${run(`complete --request ${requestId} --claim-file ${claimFile}`)}. Block only for a genuine runtime/credentials failure, an explicit external tool policy denial, or a human review requirement that applies beyond the already authorized standard flow; do not block to ask for per-file confirmation. Report the actual blocker and run ${run(`block --request ${requestId} --claim-file ${claimFile} --reason permission_required`)} (use source_unavailable or manual_review_required when those apply). For an ordinary retryable workflow failure, use ${run(`fail --request ${requestId} --claim-file ${claimFile}`)}. A successful queue acknowledgement never means the sync completed.`
}

const ACTION_KINDS = Object.freeze({
  'help.requested': 'triage-help',
  'quiz.followup_requested': 'generate-followup',
  'quiz.submitted': 'review-quiz',
  'upload.confirmed': 'review-work',
  'material.ready': 'ingest-material',
})

function encodeActionCursor(value) { return Buffer.from(JSON.stringify(value)).toString('base64url') }
function decodeActionCursor(value) {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
    if (!Number.isInteger(parsed.generation) || typeof parsed.id !== 'string' || typeof parsed.requestId !== 'string'
      || !Number.isInteger(parsed.lower) || !Number.isInteger(parsed.upper)) throw new Error()
    return parsed
  } catch { throw new Error('education_sync_action_cursor_invalid') }
}

export function workEventDigest(event) {
  if (!event || event.source !== 'firestore' || !['upload.confirmed', 'quiz.submitted'].includes(event.eventType)
    || ![event.scopeKey, event.sourceEventKey].every((value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value))) {
    throw new Error('education_sync_event_key_invalid')
  }
  return digest(JSON.stringify(['firestore-work-v1', event.scopeKey, event.sourceEventKey, event.eventType]))
}

function digest(value) { return createHash('sha256').update(value).digest('hex') }
function shellQuote(value) { return `'${String(value).replaceAll("'", "'\\''")}'` }
function safeCodexEnvironment(env) {
  const sensitive = /(?:AGI_EDU_BOT|TOKEN|SECRET|PASSWORD|CREDENTIAL|ACCESS_KEY|PRIVATE_KEY|API_KEY|FIREBASE_CONFIG|\bADC\b)/i
  return Object.fromEntries(Object.entries(env ?? {}).filter(([key]) => !sensitive.test(key)))
}
function isUuid(value) { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) }
function dispatchError(code) { const error = new Error(code); error.code = code; return error }
function safeCode(error) { return ['codex_spawn_failed', 'codex_timeout', 'codex_output_limit', 'codex_exit_nonzero'].includes(error?.code) ? error.code : 'codex_dispatch_failed' }
