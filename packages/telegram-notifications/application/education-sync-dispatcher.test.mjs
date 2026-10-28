import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { EducationSyncDispatcher, buildMessage } from './education-sync-dispatcher.mjs'

const THREAD = '01a150dc-e067-7cc2-b08f-f573bf83e6e3'

function fakeStore() {
  const state = { status: 'pending', generation: 1, requestId: 'req-1' }
  return { state, recordSourceChange: vi.fn(async () => ({ status: 'accepted' })), read: vi.fn(async () => state),
    claim: vi.fn(async ({ workerId }) => ({ requestId: state.requestId, generation: state.generation, workerId })),
    markQueued: vi.fn(async (patch) => Object.assign(state, { status: 'queued', ...patch })),
    markUncertain: vi.fn(async (patch) => Object.assign(state, { status: 'uncertain', ...patch })),
    fail: vi.fn(async () => ({ status: 'pending' })),
    claimRequest: vi.fn(async () => ({ status: 'claimed' })),
  }
}

describe('EducationSyncDispatcher', () => {
  it('uses absolute executable and argv-only generic request; exit zero is queued, not complete', async () => {
    const store = fakeStore()
    const child = new EventEmitter()
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = vi.fn()
    let childOptions
    const spawnProcess = vi.fn((path, args, options) => {
      expect(path).toBe('/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex')
      expect(args).toContain('--thread')
      expect(args).toContain(THREAD)
      expect(args.join(' ')).not.toContain('child name')
      expect(options.shell).toBe(false)
      childOptions = options
      queueMicrotask(() => child.emit('close', 0))
      return child
    })
    const dispatcher = new EducationSyncDispatcher({ store, threadId: THREAD,
      codexPath: '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex', spawnProcess,
      projectRoot: '/workspace/PETR',
      env: { PATH: '/bin', CODEX_HOME: '/Users/test/.codex', AGI_EDU_BOT: 'secret', TELEGRAM_TOKEN_FILE: '/private/token',
        GOOGLE_APPLICATION_CREDENTIALS: '/private/adc.json', AWS_ACCESS_KEY_ID: 'secret-id' },
      clock: () => new Date('2026-10-19T10:00:00Z') })
    expect(await dispatcher.dispatchDue()).toEqual({ status: 'queued', requestId: 'req-1' })
    expect(store.markQueued).toHaveBeenCalledWith({ requestId: 'req-1', workerId: expect.any(String), now: '2026-10-19T10:00:00.000Z' })
    expect(childOptions.env).toMatchObject({ PATH: '/bin', CODEX_HOME: '/Users/test/.codex' })
    expect(childOptions.env).not.toHaveProperty('AGI_EDU_BOT')
    expect(childOptions.env).not.toHaveProperty('TELEGRAM_TOKEN_FILE')
    expect(childOptions.env).not.toHaveProperty('GOOGLE_APPLICATION_CREDENTIALS')
    expect(childOptions.env).not.toHaveProperty('AWS_ACCESS_KEY_ID')
  })

  it('preserves ambiguous CLI outcomes as uncertain with stable request id', async () => {
    const store = fakeStore()
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = vi.fn()
    const dispatcher = new EducationSyncDispatcher({ store, threadId: THREAD, codexPath: '/opt/codex',
      projectRoot: '/workspace/PETR',
      spawnProcess: () => { queueMicrotask(() => child.emit('close', 1)); return child } })
    expect(await dispatcher.dispatchDue()).toEqual({ status: 'uncertain', requestId: 'req-1', code: 'codex_exit_nonzero' })
    expect(store.markUncertain).toHaveBeenCalledWith({ requestId: 'req-1', workerId: expect.any(String), now: expect.any(String), code: 'codex_exit_nonzero' })
  })

  it('waits through TERM and KILL before fencing a hung CLI attempt as uncertain', async () => {
    const store = fakeStore()
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = vi.fn()
    const dispatcher = new EducationSyncDispatcher({ store, threadId: THREAD, codexPath: '/opt/codex', projectRoot: '/workspace/PETR',
      timeoutMs: 5, terminationGraceMs: 5, forcedSettlementMs: 15, spawnProcess: () => child })
    expect(await dispatcher.dispatchDue()).toEqual({ status: 'uncertain', requestId: 'req-1', code: 'codex_timeout' })
    expect(child.kill.mock.calls.map(([signal]) => signal)).toEqual(['SIGTERM', 'SIGKILL'])
    expect(store.markUncertain).toHaveBeenCalledOnce()
  })

  it('rejects output overflow even when the CLI exits successfully', async () => {
    const store = fakeStore()
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = vi.fn()
    const dispatcher = new EducationSyncDispatcher({ store, threadId: THREAD, codexPath: '/opt/codex', projectRoot: '/workspace/PETR',
      maxOutputBytes: 4, spawnProcess: () => { queueMicrotask(() => { child.stdout.emit('data', Buffer.from('too much')); child.emit('close', 0) }); return child } })
    expect(await dispatcher.dispatchDue()).toEqual({ status: 'uncertain', requestId: 'req-1', code: 'codex_output_limit' })
    expect(store.markUncertain).toHaveBeenCalledOnce()
    expect(store.markQueued).not.toHaveBeenCalled()
  })

  it('retries a definite missing executable without losing the claimed request', async () => {
    const store = fakeStore()
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = vi.fn()
    const dispatcher = new EducationSyncDispatcher({ store, threadId: THREAD, codexPath: '/missing/codex', projectRoot: '/workspace/PETR',
      spawnProcess: () => { queueMicrotask(() => child.emit('error', Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))); return child } })
    expect(await dispatcher.dispatchDue()).toEqual({ status: 'retry', requestId: 'req-1', code: 'codex_spawn_failed' })
    expect(store.fail).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'req-1', workerId: expect.any(String) }))
  })

  it('stores the bounded official queue receipt identifier', async () => {
    const store = fakeStore()
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = vi.fn()
    const receipt = '01a153c7-f8c9-7cc3-bf13-59b8643f75d2'
    const dispatcher = new EducationSyncDispatcher({ store, threadId: THREAD, codexPath: '/opt/codex', projectRoot: '/workspace/PETR',
      spawnProcess: () => { queueMicrotask(() => { child.stdout.emit('data', Buffer.from(`Queued message ${receipt}\n`)); child.emit('close', 0) }); return child } })
    expect(await dispatcher.dispatchDue()).toMatchObject({ status: 'queued' })
    expect(store.markQueued).toHaveBeenCalledWith(expect.objectContaining({ workerId: expect.any(String), queueReceiptId: receipt }))
  })

  it('does not interpolate source values into the queued prompt', () => {
    const message = buildMessage('req-1', '/workspace/PETR/scripts/education-sync-dispatch.mjs')
    expect(message).toContain('$education-sync')
    expect(message).toContain('req-1')
    expect(message).toContain(`'${process.execPath}' '/workspace/PETR/scripts/education-sync-dispatch.mjs'`)
    expect(message).toContain('block --request req-1')
    expect(message).toContain('--reason permission_required')
    expect(message).not.toContain('familyId')
    expect(message).not.toContain('GOOGLE_APPLICATION_CREDENTIALS')
    expect(message).not.toContain('TELEGRAM_FIRESTORE_PROJECT_ID=')
  })

  it.each([
    ['work-only event', ['work'], {}],
    ['independent action lane', ['action'], { actionAfterGeneration: 18, actionThroughGeneration: 43 }],
    ['Mesh event', ['mesh'], {}],
  ])('requires a full source check for every %s dispatch', (_label, workKinds, batch) => {
    const message = buildMessage('req-work', '/workspace/PETR/scripts/education-sync-dispatch.mjs', workKinds, batch)
    expect(message).toContain('full verification mode for every dispatch')
    expect(message).toContain('full inbox snapshot')
    expect(message).toContain('complete 42-day Mesh collection')
    expect(message).toContain('Never skip this because a prior sync or Rules/PWA update was recent')
    expect(message).not.toContain('do not run full project.collect')
    if (batch.actionThroughGeneration) expect(message).toContain('Do not broaden the event range; the full inbox and Mesh collection are still required')
  })
})

it('independent Firebase dispatch explicitly proceeds without waiting for Mesh', () => {
  const msg = buildMessage('req-action', '/workspace/scripts/education-sync-dispatch.mjs', ['action'], { independentSourceBlock: true })
  expect(msg).toContain('independently')
  expect(msg).toContain('unrelated Mesh source is blocked')
  expect(msg).not.toContain('complete 42-day Mesh collection')
  expect(msg).toContain('tasks --request req-action')
})
