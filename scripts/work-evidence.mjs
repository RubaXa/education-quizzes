/** @see ../docs/modules/assignments/README.md#readiness-and-handover */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { operatorFirestore } from './lib/admin-firebase.mjs'
import { readWorkEvidence } from '../storage/work-evidence.mjs'
import { YandexDiskStorage } from '../storage/yandex-disk.mjs'

const args = process.argv.slice(2), date = args[0]
const option = flag => args.includes(flag) ? args[args.indexOf(flag) + 1] : null
const taskIds = option('--tasks')?.split(',') ?? []
const output = resolve(option('--output') ?? '.local/work-evidence.json')
if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || !taskIds.length || taskIds.some(id => !/^[a-z0-9-]{3,120}$/.test(id)) || !output.startsWith(resolve('.local') + '/')) throw new Error('work-evidence DATE --tasks ID,ID --output .local/FILE.json [--pull]')
const read = file => JSON.parse(readFileSync(resolve('.local', file), 'utf8'))
const owner = read('family-access.json').legacyDayOwner, token = read('day-links.json')[date]?.student
if (!token) throw new Error('No published day')
const db = operatorFirestore()
try {
  const result = await readWorkEvidence(db, { owner, token, taskIds })
  if (args.includes('--pull')) {
    const store = new YandexDiskStorage(readFileSync(resolve('.local/yandex-disk-token'), 'utf8').trim())
    const directory = resolve(dirname(output), 'work-evidence-photos'); mkdirSync(directory, { recursive: true })
    for (const file of result.uploads) {
      if (file.storage?.state !== 'stored' || !file.storage?.path) continue
      const bytes = await store.getAt(file.storage.path)
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      if (file.storage.sha256 && file.storage.sha256 !== sha256) throw new Error('work_evidence_sha_mismatch')
      file.localFile = resolve(directory, `${file.id}-${sha256.slice(0, 12)}.${file.storage.path.split('.').at(-1)}`)
      writeFileSync(file.localFile, bytes, { mode: 0o600 })
    }
  }
  writeFileSync(output, JSON.stringify(result, null, 2), { mode: 0o600 })
  console.log(JSON.stringify({ output, tasks: result.tasks.length, photos: result.uploads.length, verified: result.gate.verifiedIds.length, missing: result.gate.missingIds, next: result.gate.next }))
} finally { await db.terminate() }
