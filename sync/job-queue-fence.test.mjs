import { expect, it } from 'vitest'
import { setSyncJob } from './job-queue.mjs'

it('does not close a job if the source revision changed after resolution was read', async () => {
  const oldFingerprint = 'a'.repeat(64), current = { status: 'queued', fingerprint: 'b'.repeat(64) }
  let writes = 0
  const db = { doc: path => ({ path }), runTransaction: async run => run({
    get: async () => ({ exists: true, data: () => current }),
    update: () => { writes++ },
  }) }
  await expect(setSyncJob(db, '1'.repeat(64), 'done', 'verified', { evidence: 'readback', expectedFingerprint: oldFingerprint })).rejects.toThrow('sync-job-revision-changed')
  expect(writes).toBe(0)
})
