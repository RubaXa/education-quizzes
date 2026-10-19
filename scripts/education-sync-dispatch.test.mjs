import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { main } from './education-sync-dispatch.mjs'

const REQUEST = '01a150dc-e067-7cc2-b08f-f573bf83e6e3'

function output() { let value = ''; return { write: (part) => { value += part }, value: () => value } }

describe('education sync dispatch CLI', () => {
  it('claims into a private file and completes only with its matching token', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'education-sync-claim-'))
    let out = output()
    const err = output()
    const store = {
      claimRequest: vi.fn(async ({ tokenHash }) => { store.tokenHash = tokenHash; return { status: 'claimed' } }),
      completeClaim: vi.fn(async ({ tokenHash }) => ({ status: tokenHash === store.tokenHash ? 'completed' : 'invalid_claim' })),
      failClaim: vi.fn(), heartbeatClaim: vi.fn(), read: vi.fn(),
    }
    const createDb = vi.fn(() => ({ terminate: vi.fn(async () => {}) }))
    const deps = { env: { TELEGRAM_FIRESTORE_PROJECT_ID: 'petr-education', EDUCATION_SYNC_PROJECT_ROOT: root }, cwd: root,
      out, err, createDb, createStore: () => store }
    try {
      expect(await main(['claim', '--request', REQUEST], deps)).toBe(0)
      const claimPath = JSON.parse(out.value()).claimPath
      expect(claimPath).toBe(resolve(root, '.local/education-sync-dispatch/claims', `${REQUEST}.json`))
      expect(statSync(claimPath).mode & 0o077).toBe(0)
      const claim = JSON.parse(readFileSync(claimPath, 'utf8'))
      expect(claim.token).toBeTruthy()
      out = output()
      expect(await main(['complete', '--request', REQUEST, '--claim-file', claimPath], deps)).toBe(0)
      expect(store.completeClaim).toHaveBeenCalledWith(expect.objectContaining({ requestId: REQUEST, tokenHash: store.tokenHash }))
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('terminates Firestore on invalid commands and does not echo unsafe errors', async () => {
    const db = { terminate: vi.fn(async () => {}) }
    const out = output(), err = output()
    const code = await main(['complete', '--request', 'bad'], { env: { TELEGRAM_FIRESTORE_PROJECT_ID: 'petr-education' },
      createDb: () => db, createStore: () => ({}), out, err })
    expect(code).toBe(1)
    expect(db.terminate).toHaveBeenCalledOnce()
    expect(err.value()).toBe('usage_invalid\n')
  })

  it('uses the script checkout root when invoked from a parent working directory', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'education-sync-root-'))
    const out = output()
    const db = { terminate: vi.fn(async () => {}) }
    try {
      await main(['status'], { env: { TELEGRAM_FIRESTORE_PROJECT_ID: 'petr-education' },
        cwd: '/Users/example/Documents/ChatGPT/PETR', scriptRoot: root,
        createDb: (options) => { expect(options.cwd).toBe(root); return db },
        createStore: () => ({ read: async () => null }), out, err: output() })
      expect(out.value()).toContain('"status":"idle"')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('supports an explicit permission block and operator resume without a new request id', async () => {
    const root = mkdtempSync(resolve(tmpdir(), 'education-sync-block-'))
    const out = output(), err = output()
    const store = {
      claimRequest: vi.fn(async () => ({ status: 'claimed' })),
      blockClaim: vi.fn(async ({ requestId, reasonCode }) => ({ status: 'blocked', requestId, reasonCode })),
      resumeBlocked: vi.fn(async ({ requestId }) => ({ status: 'pending', requestId })),
      read: vi.fn(),
    }
    const deps = { env: { TELEGRAM_FIRESTORE_PROJECT_ID: 'petr-education', EDUCATION_SYNC_PROJECT_ROOT: root },
      out, err, createDb: () => ({ terminate: vi.fn(async () => {}) }), createStore: () => store }
    try {
      await main(['claim', '--request', REQUEST], deps)
      const claimPath = JSON.parse(out.value()).claimPath
      await main(['block', '--request', REQUEST, '--claim-file', claimPath, '--reason', 'permission_required'], deps)
      expect(store.blockClaim).toHaveBeenCalledWith(expect.objectContaining({ requestId: REQUEST, reasonCode: 'permission_required' }))
      out.value = () => ''
      expect(await main(['resume', '--request', REQUEST], deps)).toBe(0)
      expect(store.resumeBlocked).toHaveBeenCalledWith(expect.objectContaining({ requestId: REQUEST }))
      expect(err.value()).toBe('')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
