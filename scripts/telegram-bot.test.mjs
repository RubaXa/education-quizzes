import { describe, expect, it } from 'vitest'
import { parseWorkerFlags } from './telegram-bot.mjs'
import { loadConfig } from '../packages/telegram-notifications/adapters/config.mjs'

describe('telegram worker flags and technical settings', () => {
  it('keeps all source and delivery switches off by default', () => {
    expect(parseWorkerFlags([])).toEqual({ enableDelivery: false, enableFirestoreSource: false, enableMeshSource: false })
  })

  it('accepts each explicit worker flag once', () => {
    expect(parseWorkerFlags(['--enable-firestore-source', '--enable-mesh-source', '--enable-delivery']))
      .toEqual({ enableDelivery: true, enableFirestoreSource: true, enableMeshSource: true })
  })

  it('fails closed on unknown and duplicate flags', () => {
    expect(() => parseWorkerFlags(['--source-config', '/tmp/config.json'])).toThrow('worker_flag_unknown')
    expect(() => parseWorkerFlags(['--enable-firestore-source', '--enable-firestore-source'])).toThrow('worker_flag_duplicate')
  })

  it('validates technical bounds without family or child allowlists', () => {
    const config = loadConfig({ AGI_EDU_BOT: '123456:abcdefghijklmnopqrstuvwxyz', TELEGRAM_FIRESTORE_PROJECT_ID: 'education-prod' })
    expect(config.sourcePageSize).toBe(250)
    expect(config.sourceConcurrency).toBe(4)
    expect(config.sourceReconcileMs).toBe(30_000)
    expect(config.meshPollMs).toBe(900_000)
    expect(config.meshConnectionDirectory).toBe('.local/mesh-connections')
    expect(() => loadConfig({ AGI_EDU_BOT: '123456:abcdefghijklmnopqrstuvwxyz', TELEGRAM_FIRESTORE_PROJECT_ID: 'education-prod', TELEGRAM_SOURCE_PAGE_SIZE: '1001' }))
      .toThrow('source_page_size_invalid')
  })
})
