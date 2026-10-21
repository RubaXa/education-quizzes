import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const code = readFileSync(new URL('./sync-queue.mjs', import.meta.url), 'utf8')
const body = code.slice(code.indexOf('async function verifiedResolution(record) {'), code.indexOf('\nasync function ', code.indexOf('async function verifiedResolution(record) {') + 1))
const resolveRecord = new Function('db', `${body}; return verifiedResolution`)

describe('queue resolution across source formats', () => {
  it.each(['review-work', 'review-quiz', 'transfer-work'])('leaves %s event artifacts for their addressed executor without querying legacy coordinates', async (kind) => {
    const db = new Proxy({}, { get() { throw new Error('legacy Firestore query must not run') } })
    await expect(resolveRecord(db)({ kind, artifactPath: 'operatorSyncTaskArtifacts/artifact', source: { eventId: 'event' } })).resolves.toBeNull()
  })
})
