/** @see ../../docs/modules/school-diary/README.md#diary-adapter */
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { downloadMarkFiles } from './mark-files.mjs'
it('uses result_files despite a false has_files flag and preserves earlier bytes on changed content', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'mesh-mark-files-'))
  try {
    let bytes = Buffer.from('first')
    const adapter = { getMarkFile: async () => bytes }
    const detail = { id: 7, has_files: false, result_files: [{ id: 9, type: 'jpg', file_url: 'https://school.mos.ru/storage/controlwork/1/2/abcd' }] }
    const first = await downloadMarkFiles({ adapter, detail, dataDir })
    bytes = Buffer.from('second'); await downloadMarkFiles({ adapter, detail, dataDir })
    expect(first.files).toBe(1)
    expect(readdirSync(first.directory).filter(name => name.endsWith('.jpg'))).toHaveLength(2)
  } finally { rmSync(dataDir, { recursive: true, force: true }) }
})
