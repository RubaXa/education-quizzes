import { describe, expect, it } from 'vitest'
import { WriteQueue } from './writeQueue'

describe('draft write ordering', () => {
  it('waits for the first network write before starting the next and before submit', async () => {
    const queue = new WriteQueue()
    const events: string[] = []
    let finishFirst: (() => void) | undefined
    const first = queue.add(() => new Promise<void>((resolve) => {
      events.push('first started')
      finishFirst = resolve
    }))
    const second = queue.add(async () => { events.push('second started') })
    await Promise.resolve()
    await Promise.resolve()
    expect(events).toEqual(['first started'])
    finishFirst?.()
    await Promise.all([first, second, queue.settled()])
    expect(events).toEqual(['first started', 'second started'])
  })

  it('allows a later full snapshot to recover after a failed write', async () => {
    const queue = new WriteQueue()
    const first = queue.add(async () => { throw new Error('offline') })
    const second = queue.add(async () => {})
    await expect(first).rejects.toThrow('offline')
    await expect(second).resolves.toBeUndefined()
  })
})
