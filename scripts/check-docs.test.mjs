// @see ../docs/shared/specification-system.md
import { afterEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkDocs } from './check-docs.mjs'

const fixtures = []
afterEach(() => { for (const path of fixtures.splice(0)) rmSync(path, { recursive: true, force: true }) })
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'education-docs-')); fixtures.push(root)
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
  const write = (path, text) => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), text) }
  git('init', '-q')
  const spec = '---\nid: product.education\nstatus: accepted\nimplementation: partial\nuses: []\nsections:\n  - scope\n---\n# Product\n## Scope\n[Target](../../target.md#target)\n'
  write('docs/product/README.md', spec)
  write('target.md', '# Target\n')
  write('docs/file-map.md', [
    '| [docs/product/README.md](product/README.md) | [Contract](product/README.md) | Root | Agent |',
    '| [docs/file-map.md](file-map.md) | [Contract](product/README.md) | Map | Agent |',
    '| [target.md](../target.md) | [Contract](product/README.md) | Target | Agent |',
  ].join('\n'))
  git('add', '.')
  return { root, write, git, spec }
}
describe('documentation pre-commit snapshot', () => {
  it('accepts staged documents even if unstaged content is broken', () => {
    const { root, write } = fixture()
    write('target.md', '# Changed anchor\n')
    expect(checkDocs(root, { staged: true }).problems).toEqual([])
    expect(checkDocs(root).problems.join('\n')).toContain('якорь')
  })
  it('rejects a staged broken anchor even after an unstaged repair', () => {
    const { root, write, git } = fixture()
    write('target.md', '# Wrong\n'); git('add', 'target.md')
    write('target.md', '# Target\n')
    expect(checkDocs(root, { staged: true }).problems.join('\n')).toContain('якорь')
  })
  it('rejects a staged deletion even when the target exists in the working directory', () => {
    const { root, write, git } = fixture()
    git('rm', '--cached', 'target.md'); write('target.md', '# Target\n')
    expect(checkDocs(root, { staged: true }).problems.join('\n')).toContain('отсутствует локальная ссылка')
  })
  it('runs the configured Lefthook documentation command and blocks invalid staged documents', () => {
    const { root, write, git } = fixture()
    const sourceRoot = join(import.meta.dirname, '..')
    for (const name of ['check-docs.mjs', 'spec-graph.mjs']) {
      mkdirSync(join(root, 'scripts'), { recursive: true })
      copyFileSync(join(sourceRoot, 'scripts', name), join(root, 'scripts', name))
    }
    copyFileSync(join(sourceRoot, 'lefthook.yml'), join(root, 'lefthook.yml'))
    write('docs/shared/specification-system.md', '---\nid: shared.specification-system\nstatus: accepted\nimplementation: implemented\nparent: product.education\nuses: []\nsections: []\n---\n# Tools\n')
    const map = readFileSync(join(root, 'docs/file-map.md'), 'utf8')
    write('docs/file-map.md', map + ['scripts/check-docs.mjs', 'scripts/spec-graph.mjs', 'lefthook.yml', 'docs/shared/specification-system.md'].map(path =>
      `\n| [${path}](../${path}) | [Contract](product/README.md) | Tool | Author |`).join(''))
    git('add', '.')
    const run = () => execFileSync(join(sourceRoot, 'node_modules/.bin/lefthook'), ['run', 'pre-commit', '--command', 'documentation', '--no-auto-install'], { cwd: root, stdio: 'pipe' })
    expect(() => run()).not.toThrow()
    write('target.md', '# Broken\n'); git('add', 'target.md')
    expect(() => run()).toThrow()
  })
  it('rejects missing required sections and unmapped files in the index', () => {
    const { root, write, git, spec } = fixture()
    write('docs/product/README.md', spec.replace('## Scope', '## Renamed'))
    write('new.md', '# New\n'); git('add', '.')
    const errors = checkDocs(root, { staged: true }).problems.join('\n')
    expect(errors).toContain('обязательные разделы')
    expect(errors).toContain('файл без контракта new.md')
  })
})
