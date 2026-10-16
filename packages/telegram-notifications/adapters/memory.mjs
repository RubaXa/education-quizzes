import { randomBytes } from 'node:crypto'

/** @see ../../../docs/services/telegram-bot/event-ledger-outbox.md#состояния @see ../../../docs/services/telegram-bot/identity-and-linking.md#состояния @see ../../../docs/services/telegram-bot/ports-and-events.md#контракт-портов */
export function createMemoryStore() {
  const accounts = new Map(), links = new Map(), challenges = new Map(), events = new Map(), jobs = new Map()
  const registry = {
    async registerAccount(account) {
      const previous = accounts.get(account.senderId)
      accounts.set(account.senderId, { ...previous, ...account, status: previous?.status ?? 'registered' })
      return { ...accounts.get(account.senderId) }
    },
    async recordChannelUpdate({ senderId, status, updateId, observedAt }) {
      if (!Number.isSafeInteger(updateId) || !Number.isSafeInteger(observedAt)) return { updated: false }
      const occurredAt = new Date(observedAt).toISOString()
      const account = accounts.get(senderId) ?? { telegramUserId: senderId, username: '', firstName: '', status: 'registered', createdAt: occurredAt, updatedAt: occurredAt }
      if (!accounts.has(senderId)) accounts.set(senderId, account)
      const telegramIdReset = Number.isSafeInteger(account.lastChannelUpdateId) && Number.isSafeInteger(account.lastChannelUpdateAt)
        && observedAt >= account.lastChannelUpdateAt + 7 * 24 * 60 * 60_000
      if (Number.isSafeInteger(account.lastChannelUpdateId) && updateId <= account.lastChannelUpdateId && !telegramIdReset) return { updated: false }
      if (Number.isSafeInteger(account.lastChannelUpdateAt) && observedAt < account.lastChannelUpdateAt) return { updated: false }
      if (account.channelStatusSource === 'delivery_failure' && Number.isSafeInteger(account.channelStatusChangedAt) && observedAt <= account.channelStatusChangedAt) return { updated: false }
      account.channelStatus = status
      account.channelStatusChangedAt = observedAt
      account.channelStatusSource = 'telegram_update'
      account.channelStatusVersion = (account.channelStatusVersion ?? 0) + 1
      account.lastChannelUpdateId = updateId
      account.lastChannelUpdateAt = observedAt
      account.updatedAt = occurredAt
      return { updated: true, state: status, version: account.channelStatusVersion }
    },
    async markChannelUnavailable({ senderId, attemptStartedAt, expectedVersion }) {
      const account = accounts.get(senderId)
      if (!account) return { applied: false, state: 'unavailable', version: 0 }
      const version = account.channelStatusVersion ?? 0
      const state = account.channelStatus ?? 'available'
      if (version !== expectedVersion || (Number.isSafeInteger(account.channelStatusChangedAt) && account.channelStatusChangedAt > attemptStartedAt)) return { applied: false, state, version }
      account.channelStatus = 'unavailable'
      account.channelStatusChangedAt = attemptStartedAt
      account.channelStatusSource = 'delivery_failure'
      account.channelStatusVersion = version + 1
      return { applied: true, state: 'unavailable', version: version + 1 }
    },
    async listActiveLinks(senderId) { return [...links.values()].filter((link) => link.telegramUserId === senderId && link.status === 'active') },
    async createStopChallenge(challenge) { challenges.set(challenge.tokenHash, { ...challenge, usedAt: null }) },
    async consumeStopChallenge({ tokenHash, senderId, now }) {
      const c = challenges.get(tokenHash)
      if (!c || c.senderId !== senderId || c.usedAt || c.expiresAt <= now) return { code: 'invalid_confirmation' }
      c.usedAt = now
      const link = links.get(c.linkId)
      if (!link || link.telegramUserId !== senderId || link.status !== 'active') return { code: 'link_unavailable' }
      link.status = 'disconnected'; link.disconnectedAt = now
      return { code: 'disconnected' }
    },
  }
  const channel = {
    async getState(senderId) {
      const account = accounts.get(String(senderId))
      if (!account) return { status: 'unavailable', version: 0, exists: false }
      return { status: account.channelStatus ?? 'available', version: account.channelStatusVersion ?? 0, exists: true }
    },
    async isAvailable(senderId) { return (await this.getState(senderId)).status === 'available' },
    async confirmReachable({ senderId, updateId, observedAt }) { return registry.recordChannelUpdate({ senderId, status: 'available', updateId, observedAt }) },
    async markUnavailable(input) { return registry.markChannelUnavailable(input) },
    async setStatusForTest(senderId, status, at) { const account = accounts.get(senderId); account.channelStatus = status; account.channelStatusChangedAt = at; account.channelStatusVersion = (account.channelStatusVersion ?? 0) + 1 },
  }
  const outbox = {
    async enqueue(rows) { for (const row of rows) if (!jobs.has(row.jobId)) jobs.set(row.jobId, structuredClone(row)) },
    async claim({ workerId, now, leaseMs, maxAttempts = 8 }) {
      const ready = [...jobs.values()].filter((j) => (j.state === 'pending' || j.state === 'retry_wait') && j.nextAttemptAt <= now).sort((a, b) => a.nextAttemptAt.localeCompare(b.nextAttemptAt))
      const row = ready.find((item) => (item.attempts ?? 0) < maxAttempts)
      for (const exhausted of ready.filter((item) => (item.attempts ?? 0) >= maxAttempts)) Object.assign(exhausted, { state: 'dead_letter', safeErrorCode: 'retry_limit_reached' })
      if (!row) return null
      Object.assign(row, { state: 'leased', attempts: row.attempts + 1, leaseOwner: workerId, leaseToken: randomBytes(32).toString('base64url'), leaseUntil: new Date(new Date(now).valueOf() + leaseMs).toISOString() })
      return structuredClone(row)
    },
    async finish({ jobId, workerId, leaseToken, result, now = new Date().toISOString() }) { const row = owned(jobId, workerId, leaseToken, now); Object.assign(row, result, { leaseOwner: null, leaseToken: null, leaseUntil: null, finishedAt: now }) },
    async reschedule({ jobId, workerId, leaseToken, attempts, nextAttemptAt, safeErrorCode, now = new Date().toISOString() }) { const row = owned(jobId, workerId, leaseToken, now); Object.assign(row, { state: 'retry_wait', attempts, nextAttemptAt, safeErrorCode, leaseOwner: null, leaseToken: null, leaseUntil: null }) },
    async renew({ jobId, workerId, leaseToken, now, leaseMs }) { const row = owned(jobId, workerId, leaseToken, now); row.leaseUntil = new Date(Date.parse(now) + leaseMs).toISOString() },
    async savePartReceipt({ jobId, workerId, leaseToken, index, receipt, now, leaseMs }) {
      const row = owned(jobId, workerId, leaseToken, now)
      row.partReceipts ??= []
      if (index < row.partReceipts.length) return
      if (index !== row.partReceipts.length) throw new Error('part_order_invalid')
      row.partReceipts.push(receipt)
      row.leaseUntil = new Date(Date.parse(now) + leaseMs).toISOString()
    },
    async recoverExpired(now, { maxAttempts = 8, recoveryDelayMs = 1_000 } = {}) { for (const row of jobs.values()) if (row.state === 'leased' && row.leaseUntil <= now) Object.assign(row, row.attempts >= maxAttempts ? { state: 'dead_letter', safeErrorCode: 'retry_limit_reached', leaseOwner: null, leaseToken: null, leaseUntil: null } : { state: 'retry_wait', nextAttemptAt: new Date(Date.parse(now) + recoveryDelayMs).toISOString(), safeErrorCode: 'worker_lease_expired', leaseOwner: null, leaseToken: null, leaseUntil: null }) },
  }
  function owned(id, workerId, leaseToken, now) { const row = jobs.get(id); if (!row || row.state !== 'leased' || row.leaseOwner !== workerId || row.leaseToken !== leaseToken || row.leaseUntil <= now) { const error = new Error('stale_lease'); error.safeCode = 'stale_lease'; throw error } return row }
  return {
    registry, channel, outbox, events, jobs, links, accounts,
    eventLedger: { async recordIfAbsent({ event, jobs: jobRows }) { if (events.has(event.eventId)) return { created: false, eventId: event.eventId }; events.set(event.eventId, structuredClone(event)); const queued = jobRows.filter((job) => !jobs.has(job.jobId)).length; await outbox.enqueue(jobRows); return { created: true, eventId: event.eventId, queued } } },
    addActiveLink(link) { links.set(link.linkId, { status: 'active', ...link }) },
  }
}
