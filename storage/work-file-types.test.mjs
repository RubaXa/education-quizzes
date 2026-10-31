import { describe, it, expect } from 'vitest'
import { workFileContentType, workFilePresentation, workFileTypes, workFileAccept } from './work-file-types.mjs'

describe('solution format metadata', () => {
  it.each(Object.entries(workFileTypes))('resolves browser MIME and missing MIME for %s', (type, [ext, kind]) => {
    expect(workFileContentType({ type, name: `Решение.${ext}` })).toBe(type)
    expect(workFileContentType({ type: '', name: `Решение.${ext.toUpperCase()}` })).toBe(type)
    expect(workFileContentType({ type: 'application/octet-stream', name: `Решение.${ext}` })).toBe(type)
    expect(workFilePresentation({ contentType: type, originalName: `Решение.${ext}` })).toMatchObject({ kind, extension: ext, name: `Решение.${ext}` })
    if (kind !== 'photo') expect(workFileAccept).toContain(`.${ext}`)
  })
  it('handles browser aliases without allowing executable or unknown types', () => {
    expect(workFileContentType({ type: 'text/plain', name: 'work.csv' })).toBe('text/csv')
    expect(workFileContentType({ type: 'text/rtf', name: 'work.rtf' })).toBe('application/rtf')
    expect(workFileContentType({ type: 'application/zip', name: 'work.docx' })).toContain('wordprocessingml')
    expect(workFileContentType({ type: '', name: 'run.exe' })).toBe('')
    expect(workFileContentType({ type: 'text/html', name: 'work.html' })).toBe('')
    expect(workFilePresentation({ storage: { path: 'app:/old-file.pdf' } })).toMatchObject({ kind: 'pdf', name: 'old-file.pdf' })
  })
})
