import { describe, expect, it, vi } from 'vitest'
import { Readable } from 'node:stream'
import { EventEmitter } from 'node:events'
import { readProductionConfig, createProductionRequestHandler } from './production-http-runtime.mjs'

const env = { GCLOUD_PROJECT: 'education-9d7c6', OLYMPIAD_ALLOWED_ORIGINS: 'https://example.github.io', OLYMPIAD_YANDEX_DISK_TOKEN: 'fake', PORT: '8080' }
describe('production HTTP boundary', () => {
  it('requires an explicit trusted HTTPS origin and credentials and refuses emulators', () => {
    expect(readProductionConfig(env)).toMatchObject({ projectId: env.GCLOUD_PROJECT, origins: ['https://example.github.io'], port: 8080 })
    for (const bad of [
      { OLYMPIAD_ALLOWED_ORIGINS: '' }, { OLYMPIAD_ALLOWED_ORIGINS: '*' }, { OLYMPIAD_ALLOWED_ORIGINS: 'http://example.github.io' },
      { OLYMPIAD_ALLOWED_ORIGINS: 'https://localhost' }, { OLYMPIAD_ALLOWED_ORIGINS: 'https://127.0.0.1' },
      { OLYMPIAD_ALLOWED_ORIGINS: 'https://x.example/path' }, { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' },
      { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' }, { OLYMPIAD_YANDEX_DISK_TOKEN: '' }, { GCLOUD_PROJECT: 'demo-foobar' }, { PORT: '65536' },
    ]) expect(() => readProductionConfig({ ...env, ...bad })).toThrow('invalid_production_configuration')
  })
  it('enforces exact origin and emits only bounded HTTP diagnostics', async () => {
    const core = vi.fn(async () => ({ status: 200, body: { result: 'ok' } }))
    const log = vi.fn()
    const handler = createProductionRequestHandler({ handler: core, origins: ['https://example.github.io'], log })
    async function send(origin) {
      const req = Readable.from([Buffer.from(JSON.stringify({ familyId: 'sensitive' }))])
      Object.assign(req, { url: '/olympiad', method: 'POST', headers: { origin, 'content-type': 'application/json', authorization: 'Bearer secret' } })
      const res = new EventEmitter()
      res.writeHead = (status, headers) => { res.statusCode = status; res.headers = headers }
      res.end = () => res.emit('finish')
      await handler(req, res)
      return res
    }
    const good = await send('https://example.github.io')
    expect(good.statusCode).toBe(200)
    expect(good.headers['access-control-allow-origin']).toBe('https://example.github.io')
    expect((await send('https://attacker.example')).statusCode).toBe(403)
    expect(core).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/sensitive|secret|attacker|example/)
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ event: 'olympiad.http', route: 'api', status: 200 }))
  })
})
