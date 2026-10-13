import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { HelpRequestCache } from './help-request-cache.mjs'

class FakeTimestamp {
  constructor(seconds, nanoseconds = 0) { this.seconds = seconds; this.nanoseconds = nanoseconds }
  toMillis() { return this.seconds * 1000 + this.nanoseconds / 1e6 }
  toDate() { return new Date(this.toMillis()) }
}
function fakeCollection(records, readings) {
  const snapshot = (minimum = null) => {
    const docs = [...records.entries()].filter(([, data]) => !minimum
      || data.requestedAt.seconds > minimum.seconds
      || data.requestedAt.seconds === minimum.seconds && data.requestedAt.nanoseconds >= minimum.nanoseconds)
      .map(([id, data]) => ({ id, data: () => data }))
    readings.push(docs.length)
    return { docs, size: docs.length }
  }
  return {
    async get() { return snapshot() },
    where(field, operation, value) {
      expect([field, operation]).toEqual(['requestedAt', '>='])
      return { async get() { return snapshot(value) } }
    },
  }
}
const record = (second, revision = 1) => ({ requestedAt: new FakeTimestamp(second), revision, requestKind: 'step' })
const roots = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('operator help request projection', () => {
  it('uses a durable local snapshot and reads only the cursor boundary on the next cycle', async () => {
    const root = mkdtempSync(join(tmpdir(), 'education-help-cache-'))
    roots.push(root)
    const file = join(root, 'help.json')
    const records = new Map([['one', record(100)], ['two', record(101)], ['three', record(102)], ['four', record(103)]])
    const readings = []
    const collection = fakeCollection(records, readings)
    const cache = new HelpRequestCache(file, FakeTimestamp, { now: () => 200_000 })
    const first = await cache.read('studentToken', collection)
    cache.save()
    const next = new HelpRequestCache(file, FakeTimestamp, { now: () => 201_000 })
    const second = await next.read('studentToken', collection)
    expect(first).toMatchObject({ mode: 'full', fetched: 4 })
    expect(second).toMatchObject({ mode: 'delta', fetched: 1 })
    expect(second.docs.map((doc) => doc.id)).toEqual(['one', 'two', 'three', 'four'])
    expect(readings).toEqual([4, 1])
    expect((4 - second.fetched) / 4).toBeGreaterThanOrEqual(0.2)
    console.log(JSON.stringify({ scenario: 'sync-inbox/repeat-help-scan', metric: 'delivered-documents', baseline: 4,
      candidate: second.fetched, reductionPercent: 75 }))
    next.save()
    records.set('five', record(103)) // Same server timestamp as the cursor must not be skipped.
    const boundary = await new HelpRequestCache(file, FakeTimestamp, { now: () => 202_000 }).read('studentToken', collection)
    expect(boundary.docs.map((doc) => doc.id)).toContain('five')
    records.set('one', record(104, 2)) // Repeated request for an existing task replaces its prior version.
    const changed = await next.read('studentToken', collection)
    expect(changed.docs.find((doc) => doc.id === 'one').data().revision).toBe(2)
  })

  it('falls back to a full read after cache damage or audit expiry', async () => {
    const root = mkdtempSync(join(tmpdir(), 'education-help-cache-'))
    roots.push(root)
    const file = join(root, 'help.json')
    const records = new Map([['one', record(100)], ['two', record(101)]])
    const collection = fakeCollection(records, [])
    const cache = new HelpRequestCache(file, FakeTimestamp, { now: () => 200_000, fullAuditMs: 10_000 })
    await cache.read('studentToken', collection)
    cache.save()
    const expired = await new HelpRequestCache(file, FakeTimestamp, { now: () => 211_000, fullAuditMs: 10_000 }).read('studentToken', collection)
    expect(expired).toMatchObject({ mode: 'full', fetched: 2 })
    const saved = JSON.parse(readFileSync(file, 'utf8'))
    saved.owners.studentToken.entries.one.revision = 99
    writeFileSync(file, JSON.stringify(saved))
    const corrupted = await new HelpRequestCache(file, FakeTimestamp, { now: () => 201_000 }).read('studentToken', collection)
    expect(corrupted).toMatchObject({ mode: 'full', fetched: 2 })
  })
})
