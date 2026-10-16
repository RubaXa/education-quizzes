import { createCipheriv, createDecipheriv, createHash, diffieHellman, generateKeyPairSync, hkdfSync, createPrivateKey, createPublicKey, randomBytes } from 'node:crypto'

/** One-time handoff format. The receiver private key never leaves the operator's machine.
 * @see ../../../docs/modules/school-diary/README.md#family-onboarding-research
 */
const context = Buffer.from('education-connect:handoff:v1')
const encoded = (value) => Buffer.from(value).toString('base64url')
const decoded = (value) => Buffer.from(value, 'base64url')

function derive(privateKey, publicKey, inviteCode) {
  const shared = diffieHellman({ privateKey, publicKey })
  const salt = createHash('sha256').update(inviteCode).digest()
  return Buffer.from(hkdfSync('sha256', shared, salt, context, 32))
}

export function generateReceiverKeys() {
  const pair = generateKeyPairSync('x25519')
  return {
    publicKey: encoded(pair.publicKey.export({ type: 'spki', format: 'der' })),
    privateKey: encoded(pair.privateKey.export({ type: 'pkcs8', format: 'der' })),
  }
}

export function encryptHandoff(inviteCode, receiverPublicKey, payload) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(inviteCode)) throw new Error('Неверный код приглашения')
  const receiver = createPublicKey({ key: decoded(receiverPublicKey), format: 'der', type: 'spki' })
  if (receiver.asymmetricKeyType !== 'x25519') throw new Error('Неверный ключ получателя')
  const ephemeral = generateKeyPairSync('x25519')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', derive(ephemeral.privateKey, receiver, inviteCode), iv)
  cipher.setAAD(Buffer.concat([context, Buffer.from(inviteCode)]))
  const content = Buffer.from(JSON.stringify(payload), 'utf8')
  if (content.length > 64 * 1024) throw new Error('Слишком большой пакет подключения')
  const ciphertext = Buffer.concat([cipher.update(content), cipher.final()])
  return {
    version: 1,
    ephemeralKey: encoded(ephemeral.publicKey.export({ type: 'spki', format: 'der' })),
    iv: encoded(iv),
    ciphertext: encoded(ciphertext),
    tag: encoded(cipher.getAuthTag()),
  }
}

export function decryptHandoff(inviteCode, receiverPrivateKey, envelope) {
  if (envelope?.version !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(inviteCode)) throw new Error('Неверный формат подключения')
  const privateKey = createPrivateKey({ key: decoded(receiverPrivateKey), format: 'der', type: 'pkcs8' })
  const publicKey = createPublicKey({ key: decoded(envelope.ephemeralKey), format: 'der', type: 'spki' })
  if (privateKey.asymmetricKeyType !== 'x25519' || publicKey.asymmetricKeyType !== 'x25519') throw new Error('Неверный ключ подключения')
  const iv = decoded(envelope.iv)
  const tag = decoded(envelope.tag)
  const ciphertext = decoded(envelope.ciphertext)
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length > 80 * 1024) throw new Error('Неверный шифрованный пакет')
  const decipher = createDecipheriv('aes-256-gcm', derive(privateKey, publicKey, inviteCode), iv)
  decipher.setAAD(Buffer.concat([context, Buffer.from(inviteCode)]))
  decipher.setAuthTag(tag)
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'))
}
