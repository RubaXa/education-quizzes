import { describe, expect, it } from 'vitest'
import { resolvedStoragePause } from './storage-pause.mjs'

const stored = { status: 'pending', storage: { provider: 'yandex-disk', state: 'stored', publicUrl: 'https://disk.example/photo' } }
const paused = { phase: 'paused', blocker: 'storage', uploadIds: ['first', 'second'] }

describe('storage pause', () => {
  it('clears only when every original is stored and Firestore bytes are gone', () => {
    expect(resolvedStoragePause(paused, new Map([['first', stored], ['second', stored]]))).toBe(true)
    expect(resolvedStoragePause(paused, new Map([['first', stored], ['second', { ...stored, dataUrl: 'data:image/png;base64,AA==' }]]))).toBe(false)
    expect(resolvedStoragePause(paused, new Map([['first', stored]]))).toBe(false)
  })

  it('does not clear an unrelated pause', () => {
    expect(resolvedStoragePause({ ...paused, blocker: 'source' }, new Map([['first', stored], ['second', stored]]))).toBe(false)
    expect(resolvedStoragePause({ ...paused, phase: 'review' }, new Map([['first', stored], ['second', stored]]))).toBe(false)
  })

  it('recognizes the existing storage pause without a blocker field', () => {
    const previous = { phase: 'paused', uploadIds: ['first'], reason: 'Не удалось перенести именно этот снимок из Firebase в семейный архив Яндекс.Диска.' }
    expect(resolvedStoragePause(previous, new Map([['first', stored]]))).toBe(true)
  })
})
