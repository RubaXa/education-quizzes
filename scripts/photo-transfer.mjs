/** @see ../docs/decisions/photo-transfer-revision-race-2026-11-07.md */
/** @see ../docs/services/upload-worker/README.md#photo-recovery */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createEducationFirestore } from '../packages/education-runtime/firestore.mjs'
import { YandexDiskStorage } from '../storage/yandex-disk.mjs'
import { inspectPhotoTransfer, recoverPhotoTransfer } from '../storage/photo-transfer-recovery.mjs'

const [command, dayToken, uploadId] = process.argv.slice(2)
if (!['inspect', 'resume'].includes(command) || process.argv.length !== 5) throw new Error('Usage: photo-transfer.mjs inspect|resume DAY_TOKEN UPLOAD_ID')
const db = createEducationFirestore({ projectId: 'education-9d7c6', cwd: process.cwd() })
try {
  const disk = new YandexDiskStorage(readFileSync(resolve('.local/yandex-disk-token'), 'utf8').trim())
  const deps = { db, disk, dayToken, uploadId }
  const result = command === 'inspect' ? (await inspectPhotoTransfer(deps)).summary : await recoverPhotoTransfer(deps)
  console.log(JSON.stringify(result))
} finally { await db.terminate() }
