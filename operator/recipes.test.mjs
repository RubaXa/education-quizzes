import { describe, expect, it } from 'vitest'
import { executeRecipe } from './recipes.mjs'

describe('operator discovery and final reconciliation', () => {
  it('gets one fresh inbox through queue scan at each boundary', async () => {
    const calls = []
    const run = async ({ operation }) => {
      calls.push(operation)
      return { operation, summary: { inbox: { complete: true } } }
    }
    await executeRecipe('discover', run)
    await executeRecipe('finalize', run)
    expect(calls).toEqual(['queue.scan', 'project.plan', 'queue.scan'])
    expect(calls).not.toContain('inbox.snapshot')
  })

  it('does not call an incomplete snapshot empty or proceed after it', async () => {
    const calls = []
    await expect(executeRecipe('discover', async ({ operation }) => {
      calls.push(operation)
      return { summary: { inbox: { complete: false } }, journal: 'private-receipt' }
    })).rejects.toThrow('inbox is incomplete')
    expect(calls).toEqual(['queue.scan'])
  })

  it('keeps status read-only and obtains its own direct inbox snapshot', async () => {
    const calls = []
    await executeRecipe('status', async ({ operation }) => {
      calls.push(operation)
      return { summary: { complete: true } }
    })
    expect(calls).toEqual(['project.plan', 'inbox.snapshot', 'queue.list'])
  })
})
