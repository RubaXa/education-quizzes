import { randomBytes } from 'node:crypto'
import { FieldValue } from '@google-cloud/firestore'

/** @see ../../../docs/services/telegram-bot/event-ledger-outbox.md#логические-записи @see ../../../docs/services/telegram-bot/identity-and-linking.md#состояния @see ../../../docs/services/telegram-bot/ports-and-events.md#контракт-портов */
export function createFirestoreAdapters(db, { eventCollection = 'telegramNotificationEvents', outboxCollection = 'telegramNotificationOutbox', accountCollection = 'telegramBotAccounts' } = {}) {
  const events = db.collection(eventCollection)
  const jobs = db.collection(outboxCollection)
  const accounts = db.collection(accountCollection)
  const familyLinks = db.collection('telegramBotFamilyLinks')
  const registry = {
    async registerAccount({ senderId, username, firstName, at }) {
      const ref = accounts.doc(senderId)
      await db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref)
        const old = snapshot.exists ? snapshot.data() : {}
        // Repeated /start never changes a disconnected account back to active.
        tx.set(ref, { telegramUserId: senderId, username: username ?? '', firstName: firstName ?? '', status: old.status ?? 'registered', updatedAt: at, createdAt: old.createdAt ?? at }, { merge: true })
      })
    },
    async recordChannelUpdate({ senderId, status, updateId, observedAt }) {
      const ref = accounts.doc(senderId)
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref)
        if (!Number.isSafeInteger(updateId) || !Number.isSafeInteger(observedAt)) return { updated: false }
        const occurredAt = new Date(observedAt).toISOString()
        const old = snap.exists ? snap.data() : { telegramUserId: senderId, username: '', firstName: '', status: 'registered', createdAt: occurredAt }
        const telegramIdReset = Number.isSafeInteger(old.lastChannelUpdateId) && Number.isSafeInteger(old.lastChannelUpdateAt)
          && observedAt >= old.lastChannelUpdateAt + 7 * 24 * 60 * 60_000
        if (Number.isSafeInteger(old.lastChannelUpdateId) && updateId <= old.lastChannelUpdateId && !telegramIdReset) return { updated: false }
        if (Number.isSafeInteger(old.lastChannelUpdateAt) && observedAt < old.lastChannelUpdateAt) return { updated: false }
        if (old.channelStatusSource === 'delivery_failure' && Number.isSafeInteger(old.channelStatusChangedAt) && observedAt <= old.channelStatusChangedAt) return { updated: false }
        const version = (old.channelStatusVersion ?? 0) + 1
        const update = { ...(!snap.exists ? old : {}), telegramUserId: senderId, channelStatus: status, channelStatusChangedAt: observedAt, channelStatusSource: 'telegram_update', channelStatusVersion: version, lastChannelUpdateId: updateId, lastChannelUpdateAt: observedAt, updatedAt: occurredAt }
        if (snap.exists) tx.update(ref, update)
        else tx.create(ref, update)
        return { updated: true, state: status, version }
      })
    },
    async markChannelUnavailable({ senderId, attemptStartedAt, expectedVersion }) {
      const ref = accounts.doc(senderId)
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref)
        if (!snap.exists) return { applied: false, state: 'unavailable', version: 0 }
        const old = snap.data()
        const version = old.channelStatusVersion ?? 0
        const state = old.channelStatus ?? 'available'
        if (version !== expectedVersion || (Number.isSafeInteger(old.channelStatusChangedAt) && old.channelStatusChangedAt > attemptStartedAt)) return { applied: false, state, version }
        tx.update(ref, { channelStatus: 'unavailable', channelStatusChangedAt: attemptStartedAt, channelStatusSource: 'delivery_failure', channelStatusVersion: version + 1 })
        return { applied: true, state: 'unavailable', version: version + 1 }
      })
    },
    async listActiveLinks(senderId) {
      const snap = await familyLinks.where('telegramUserId', '==', senderId).get()
      return snap.docs.map((doc) => ({ ...doc.data(), linkId: doc.id })).filter((link) => link.familyId && link.status === 'active')
    },
    async createStopChallenge(challenge) {
      await db.collection('telegramBotStopChallenges').doc(challenge.tokenHash).create({ ...challenge, usedAt: null, createdAt: FieldValue.serverTimestamp() })
    },
    async consumeStopChallenge({ tokenHash, senderId, now }) {
      const challengeRef = db.collection('telegramBotStopChallenges').doc(tokenHash)
      return db.runTransaction(async (tx) => {
        const cSnap = await tx.get(challengeRef)
        if (!cSnap.exists) return { code: 'invalid_confirmation' }
        const c = cSnap.data()
        if (c.senderId !== senderId || c.usedAt || c.expiresAt <= now) return { code: 'invalid_confirmation' }
        const linkDoc = familyLinks.doc(c.linkId)
        const linkSnap = await tx.get(linkDoc)
        const link = linkSnap.data()
        if (!linkSnap.exists || link.telegramUserId !== senderId || link.familyId !== c.familyId || link.status !== 'active') return { code: 'link_unavailable' }
        tx.update(challengeRef, { usedAt: now })
        tx.update(linkDoc, { status: 'disconnected', disconnectedAt: now, disconnectedByTelegramUserId: senderId })
        tx.create(db.collection('telegramBotLinkHistory').doc(`${c.linkId}_${tokenHash}`), { linkId: c.linkId, action: 'disconnected', at: now, actorTelegramUserId: senderId })
        return { code: 'disconnected' }
      })
    },
  }
  const channel = {
    async getState(senderId) {
      const snap = await accounts.doc(String(senderId)).get()
      if (!snap.exists) return { status: 'unavailable', version: 0, exists: false }
      const row = snap.data()
      return { status: row.channelStatus ?? 'available', version: row.channelStatusVersion ?? 0, exists: true }
    },
    async isAvailable(senderId) { return (await this.getState(senderId)).status === 'available' },
    async confirmReachable({ senderId, updateId, observedAt }) { return registry.recordChannelUpdate({ senderId: String(senderId), status: 'available', updateId, observedAt }) },
    async markUnavailable(input) { return registry.markChannelUnavailable(input) },
  }
  const outbox = {
    async claim({ workerId, now, leaseMs, maxAttempts = 8 }) {
      const snap = await jobs.where('state', 'in', ['pending', 'retry_wait']).where('nextAttemptAt', '<=', now).orderBy('nextAttemptAt').limit(20).get()
      for (const candidate of snap.docs) {
        const leaseToken = randomBytes(32).toString('base64url')
        const claimed = await db.runTransaction(async (tx) => {
          const fresh = await tx.get(candidate.ref)
          if (!fresh.exists) return null
          const row = fresh.data()
          if (!['pending', 'retry_wait'].includes(row.state) || row.nextAttemptAt > now) return null
          if ((row.attempts ?? 0) >= maxAttempts) {
            tx.update(candidate.ref, { state: 'dead_letter', safeErrorCode: 'retry_limit_reached', exhaustedAt: now })
            return null
          }
          const leaseUntil = new Date(Date.parse(now) + leaseMs).toISOString()
          const attempts = (row.attempts ?? 0) + 1
          tx.update(candidate.ref, { state: 'leased', attempts, leaseOwner: workerId, leaseToken, leaseUntil, claimedAt: now })
          return { ...row, state: 'leased', attempts, leaseOwner: workerId, leaseToken, leaseUntil }
        })
        if (claimed) return claimed
      }
      return null
    },
    async finish({ jobId, workerId, leaseToken, result, now = new Date().toISOString() }) {
      await withOwnedLease(db, jobs.doc(jobId), workerId, leaseToken, now, (tx, ref) => tx.update(ref, { ...result, leaseOwner: null, leaseToken: null, leaseUntil: null, finishedAt: now }))
    },
    async renew({ jobId, workerId, leaseToken, now, leaseMs }) {
      await withOwnedLease(db, jobs.doc(jobId), workerId, leaseToken, now, (tx, ref) => tx.update(ref, { leaseUntil: new Date(Date.parse(now) + leaseMs).toISOString() }))
    },
    async savePartReceipt({ jobId, workerId, leaseToken, index, receipt, now, leaseMs }) {
      await db.runTransaction(async (tx) => {
        const ref = jobs.doc(jobId)
        const snap = await tx.get(ref)
        if (!snap.exists) throw safeError('job_unavailable')
        const row = snap.data()
        if (row.state !== 'leased' || row.leaseOwner !== workerId || row.leaseToken !== leaseToken || row.leaseUntil <= now) throw safeError('stale_lease')
        const receipts = row.partReceipts ?? []
        if (index < receipts.length) return
        if (index !== receipts.length) throw safeError('part_order_invalid')
        tx.update(ref, { partReceipts: [...receipts, receipt], leaseUntil: new Date(Date.parse(now) + leaseMs).toISOString() })
      })
    },
    async reschedule({ jobId, workerId, leaseToken, attempts, nextAttemptAt, safeErrorCode, now = new Date().toISOString() }) {
      await withOwnedLease(db, jobs.doc(jobId), workerId, leaseToken, now, (tx, ref) => tx.update(ref, { state: 'retry_wait', attempts, nextAttemptAt, safeErrorCode, leaseOwner: null, leaseToken: null, leaseUntil: null }))
    },
    async recoverExpired(now, { maxAttempts = 8, recoveryDelayMs = 1_000 } = {}) {
      const snap = await jobs.where('state', '==', 'leased').where('leaseUntil', '<=', now).limit(200).get()
      for (const doc of snap.docs) await db.runTransaction(async (tx) => {
        const fresh = await tx.get(doc.ref)
        if (fresh.exists && fresh.data().state === 'leased' && fresh.data().leaseUntil <= now) {
          const row = fresh.data()
          tx.update(doc.ref, row.attempts >= maxAttempts
            ? { state: 'dead_letter', safeErrorCode: 'retry_limit_reached', leaseOwner: null, leaseToken: null, leaseUntil: null, recoveredAt: now }
            : { state: 'retry_wait', safeErrorCode: 'worker_lease_expired', nextAttemptAt: new Date(Date.parse(now) + recoveryDelayMs).toISOString(), leaseOwner: null, leaseToken: null, leaseUntil: null, recoveredAt: now })
        }
      })
      return snap.size
    },
  }
  const eventLedger = {
    async recordIfAbsent({ event, jobs: jobRows }) {
      const eventRef = events.doc(event.eventId)
      const jobRefs = jobRows.map((job) => jobs.doc(job.jobId))
      const linkRefs = jobRows.map((job) => familyLinks.doc(job.linkId))
      const memberRefs = jobRows.map((job) => db.doc(`families/${job.familyId}/members/${job.personId}`))
      return db.runTransaction(async (tx) => {
        const current = await tx.get(eventRef)
        if (current.exists) return { created: false, eventId: event.eventId }
        const [existingJobs, linkSnaps, memberSnaps] = await Promise.all([
          Promise.all(jobRefs.map((ref) => tx.get(ref))),
          Promise.all(linkRefs.map((ref) => tx.get(ref))),
          Promise.all(memberRefs.map((ref) => tx.get(ref))),
        ])
        const verified = jobRows.map((job, index) => {
          const link = linkSnaps[index].exists ? linkSnaps[index].data() : null
          const member = memberSnaps[index].exists ? memberSnaps[index].data() : null
          return link?.status === 'active' && link.familyId === job.familyId && link.personId === job.personId
            && String(link.telegramUserId) === String(job.telegramUserId) && member?.active === true
            && member.role === 'parent' && Array.isArray(member.childIds) && member.childIds.includes(job.childId)
        })
        tx.create(eventRef, { ...event, createdAt: FieldValue.serverTimestamp() })
        for (let i = 0; i < jobRows.length; i += 1) if (verified[i] && !existingJobs[i].exists) tx.create(jobRefs[i], jobRows[i])
        return { created: true, eventId: event.eventId, queued: verified.filter((ok, index) => ok && !existingJobs[index].exists).length }
      })
    },
  }
  const recipients = {
    async resolveVerified(event) {
      const snap = await familyLinks.where('familyId', '==', event.familyId).get()
      const result = []
      for (const doc of snap.docs) {
        const link = doc.data()
        if (link.status !== 'active' || !link.telegramUserId || !link.personId) continue
        const target = { type: 'family-link', linkId: doc.id, familyId: event.familyId, personId: link.personId, telegramUserId: String(link.telegramUserId), childId: event.childId }
        if (await membership.isActiveMember(target)) result.push(target)
      }
      return result
    },
  }
  const membership = {
    async isActiveMember(target) {
      const { familyId, personId, childId, linkId, telegramUserId } = target ?? {}
      if (![familyId, personId, childId, linkId].every(validPathId) || !validTelegramId(telegramUserId)) return false
      const linkSnap = await familyLinks.doc(linkId).get()
      const link = linkSnap.exists ? linkSnap.data() : null
      if (!link || link.status !== 'active' || link.familyId !== familyId || link.personId !== personId || String(link.telegramUserId) !== String(telegramUserId)) return false
      const ref = db.doc(`families/${familyId}/members/${personId}`)
      const snap = await ref.get()
      const member = snap.exists ? snap.data() : null
      return member?.active === true && member.role === 'parent' && Array.isArray(member.childIds) && member.childIds.includes(childId)
    },
  }
  return { registry, channel, outbox, eventLedger, recipients, membership }
}

async function withOwnedLease(db, ref, workerId, leaseToken, now, update) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw safeError('job_unavailable')
    const row = snap.data()
    if (row.state !== 'leased' || row.leaseOwner !== workerId || row.leaseToken !== leaseToken || row.leaseUntil <= now) throw safeError('stale_lease')
    update(tx, ref, row)
  })
}

function safeError(safeCode) { const error = new Error(safeCode); error.safeCode = safeCode; return error }
const validPathId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 128 && value !== '.' && value !== '..' && !value.includes('/') && !value.includes('\\') && !hasControlByte(value)
const validTelegramId = (value) => /^\d{1,20}$/.test(String(value)) && Number.isSafeInteger(Number(value)) && Number(value) > 0
const hasControlByte = (value) => [...value].some((character) => character.charCodeAt(0) < 32)
