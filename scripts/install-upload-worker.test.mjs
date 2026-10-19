import { describe, expect, it, vi } from 'vitest'
import { main, replacementCommand } from './install-upload-worker.mjs'

describe('retired upload worker installer alias', () => {
  it('directs operators to the unified runtime without installing a source worker', () => {
    const write = vi.fn()
    expect(main({ write })).toBe(2)
    expect(replacementCommand).toBe('npm run telegram:install-worker -- --apply')
    expect(write).toHaveBeenCalledOnce()
    expect(write.mock.calls[0][0]).toContain(replacementCommand)
  })
})
