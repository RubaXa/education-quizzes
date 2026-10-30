import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { approvedHistoricalObject, batchObjects, privateNamePattern } from './privacy-exceptions.mjs'
const bytes = Buffer.from('Previously published generic design text')
const entry = { object: 'a'.repeat(40), paths: ['docs/old.md'], kind: 'historical-document', sha256: createHash('sha256').update(bytes).digest('hex') }
const input = { history: true, object: entry.object, path: entry.paths[0], bytes }
describe('exact consented historical objects', () => {
  it('only permits the approved bytes, object, path, and historical mode', () => {
    expect(approvedHistoricalObject(input, [entry])).toBe(true)
    for (const change of [{ history: false }, { object: 'b'.repeat(40) }, { path: 'docs/new.md' }, { bytes: Buffer.from('new private data') }, { current: true }]) expect(approvedHistoricalObject({ ...input, ...change }, [entry])).toBe(false)
  })
  it('permits only exact approved public PDF bytes in the current tree', () => {
    expect(approvedHistoricalObject({ ...input, current: true }, [{ ...entry, kind: 'official-public-pdf' }])).toBe(true)
  })
  it('preserves binary contents in a batch and rejects malformed output', () => {
    const binary = Buffer.from([0, 10, 255]), data = Buffer.concat([Buffer.from('abc blob 3\n'), binary, Buffer.from('\n')])
    expect(batchObjects(data, ['abc']).get('abc').bytes).toEqual(binary)
    expect(() => batchObjects(data.subarray(0, -1), ['abc'])).toThrow()
  })
})

it('detects the personal name and inflections without matching pedagogical vocabulary', () => {
 const pattern=new RegExp(privateNamePattern,'iu')
 for(const suffix of ['я','и','р','ра','ру','ром','ька']) expect(pattern.test('Имя: '+'Пет'+suffix+'.')).toBe(true)
 for(const word of ['репетитор','репетиторство','репетиция']) expect(pattern.test(word)).toBe(false)
})
