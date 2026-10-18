// @see ../docs/shared/specification-system.md
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkDocs } from './check-docs.mjs'

const fixtures = []
let inheritedGitEnv = {}
// A linked-worktree hook exports absolute Git paths. None may reach fixture
// git commands, checkDocs, or a nested Lefthook invocation in a temporary repo.
beforeEach(() => {
  inheritedGitEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.startsWith('GIT_')))
  for (const key of Object.keys(inheritedGitEnv)) delete process.env[key]
})
afterEach(() => {
  for (const path of fixtures.splice(0)) rmSync(path, { recursive: true, force: true })
  for (const key of Object.keys(process.env).filter((key) => key.startsWith('GIT_'))) delete process.env[key]
  Object.assign(process.env, inheritedGitEnv)
})
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'education-docs-')); fixtures.push(root)
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
  const write = (path, text) => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), text) }
  git('init', '-q')
  const spec = '---\nid: product.education\nstatus: accepted\nimplementation: planned\ncreated: 2026-01-01\nupdated: 2026-01-01\nconsumers:\n  - Agent\ncode: []\nuses: []\nsections:\n  - scope\n---\n# Product\n## Scope\n[Target](../../target.md#target)\n'
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
  it('runs fixture checks without inherited hook repository overrides', () => {
    expect(Object.keys(process.env).filter((key) => key.startsWith('GIT_'))).toEqual([])
    const { root } = fixture()
    expect(checkDocs(root, { staged: true }).problems).toEqual([])
  })
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
    write('docs/shared/specification-system.md', '---\nid: shared.specification-system\nstatus: accepted\nimplementation: implemented\ncreated: 2026-01-01\nupdated: 2026-01-01\nparent: product.education\nuses: []\nconsumers:\n  - Author\ncode:\n  - scripts/check-docs.mjs\n  - scripts/spec-graph.mjs\nsections: []\n---\n# Tools\n')
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
  it('does not let repaired worktree dates, consumers or @see hide invalid index content', () => {
    const { root, write, git } = fixture()
    const shared = (created, updated, consumers) => `---\nid: shared.impl\nstatus: accepted\nimplementation: implemented\ncreated: ${created}\nupdated: ${updated}\nparent: product.education\nuses: []\nconsumers:\n${consumers}\ncode:\n  - src/impl.ts\nsections: []\n---\n# Impl\n`
    write('docs/shared/impl.md', shared('2026-02-01', '2025-01-01', '  - Agent\n  - Agent'))
    write('src/impl.ts', 'const label = "@see ../docs/shared/impl.md"\n')
    const map = readFileSync(join(root, 'docs/file-map.md'), 'utf8')
    write('docs/file-map.md', `${map}\n| [docs/shared/impl.md](shared/impl.md) | [Contract](shared/impl.md) | Contract | Agent |\n| [src/impl.ts](../src/impl.ts) | [Contract](shared/impl.md) | Runtime | App |`)
    git('add', '.')
    write('docs/shared/impl.md', shared('2026-01-01', '2026-02-01', '  - Agent'))
    write('src/impl.ts', '/** @see ../docs/shared/impl.md */\nconst label = "runtime"\n')
    const errors = checkDocs(root, { staged: true }).problems.join('\n')
    expect(errors).toContain('created не может быть позже')
    expect(errors).toContain('consumers должен')
    expect(errors).toContain('требуется @see')
  })
  it('reads staged .cjs implementation code and validates its indexed comment backlink', () => {
    const { root, write, git } = fixture()
    write('docs/shared/cjs-impl.md', '---\nid: shared.cjs-impl\nstatus: accepted\nimplementation: implemented\ncreated: 2026-01-01\nupdated: 2026-01-01\nparent: product.education\nuses: []\nconsumers:\n  - App\ncode:\n  - scripts/impl.cjs\nsections: []\n---\n# CJS implementation\n')
    write('scripts/impl.cjs', 'const example = "@see ../docs/shared/cjs-impl.md"\n')
    const map = readFileSync(join(root, 'docs/file-map.md'), 'utf8')
    write('docs/file-map.md', `${map}\n| [docs/shared/cjs-impl.md](shared/cjs-impl.md) | [Contract](shared/cjs-impl.md) | CJS contract | Agent |\n| [scripts/impl.cjs](../scripts/impl.cjs) | [Contract](shared/cjs-impl.md) | CJS runtime | App |`)
    git('add', '.')
    write('scripts/impl.cjs', '// @see ../docs/shared/cjs-impl.md\nconst runtime = true\n')
    const errors = checkDocs(root, { staged: true }).problems.join('\n')
    expect(errors).toContain('scripts/impl.cjs: требуется @see')
  })
})
