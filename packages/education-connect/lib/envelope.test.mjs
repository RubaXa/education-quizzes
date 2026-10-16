import { describe, expect, it } from 'vitest'
import { randomBytes } from 'node:crypto'
import { decryptHandoff, encryptHandoff, generateReceiverKeys } from './envelope.mjs'

/** @see ../../../docs/modules/school-diary/README.md#family-onboarding-research */
describe('education-connect handoff', () => {
  const invite = randomBytes(32).toString('base64url')

  it('decrypts for the holder of the private key only', () => {
    const receiver = generateReceiverKeys()
    const payload = { source: 'mesh', credentials: { token: 'private' } }
    const envelope = encryptHandoff(invite, receiver.publicKey, payload)
    expect(decryptHandoff(invite, receiver.privateKey, envelope)).toEqual(payload)
    expect(() => decryptHandoff(invite, generateReceiverKeys().privateKey, envelope)).toThrow()
  })

  it('rejects reuse with another invite or changed ciphertext', () => {
    const receiver = generateReceiverKeys()
    const envelope = encryptHandoff(invite, receiver.publicKey, { token: 'private' })
    expect(() => decryptHandoff(randomBytes(32).toString('base64url'), receiver.privateKey, envelope)).toThrow()
    const changed = `${envelope.ciphertext[0] === 'A' ? 'B' : 'A'}${envelope.ciphertext.slice(1)}`
    expect(() => decryptHandoff(invite, receiver.privateKey, { ...envelope, ciphertext: changed })).toThrow()
  })
})
