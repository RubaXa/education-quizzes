import { describe, expect, it } from 'vitest'
import { assertReleaseSource } from './publish-source-gate.mjs'

/** @see ../docs/operations/deployment.md */
describe('publication source gate', () => {
  it('accepts a clean current main tree including detached releases', () => {
    expect(() => assertReleaseSource({ dirty: '', sourceTree: 'current', mainTree: 'current' })).not.toThrow()
  })
  it('rejects an older release and a feature branch missing parallel work', () => {
    for (const sourceTree of ['old', 'feature']) {
      expect(() => assertReleaseSource({ dirty: '', sourceTree, mainTree: 'current' })).toThrow('origin/main')
    }
  })
  it('rejects uncommitted changes even on the current main tree', () => {
    expect(() => assertReleaseSource({ dirty: ' M src/App.tsx', sourceTree: 'current', mainTree: 'current' })).toThrow('рабочие изменения')
  })
})
