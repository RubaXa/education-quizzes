#!/usr/bin/env node
/** @see ../docs/services/telegram-bot/identity-and-linking.md */
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { operatorFirestore } from './lib/admin-firebase.mjs'
import { createLegacyMeshCredentialCodec } from '../packages/education-runtime/credentials.mjs'
import { createMeshSessionService } from '../packages/education-runtime/mesh-session.mjs'
import { createFirestoreAdapters } from '../packages/telegram-notifications/adapters/firestore.mjs'
import { IdentityService } from '../packages/telegram-notifications/application/identity.mjs'

/** Redeem a private Telegram Start code only for an exact current MESH-backed PETR parent.
 * The one-time code is read from stdin and never accepted in argv or sent to logs.
 */
export async function main(args = process.argv.slice(2), dependencies = {}) {
  const io = dependencies.io ?? process
  let db = null
  try {
    const options = parseArgs(args)
    if (options.help) {
      io.stdout.write('Usage: node scripts/telegram-pair.mjs --family FAMILY_ID --person PERSON_ID\nThe one-time code is read from hidden stdin.\n')
      return 0
    }
    const root = dependencies.root ?? process.cwd()
    const localPath = resolve(root, '.local', 'family-access.json')
    const registry = dependencies.registry ?? (existsSync(localPath) ? JSON.parse(readFileSync(localPath, 'utf8')) : null)
    if (!isEligibleLocalParent(registry, options.familyId, options.personId)) return safeFailure(io, 'local_parent_unavailable', 1)
    db = dependencies.db ?? (dependencies.dbFactory ?? (() => operatorFirestore({ cwd: root })))()
    const connectionsDir = resolve(root, '.local', 'mesh-connections')
    const legacyCodec = createLegacyMeshCredentialCodec({ familyAccessPath: localPath,
      credentialsPath: resolve(root, '.local', 'diary', 'secret.json') })
    const meshSessions = (dependencies.meshSessionsFactory ?? createMeshSessionService)({ db, connectionsDir, legacyCodec })
    if (typeof meshSessions.resolveLocalSourceOwner !== 'function') return safeFailure(io, 'local_source_owner_check_unavailable', 1)
    const sourceOwner = await meshSessions.resolveLocalSourceOwner({ familyId: options.familyId, personId: options.personId })
    if (!sourceOwner || sourceOwner.familyId !== options.familyId || sourceOwner.personId !== options.personId) return safeFailure(io, 'local_source_owner_unverified', 1)
    const pairingCode = await readHiddenLine(io.stdin, io.stderr)
    if (!/^[a-f0-9]{16}$/.test(pairingCode)) return safeFailure(io, 'pairing_code_invalid', 1)
    const identity = new IdentityService({ registry: createFirestoreAdapters(db).registry })
    const result = await identity.redeemPairing({ pairingCode, familyId: options.familyId, personId: options.personId })
    if (!['linked', 'already_linked'].includes(result.code)) return safeFailure(io, result.code, 1)
    io.stdout.write(JSON.stringify({ schemaVersion: 1, result: result.code }) + '\n')
    return 0
  } catch {
    return safeFailure(io, 'pairing_operation_failed', 1)
  } finally {
    if (db && dependencies.keepOpen !== true) {
      try { await db.terminate?.() } catch { /* close failures do not change the safe result */ }
    }
  }
}

export function parseArgs(args) {
  let familyId = null, personId = null, help = false
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--help' || arg === '-h') { help = true; continue }
    if (!['--family', '--person'].includes(arg) || !args[index + 1]) throw new Error('usage')
    const value = args[index + 1]
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error('usage')
    if (arg === '--family') { if (familyId) throw new Error('usage'); familyId = value }
    else { if (personId) throw new Error('usage'); personId = value }
    index += 1
  }
  if (!help && (!familyId || !personId)) throw new Error('usage')
  return { familyId, personId, help }
}

function isEligibleLocalParent(registry, familyId, personId) {
  const family = registry?.families?.[familyId]
  const person = registry?.people?.[personId]
  return Boolean(family && person && person.familyId === familyId && person.role === 'parent'
    && Array.isArray(family.childIds) && family.childIds.length > 0)
}

export async function readHiddenLine(input, output) {
  if (!input || typeof input.once !== 'function') throw new Error('stdin_unavailable')
  output.write('Введите одноразовый код (ввод скрыт): ')
  if (!input.isTTY) {
    let data = ''
    for await (const chunk of input) data += chunk.toString()
    output.write('\n')
    return data.trim()
  }
  const wasRaw = Boolean(input.isRaw)
  input.setRawMode(true)
  input.resume()
  return new Promise((resolveLine, reject) => {
    let value = ''
    const cleanup = () => {
      input.removeListener('data', onData)
      input.setRawMode(wasRaw)
      input.pause()
    }
    const onData = (chunk) => {
      for (const byte of Buffer.from(chunk)) {
        const character = String.fromCharCode(byte)
        if (character === '\u0003' || character === '\u0004') { cleanup(); reject(new Error('input_cancelled')); return }
        if (character === '\r' || character === '\n') { cleanup(); output.write('\n'); resolveLine(value); return }
        if (character === '\u007f' || character === '\b') { value = value.slice(0, -1); continue }
        if (/^[\x20-\x7e]$/.test(character) && value.length < 128) value += character
      }
    }
    input.on('data', onData)
  })
}

function safeFailure(io, code, status) {
  const allowed = new Set(['local_parent_unavailable', 'local_source_owner_check_unavailable', 'local_source_owner_unverified',
    'pairing_code_invalid', 'invalid_pairing', 'pairing_owner_unavailable', 'pairing_conflict', 'pairing_unavailable', 'pairing_operation_failed'])
  io.stderr.write(`${JSON.stringify({ schemaVersion: 1, error: allowed.has(code) ? code : 'pairing_operation_failed' })}\n`)
  return status
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main()
