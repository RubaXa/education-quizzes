#!/usr/bin/env node
/** @see ../docs/services/operator-cli/README.md#operation-contract */
/** @see ../docs/decisions/olympiad-family-storage-2026-10-27.md */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { YandexDiskStorage } from '../storage/yandex-disk.mjs'
import { operatorFirestore } from './lib/admin-firebase.mjs'
import { beginHelpReview, completeHelpReview, captureHelpPhotos } from '../operator/olympiad-help.mjs'

const [command, familyId, childId, olympiadId, problemId, requestId, operationId, answerPath] = process.argv.slice(2)
const scope = { familyId, childId, olympiadId, problemId, requestId, operationId }
if (!['start', 'finish'].includes(command) || (command === 'start' && answerPath) || (command === 'finish' && !answerPath)) throw new Error('Usage: olympiad-help start|finish FAMILY CHILD OLYMPIAD PROBLEM REQUEST OPERATION [ANSWER_FILE]')
const db = operatorFirestore()
let result
if (command === 'start') {
  const token = process.env.YANDEX_DISK_TOKEN || readFileSync(resolve('.local/yandex-disk-token'), 'utf8').trim()
  if (!token) throw new Error('photo-storage-unavailable')
  const frozen = await beginHelpReview(db, scope)
  const photos = await captureHelpPhotos(db, new YandexDiskStorage(token), scope, frozen)
  const key = createHash('sha256').update(JSON.stringify(scope)).digest('hex')
  const directory = resolve('.local/olympiad-help', key)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const names = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif' }
  const captured = photos.map(photo => {
    const path = resolve(directory, `${photo.photoId}.${names[photo.mime]}`)
    writeFileSync(path, photo.bytes, { mode: 0o600 })
    return { photoId: photo.photoId, path }
  })
  result = { ...frozen, photos: captured }
} else {
  const raw=readFileSync(answerPath,'utf8')
  if(raw.trim().startsWith('{')){const value=JSON.parse(raw);if(Object.keys(value).some(k=>!['text','presentation'].includes(k)))throw Error('invalid-public-help');if(!value.presentation?.activity)throw Error('current-step-model-required');result=await completeHelpReview(db,scope,value.text,value.presentation)}
  else throw Error('Use a JSON response with text and presentation.activity for the current step.')
}
process.stdout.write(`${JSON.stringify(result)}\n`)
