import { randomBytes } from 'node:crypto'

/** @see ../../../docs/services/telegram-bot/event-ledger-outbox.md#состояния */
export function createMemoryStore() {
  const accounts = new Map(), links = new Map(), challenges = new Map(), events = new Map(), jobs = new Map()
  const registry = {
    async registerAccount(account) {
      const previous = accounts.get(account.senderId)
      accounts.set(account.senderId, { ...previous, ...account, status: previous?.status ?? 'registered' })
      return { ...accounts.get(account.senderId) }
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
    registry, outbox, events, jobs, links,
    eventLedger: { async recordIfAbsent({ event, jobs: jobRows }) { if (events.has(event.eventId)) return { created: false, eventId: event.eventId }; events.set(event.eventId, structuredClone(event)); await outbox.enqueue(jobRows); return { created: true, eventId: event.eventId } } },
    addActiveLink(link) { links.set(link.linkId, { status: 'active', ...link }) },
  }
}
