import { randomBytes } from 'node:crypto'
import { FieldValue } from '@google-cloud/firestore'

/** @see ../../../docs/services/telegram-bot/event-ledger-outbox.md#логические-записи */
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
        return { created: true, eventId: event.eventId, queued: verified.filter(Boolean).length }
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
  return { registry, outbox, eventLedger, recipients, membership }
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
