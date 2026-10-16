// @see ../docs/modules/materials/storage-privacy.md#privacy-boundary
import { afterEach, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
const fixtures = []
afterEach(() => { for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true }) })
function check(path, content, history = false) {
  const root = mkdtempSync(join(tmpdir(), 'education-privacy-')); fixtures.push(root)
  execFileSync('git', ['init', '-q'], { cwd: root })
  mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), content)
  execFileSync('git', ['add', '-f', path], { cwd: root })
  if (history) execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'fixture'], { cwd: root })
  return spawnSync(process.execPath, [join(import.meta.dirname, 'check-privacy.mjs'), ...(history ? ['--history'] : [])], { cwd: root, encoding: 'utf8' })
}
it('allows generic material specifications while still scanning their content', () => {
  expect(check('docs/modules/materials/README.md', '# Generic contract').status).toBe(0)
  expect(check('docs/modules/materials/README.md', 'Пе' + 'тя').status).toBe(1)
})
it('continues to block media, private directories and nested material stores', () => {
  for (const path of ['docs/modules/materials/source.pdf', 'materials/private.md', '.local/secret.md', 'docs/modules/materials/materials/private.md']) {
    expect(check(path, 'private material').status, path).toBe(1)
  }
})

it('allows specification directories in history and still rejects private blobs', () => {
  expect(check('docs/modules/materials/README.md', '# Generic contract', true).status).toBe(0)
  expect(check('docs/modules/materials/source.pdf', 'private material', true).status).toBe(1)
})
