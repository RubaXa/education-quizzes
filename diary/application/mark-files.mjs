/** @see ../../docs/modules/school-diary/README.md#diary-adapter */
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export async function downloadMarkFiles({ adapter, detail, dataDir }) {
  if (!/^\d+$/.test(String(detail?.id ?? ''))) throw new Error('invalid_mark_id')
  const directory = resolve(dataDir, 'mark-files', String(detail.id))
  mkdirSync(directory, { recursive: true })
  const files = []
  for (const file of [...(detail.result_files ?? []), ...(detail.student_work_result_files ?? [])]) {
    if (!/^\d+$/.test(String(file.id)) || !['jpg', 'jpeg', 'png', 'pdf'].includes(file.type)) throw new Error('invalid_mark_file')
    const bytes = await adapter.getMarkFile(file.file_url)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    const filename = `${file.id}-${sha256.slice(0, 12)}.${file.type}`
    writeFileSync(resolve(directory, filename), bytes, { mode: 0o600 })
    files.push({ id: file.id, file: filename, sourceUrl: file.file_url, size: bytes.length,
      sha256 })
  }
  writeFileSync(resolve(directory, 'manifest.json'), JSON.stringify({ markId: detail.id, files }, null, 2), { mode: 0o600 })
  return { directory, files: files.length }
}
