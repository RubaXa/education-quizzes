import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { main, parseArgs, readHiddenLine } from './telegram-pair.mjs'

class Output { constructor() { this.value = '' } write(value) { this.value += value } }

describe('Telegram pairing operator CLI', () => {
  it('requires explicit family and person and rejects codes in argv', () => {
    expect(parseArgs(['--family', 'family-a', '--person', 'parent-a'])).toMatchObject({ familyId: 'family-a', personId: 'parent-a' })
    expect(() => parseArgs(['--family', 'family-a', '--person', 'parent-a', '0123456789abcdef'])).toThrow('usage')
    expect(() => parseArgs(['--family', 'family-a', '--family', 'family-b', '--person', 'parent-a'])).toThrow('usage')
  })

  it('requires a locally mapped parent and verified source owner before reading or redeeming code', async () => {
    const stdout = new Output(), stderr = new Output()
    const reads = []
    const stdin = new EventEmitter()
    const code = await main(['--family', 'family-a', '--person', 'parent-a'], {
      registry: { families: { 'family-a': { childIds: ['child-a'] } }, people: { 'parent-a': { familyId: 'family-a', role: 'parent' } } },
      db: { async terminate() {} },
      meshSessionsFactory: () => ({ async resolveLocalSourceOwner() { return null } }),
      io: { stdin, stdout, stderr },
    })
    reads.push(stdin.listenerCount('data'))
    expect(code).toBe(1)
    expect(stderr.value).toContain('local_source_owner_unverified')
    expect(reads).toEqual([0])
    expect(stdout.value).toBe('')
  })

  it('accepts pasted code chunks, handles backspace and restores terminal mode on submit', async () => {
    const stdin = new EventEmitter()
    stdin.isTTY = true; stdin.isRaw = false
    stdin.setRawMode = (value) => { stdin.isRaw = value }
    stdin.resume = () => {}; stdin.pause = () => {}
    const output = new Output()
    const pending = readHiddenLine(stdin, output)
    stdin.emit('data', Buffer.from('0123456789abcx\bdef\r\n'))
    await expect(pending).resolves.toBe('0123456789abcdef')
    expect(stdin.isRaw).toBe(false)
    expect(stdin.listenerCount('data')).toBe(0)
  })

  it('restores terminal mode when the operator cancels', async () => {
    const stdin = new EventEmitter()
    stdin.isTTY = true; stdin.isRaw = false
    stdin.setRawMode = (value) => { stdin.isRaw = value }
    stdin.resume = () => {}; stdin.pause = () => {}
    const pending = readHiddenLine(stdin, new Output())
    stdin.emit('data', Buffer.from('\u0003'))
    await expect(pending).rejects.toThrow('input_cancelled')
    expect(stdin.isRaw).toBe(false)
    expect(stdin.listenerCount('data')).toBe(0)
  })
})
