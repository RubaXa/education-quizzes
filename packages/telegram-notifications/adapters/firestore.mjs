import { randomBytes } from 'node:crypto'
import { createHash } from 'node:crypto'
import { FieldValue } from '@google-cloud/firestore'
import { renderNotificationDigestParts, notificationMessageVersion } from '../domain/renderer.mjs'

/** @see ../../../docs/services/telegram-bot/event-ledger-outbox.md#логические-записи @see ../../../docs/services/telegram-bot/identity-and-linking.md#состояния @see ../../../docs/services/telegram-bot/ports-and-events.md#контракт-портов */
export function createFirestoreAdapters(db, { eventCollection = 'telegramNotificationEvents', outboxCollection = 'telegramNotificationOutbox', accountCollection = 'telegramBotAccounts', groupCollection = 'telegramNotificationGroups', groupPointerCollection = 'telegramNotificationGroupPointers' } = {}) {
  const events = db.collection(eventCollection)
  const jobs = db.collection(outboxCollection)
  const accounts = db.collection(accountCollection)
  const groups = db.collection(groupCollection)
  const groupPointers = db.collection(groupPointerCollection)
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
    async createPairChallenge(challenge) {
      const accountRef = accounts.doc(challenge.senderId)
      const challengeRef = db.collection('telegramBotPairChallenges').doc(challenge.tokenHash)
      return db.runTransaction(async (tx) => {
        const accountSnap = await tx.get(accountRef)
        if (!accountSnap.exists || accountSnap.data()?.status === 'disconnected') return { issued: false }
        const account = accountSnap.data()
        const lastIssued = Date.parse(account.pairCodeIssuedAt ?? '')
        const issuedAt = Date.parse(challenge.issuedAt)
        if (!Number.isFinite(issuedAt) || (Number.isFinite(lastIssued) && issuedAt < lastIssued + 60_000)) return { issued: false }
        const previousHash = account.currentPairCodeHash
        const previousRef = /^[a-f0-9]{64}$/.test(previousHash ?? '')
          ? db.collection('telegramBotPairChallenges').doc(previousHash) : null
        const previousSnap = previousRef ? await tx.get(previousRef) : null
        tx.create(challengeRef, { ...challenge, usedAt: null, createdAt: FieldValue.serverTimestamp(), action: 'link-family' })
        if (previousSnap?.exists) tx.delete(previousRef)
        tx.update(accountRef, { currentPairCodeHash: challenge.tokenHash, pairCodeIssuedAt: challenge.issuedAt,
          pairCodeExpiresAt: challenge.expiresAt })
        return { issued: true }
      })
    },
    async redeemPairChallenge({ tokenHash, familyId, personId, now }) {
      if (!/^[a-f0-9]{64}$/.test(tokenHash ?? '') || !validPathId(familyId) || !validPathId(personId)) return { code: 'invalid_pairing' }
      const challengeRef = db.collection('telegramBotPairChallenges').doc(tokenHash)
      return db.runTransaction(async (tx) => {
        const challengeSnap = await tx.get(challengeRef)
        if (!challengeSnap.exists) return { code: 'invalid_pairing' }
        const challenge = challengeSnap.data()
        const expiresAt = Date.parse(challenge.expiresAt ?? '')
        const issuedAt = Date.parse(challenge.issuedAt ?? '')
        if (challenge.action !== 'link-family' || challenge.usedAt || !Number.isFinite(expiresAt)
          || !Number.isFinite(issuedAt) || Date.parse(now) < issuedAt || Date.parse(now) >= expiresAt
          || expiresAt - issuedAt <= 0 || expiresAt - issuedAt > 10 * 60_000
          || !validTelegramId(challenge.senderId)) return { code: 'invalid_pairing' }
        const senderId = String(challenge.senderId)
        const accountRef = accounts.doc(senderId)
        const familyRef = db.doc(`families/${familyId}`)
        const memberRef = db.doc(`families/${familyId}/members/${personId}`)
        const [accountSnap, familySnap, memberSnap] = await Promise.all([tx.get(accountRef), tx.get(familyRef), tx.get(memberRef)])
        if (!accountSnap.exists || accountSnap.data()?.status === 'disconnected'
          || accountSnap.data()?.currentPairCodeHash !== tokenHash || accountSnap.data()?.pairCodeExpiresAt !== challenge.expiresAt
          || (accountSnap.data()?.channelStatus ?? 'available') !== 'available'
          || !familySnap.exists || familySnap.data()?.active === false || !memberSnap.exists) return { code: 'pairing_owner_unavailable' }
        const member = memberSnap.data()
        if (member?.active !== true || member.role !== 'parent' || !Array.isArray(member.childIds)) return { code: 'pairing_owner_unavailable' }
        const childIds = [...new Set(member.childIds.filter(validPathId))]
        if (!childIds.length) return { code: 'pairing_owner_unavailable' }
        const childSnaps = await Promise.all(childIds.map((id) => tx.get(db.doc(`families/${familyId}/children/${id}`))))
        if (!childSnaps.some((snap) => snap.exists && snap.data()?.active !== false)) return { code: 'pairing_owner_unavailable' }
        const existingSnap = await tx.get(familyLinks.where('telegramUserId', '==', senderId))
        const existing = (existingSnap.docs ?? []).map((doc) => ({ id: doc.id, ...doc.data() }))
          .filter((link) => link.familyId === familyId && link.status === 'active')
        if (existing.length) {
          const same = existing.every((link) => link.personId === personId)
          if (!same) return { code: 'pairing_conflict' }
          tx.update(challengeRef, { usedAt: now, linkId: existing[0].id })
          tx.update(accountRef, { currentPairCodeHash: null, pairCodeExpiresAt: null })
          return { code: 'already_linked' }
        }
        const linkId = createHash('sha256').update(JSON.stringify(['telegram-link-v1', senderId, familyId])).digest('hex').slice(0, 32)
        const linkRef = familyLinks.doc(linkId)
        const linkSnap = await tx.get(linkRef)
        if (linkSnap.exists && linkSnap.data()?.status === 'active') {
          return { code: 'pairing_conflict' }
        }
        tx.set(linkRef, { telegramUserId: senderId, familyId, personId, status: 'active', linkedAt: now,
          verifiedAt: now, verifiedBy: 'operator_pairing', channelStatusAtLink: accountSnap.data()?.channelStatus ?? 'available' })
        tx.update(challengeRef, { usedAt: now, linkId })
        tx.update(accountRef, { currentPairCodeHash: null, pairCodeExpiresAt: null })
        tx.create(db.collection('telegramBotLinkHistory').doc(`${linkId}_${tokenHash}`), {
          linkId, familyId, personId, action: 'linked', at: now, actorTelegramUserId: senderId, method: 'operator_pairing',
        })
        return { code: 'linked', linkId }
      })
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
    async claim({ workerId, now, leaseMs, maxAttempts = 8, jobId = null }) {
      if (jobId !== null && !validPathId(jobId)) throw safeError('job_unavailable')
      const candidates = jobId ? [await jobs.doc(jobId).get()]
        : (await jobs.where('state', 'in', ['pending', 'retry_wait']).where('nextAttemptAt', '<=', now).orderBy('nextAttemptAt').limit(20).get()).docs
      for (const candidate of candidates) {
        const candidateRef = candidate.ref
        const candidateRow = candidate.data?.() ?? null
        if (candidateRow?.groupId && !candidateRow.isDigest) {
          const groupedClaim = await claimDigest(candidateRow.groupId, { workerId, now, leaseMs, maxAttempts })
          if (groupedClaim) return groupedClaim
          continue
        }
        const leaseToken = randomBytes(32).toString('base64url')
        const claimed = await db.runTransaction(async (tx) => {
          const fresh = await tx.get(candidateRef)
          if (!fresh.exists) return null
          const row = fresh.data()
          if (!['pending', 'retry_wait'].includes(row.state) || row.nextAttemptAt > now) return null
          if ((row.attempts ?? 0) >= maxAttempts) {
            tx.update(candidateRef, { state: 'dead_letter', safeErrorCode: 'retry_limit_reached', exhaustedAt: now })
            return null
          }
          const leaseUntil = new Date(Date.parse(now) + leaseMs).toISOString()
          const attempts = (row.attempts ?? 0) + 1
          tx.update(candidateRef, { state: 'leased', attempts, leaseOwner: workerId, leaseToken, leaseUntil, claimedAt: now })
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
  async function claimDigest(groupId, { workerId, now, leaseMs, maxAttempts }) {
    if (!validPathId(groupId)) return null
    const groupRef = groups.doc(groupId)
    const leaseToken = randomBytes(32).toString('base64url')
    return db.runTransaction(async (tx) => {
      const groupSnap = await tx.get(groupRef)
      if (!groupSnap.exists) return null
      const group = groupSnap.data()
      if (group.state !== 'open' || Date.parse(group.flushAt) > Date.parse(now)) return null
      const pendingQuery = jobs.where('groupId', '==', groupId).where('state', '==', 'pending')
      const pendingSnap = await tx.get(pendingQuery)
      const rows = pendingSnap.docs.map((doc) => ({ ref: doc.ref, row: doc.data() }))
        .sort((a, b) => String(a.row.event?.detectedAt ?? '').localeCompare(String(b.row.event?.detectedAt ?? '')) || a.row.jobId.localeCompare(b.row.jobId))
      if (!rows.length) {
        tx.update(groupRef, { state: 'empty', frozenAt: now })
        return null
      }
      const first = rows[0].row
      if (rows.some(({ row }) => row.messageVersion !== 2 || row.telegramUserId !== first.telegramUserId
        || row.familyId !== first.familyId || row.childId !== first.childId || row.linkId !== first.linkId)) {
        tx.update(groupRef, { state: 'dead_letter', safeErrorCode: 'group_membership_mismatch', failedAt: now })
        for (const { ref } of rows) tx.update(ref, { state: 'dead_letter', safeErrorCode: 'group_membership_mismatch', failedAt: now })
        return null
      }
      const eventIds = rows.map(({ row }) => row.eventId)
      const eventDocs = await Promise.all(rows.map(({ row }) => tx.get(events.doc(row.eventId))))
      if (eventDocs.some((snap) => !snap.exists || snap.data()?.familyId !== first.familyId || snap.data()?.childId !== first.childId)) {
        tx.update(groupRef, { state: 'dead_letter', safeErrorCode: 'group_event_mismatch', failedAt: now })
        for (const { ref } of rows) tx.update(ref, { state: 'dead_letter', safeErrorCode: 'group_event_mismatch', failedAt: now })
        return null
      }
      const digestId = `digest_${createHash('sha256').update(groupId).digest('hex')}`
      const digestRef = jobs.doc(digestId)
      const existingDigest = await tx.get(digestRef)
      if (existingDigest.exists) {
        const current = existingDigest.data()
        if (!['pending', 'retry_wait'].includes(current.state)) return null
        if ((current.attempts ?? 0) >= maxAttempts) {
          tx.update(digestRef, { state: 'dead_letter', safeErrorCode: 'retry_limit_reached', exhaustedAt: now,
            leaseOwner: null, leaseToken: null, leaseUntil: null })
          tx.update(groupRef, { state: 'dead_letter', safeErrorCode: 'retry_limit_reached', failedAt: now })
          return null
        }
        const leaseUntil = new Date(Date.parse(now) + leaseMs).toISOString()
        const attempts = (current.attempts ?? 0) + 1
        tx.update(digestRef, { state: 'leased', attempts, leaseOwner: workerId, leaseToken, leaseUntil, claimedAt: now })
        tx.update(groupRef, { state: 'frozen', digestJobId: digestId, frozenAt: group.frozenAt ?? now })
        return { ...current, state: 'leased', attempts, leaseOwner: workerId, leaseToken, leaseUntil }
      }
      const eventsForDigest = eventDocs.map((snap) => snap.data())
      const messageParts = renderNotificationDigestParts(eventsForDigest, 'family')
      const messageVersion = notificationMessageVersion(messageParts)
      if (!messageVersion) {
        tx.update(groupRef, { state: 'dead_letter', safeErrorCode: 'group_render_invalid', failedAt: now })
        for (const { ref } of rows) tx.update(ref, { state: 'dead_letter', safeErrorCode: 'group_render_invalid', failedAt: now })
        return null
      }
      const attempts = 1
      const leaseUntil = new Date(Date.parse(now) + leaseMs).toISOString()
      const digest = { jobId: digestId, eventId: first.eventId, event: eventsForDigest[0], eventIds, isDigest: true,
        eventJobIds: rows.map(({ row }) => row.jobId), groupId, familyId: first.familyId, personId: first.personId,
        childId: first.childId, linkId: first.linkId, telegramUserId: first.telegramUserId,
        messageVersion, messageParts, partReceipts: [], state: 'leased', attempts, nextAttemptAt: now,
        leaseOwner: workerId, leaseToken, leaseUntil, claimedAt: now }
      tx.create(digestRef, digest)
      for (const { ref } of rows) tx.update(ref, { state: 'grouped', groupedInto: digestId, groupedAt: now })
      tx.update(groupRef, { state: 'frozen', digestJobId: digestId, frozenAt: now, eventIds, eventJobIds: digest.eventJobIds })
      return digest
    })
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
        const groupingEnabled = jobRows.map((job) => Boolean(job.groupingKey && job.messageVersion === 2 && event.eventType !== 'technical.probe'))
        const groupKeys = jobRows.map((job, index) => groupingEnabled[index] ? job.groupingKey : null)
        const pointerRefs = groupKeys.map((key) => key ? groupPointers.doc(key) : null)
        const pointerSnaps = await Promise.all(pointerRefs.map((ref) => ref ? tx.get(ref) : null))
        const activeGroups = await Promise.all(pointerSnaps.map((snap) => {
          const groupId = snap?.exists ? snap.data()?.activeGroupId : null
          return groupId ? tx.get(groups.doc(groupId)) : null
        }))
        const activeMembers = await Promise.all(activeGroups.map((snap) => {
          const active = snap?.exists ? snap.data() : null
          return active?.state === 'open' ? tx.get(jobs.where('groupId', '==', active.groupId).where('state', '==', 'pending')) : null
        }))
        const verified = jobRows.map((job, index) => {
          const link = linkSnaps[index].exists ? linkSnaps[index].data() : null
          const member = memberSnaps[index].exists ? memberSnaps[index].data() : null
          return link?.status === 'active' && link.familyId === job.familyId && link.personId === job.personId
            && String(link.telegramUserId) === String(job.telegramUserId) && member?.active === true
            && member.role === 'parent' && Array.isArray(member.childIds) && member.childIds.includes(job.childId)
        })
        tx.create(eventRef, { ...event, createdAt: FieldValue.serverTimestamp() })
        for (let i = 0; i < jobRows.length; i += 1) if (verified[i] && !existingJobs[i].exists) {
          const job = jobRows[i]
          if (!groupingEnabled[i]) {
            tx.create(jobRefs[i], job)
            continue
          }
          const acceptedAt = job.groupingAt ?? event.detectedAt
          const nowMs = Date.parse(acceptedAt)
          const pointer = pointerSnaps[i].exists ? pointerSnaps[i].data() : {}
          const activeSnap = activeGroups[i]
          const active = activeSnap?.exists ? activeSnap.data() : null
          const eventBytes = Buffer.byteLength(JSON.stringify({ event, job }))
          const activeFirst = Date.parse(active?.firstEventAt ?? '')
          const activeFlush = Date.parse(active?.flushAt ?? '')
          const reusable = active?.state === 'open' && Number.isFinite(activeFirst) && Number.isFinite(activeFlush)
            && nowMs < activeFlush && nowMs < activeFirst + 60_000
            && (active.eventCount ?? 0) < 50 && (active.eventBytes ?? 0) + eventBytes <= 256 * 1024
          const groupId = reusable ? pointer.activeGroupId : `group_${createHash('sha256').update(JSON.stringify([groupKeys[i], event.eventId])).digest('hex')}`
          const groupRef = groups.doc(groupId)
          const firstEventAt = reusable ? active.firstEventAt : acceptedAt
          const flushAt = new Date(Math.min(nowMs + 30_000, Date.parse(firstEventAt) + 60_000)).toISOString()
          if (!reusable) tx.create(groupRef, { groupId, state: 'open', groupingKey: groupKeys[i],
            familyId: job.familyId, personId: job.personId, childId: job.childId, linkId: job.linkId,
            telegramUserId: job.telegramUserId, firstEventAt, lastEventAt: acceptedAt, flushAt,
            eventCount: 1, eventBytes, createdAt: acceptedAt })
          else tx.update(groupRef, { lastEventAt: acceptedAt, flushAt,
            eventCount: (active.eventCount ?? 0) + 1, eventBytes: (active.eventBytes ?? 0) + eventBytes })
          tx.set(pointerRefs[i], { activeGroupId: groupId, updatedAt: event.detectedAt }, { merge: true })
          if (reusable) for (const member of activeMembers[i]?.docs ?? []) tx.update(member.ref, { nextAttemptAt: flushAt })
          tx.create(jobRefs[i], { ...job, groupId, nextAttemptAt: flushAt, groupedAt: null })
        }
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
