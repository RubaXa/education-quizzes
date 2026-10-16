import { describe, expect, it } from 'vitest'
import { assertReviewReadback } from './review-readback.mjs'

const fixture = () => ({ entries: [{ taskId: 'mesh-1', status: 'verified' }], planRevision: 3,
  privateDocs: [{ taskId: 'mesh-1', status: 'verified', planRevision: 3 }],
  publicDocs: [{ taskId: 'mesh-1', status: 'verified', planRevision: 3 }],
  uploads: [{ status: 'reviewed' }] })

describe('review publication readback', () => {
  it('verifies a source receipt in both roles without a homework grade', () => {
    const entry={taskId:'mesh-notes',purpose:'source-material',sourceAnalysis:{requestId:'notes-1',topic:'Баллада'}}
    const doc={...entry,planRevision:3}
    const data={entries:[entry],planRevision:3,privateDocs:[doc],publicDocs:[doc],uploads:[{status:'reviewed'}]}
    expect(assertReviewReadback(data).verified).toBe(true)
    expect(()=>assertReviewReadback({...data,publicDocs:[{...doc,sourceAnalysis:{...entry.sourceAnalysis,topic:'Другая тема'}}]})).toThrow('Source material publication differs')
    expect(()=>assertReviewReadback({...data,publicDocs:[{...doc,status:'verified'}]})).toThrow('differs')
  })
  it('accepts exactly the published expert, learner, and upload states', () => {
    expect(assertReviewReadback(fixture())).toEqual({ reviewedTasks: 1, reviewedUploads: 1, verified: true })
  })
  it('rejects a stale learner projection or missing upload update', () => {
    const stale = fixture(); stale.publicDocs[0].status = 'partial'
    expect(() => assertReviewReadback(stale)).toThrow('differs')
    const upload = fixture(); upload.uploads[0].status = 'pending'
    expect(() => assertReviewReadback(upload)).toThrow('not read back')
  })
})
