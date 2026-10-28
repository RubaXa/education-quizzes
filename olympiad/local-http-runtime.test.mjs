import { describe, expect, it, vi } from 'vitest'
import { Readable } from 'node:stream'
import { createEmulatorOlympiadServer, createLocalOlympiadRequestHandler } from './local-http-runtime.mjs'
import { createOlympiadHttpHandler } from './http-handler.mjs'
import { createHash } from 'node:crypto'

function request(handler, { method = 'POST', url = '/olympiad', headers = {}, body = '{}' } = {}) {
  const req = Readable.from([Buffer.from(body)])
  Object.assign(req, { method, url, headers })
  const result = {}
  const res = { writeHead(status, h) { result.status = status; result.headers = h }, end(data) { result.body = Buffer.isBuffer(data) ? data : JSON.parse(data) } }
  return handler(req, res).then(() => result)
}
const origin = 'http://localhost:5173'
const headers = { origin, 'content-type': 'application/json', authorization: 'Bearer valid' }
describe('emulator-only local HTTP boundary', () => {
  it('permits only configured local origins, POST JSON and narrow preflight', async () => {
    const core = vi.fn(async () => ({ status: 200, body: { result: 'ok' } }))
    const h = createLocalOlympiadRequestHandler({ handler: core, origins: [origin] })
    expect((await request(h, { headers })).status).toBe(200)
    expect((await request(h, { headers: { ...headers, origin: 'https://attacker.example' } })).status).toBe(403)
    expect((await request(h, { headers: { ...headers, origin: undefined } })).status).toBe(403)
    expect((await request(h, { headers: { ...headers, 'content-type': 'text/plain' } })).status).toBe(415)
    expect((await request(h, { method: 'GET', headers })).status).toBe(405)
    expect((await request(h, { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization, content-type' } })).status).toBe(204)
    expect((await request(h, { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'x-unsafe' } })).status).toBe(403)
    expect(core).toHaveBeenCalledTimes(1)
  })
  it('rejects malformed and oversized bodies before reaching service', async () => {
    const core = vi.fn()
    const h = createLocalOlympiadRequestHandler({ handler: core, origins: [origin] })
    expect((await request(h, { headers, body: '{' })).status).toBe(400)
    expect((await request(h, { headers, body: 'x'.repeat(65537) })).status).toBe(413)
    expect(core).not.toHaveBeenCalled()
  })
  it('accepts bounded binary uploads, delivers private binary images, and rejects invalid metadata', async () => {
    const image = Buffer.from([255, 216, 255, 1])
    const core = vi.fn(async ({ body, bytes, transport }) => body.action === 'photo-read'
      ? { status: 200, binary: image, contentType: 'image/jpeg' }
      : { status: 200, body: { result: { size: bytes.length, transport } } })
    const h = createLocalOlympiadRequestHandler({ handler: core, origins: [origin] })
    const metadata = { action: 'photo-upload', request: { receiptId: 'photo' } }
    const photoHeaders = { ...headers, 'content-type': 'application/octet-stream', 'x-olympiad-photo': JSON.stringify(metadata) }
    expect((await request(h, { method: 'OPTIONS', url: '/olympiad/photo', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'authorization, content-type, x-olympiad-photo' } })).status).toBe(204)
    const upload = await request(h, { url: '/olympiad/photo', headers: photoHeaders, body: image })
    expect(upload.body.result).toEqual({ size: 4, transport: 'binary' })
    const read = await request(h, { url: '/olympiad/photo', headers: { ...photoHeaders, 'x-olympiad-photo': JSON.stringify({ ...metadata, action: 'photo-read' }) }, body: '' })
    expect(read.body).toEqual(image)
    expect(read.headers).toMatchObject({ 'content-type': 'image/jpeg', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
    expect((await request(h, { url: '/olympiad/photo', headers: photoHeaders, body: Buffer.alloc(25_000_001) })).status).toBe(413)
    expect((await request(h, { url: '/olympiad/photo', headers: { ...photoHeaders, 'x-olympiad-photo': '{' }, body: image })).status).toBe(400)
    expect((await request(h, { url: '/olympiad/photo', headers: { ...photoHeaders, 'x-olympiad-photo': JSON.stringify({ ...metadata, action: 'photo-read' }) }, body: image })).status).toBe(400)
    expect(core).toHaveBeenCalledTimes(2)
  })
  it('runs authenticated photo upload and download across the HTTP, transaction and private storage boundaries', async () => {
    const base = 'families/f/children/c/olympiads/o', token = 'a'.repeat(43), docs = new Map(Object.entries({
      'deviceSessions/u': { linkToken: token }, [`accessLinks/${token}`]: { active: true, personId: 'p' },
      'families/f': { active: true }, 'families/f/children/c': { active: true, olympiadEligibility: { verified: true, grade: 6 } },
      'families/f/members/p': { active: true, role: 'student', childIds: ['c'] },
      [base]: { active: true, participationEnabled: true, allowedProblemIds: ['task'] },
      'olympiadCatalog/o': { status: 'published', practiceOnly: true, gradeLevels: [6], allowedProblemIds: ['task'] },
      'olympiadMaterials/o/problems/task': { status: 'published', practiceOnly: true },
    }))
    const db = { doc: path => ({ path }), runTransaction: async run => run({ get: async ref => ({ exists: docs.has(ref.path), data: () => docs.get(ref.path) }),
      set: (ref, value) => docs.set(ref.path, value), update: (ref, value) => docs.set(ref.path, { ...docs.get(ref.path), ...value }) }) }
    const stored = new Map(), storage = { putAt: async (path, bytes) => { stored.set(path, bytes); return { provider: 'yandex-disk', path, size: bytes.length } },
      head: async path => ({ type: 'file', size: stored.get(path).length, md5: createHash('md5').update(stored.get(path)).digest('hex') }),
      getAt: async path => stored.get(path) }
    const core = createOlympiadHttpHandler({ db, photoStorage: storage, auth: { verifyIdToken: async token => { if (token !== 'valid') throw Error(); return { uid: 'u' } } } })
    const h = createLocalOlympiadRequestHandler({ handler: core, origins: [origin] })
    const scope = { familyId: 'f', childId: 'c', olympiadId: 'o', problemId: 'task', receiptId: 'pic', mime: 'image/jpeg', uid: 'fake' }
    const picture = Buffer.from([255,216,255,10])
    const photoHeaders = { ...headers, 'content-type': 'application/octet-stream', 'x-olympiad-photo': JSON.stringify({ action: 'photo-upload', request: scope }) }
    expect((await request(h, { url: '/olympiad/photo', headers: photoHeaders, body: picture })).body.result.photoId).toBe('pic')
    const readHeaders = { ...photoHeaders, 'x-olympiad-photo': JSON.stringify({ action: 'photo-read', request: { ...scope, photoId: 'pic' } }) }
    expect((await request(h, { url: '/olympiad/photo', headers: readHeaders, body: '' })).body).toEqual(picture)
    docs.get('families/f/members/p').active = false
    expect((await request(h, { url: '/olympiad/photo', headers: readHeaders, body: '' })).status).toBe(404)
  })
  it('refuses non-local origins, real projects and production Firebase endpoints', () => {
    expect(() => createLocalOlympiadRequestHandler({ handler: () => {}, origins: ['https://example.com'] })).toThrow()
    expect(() => createEmulatorOlympiadServer({ projectId: 'production', origins: [origin], env: {} })).toThrow('local_emulators_required')
    expect(() => createEmulatorOlympiadServer({ projectId: 'demo-local', origins: [origin], env: {} })).toThrow('local_emulators_required')
  })
})
