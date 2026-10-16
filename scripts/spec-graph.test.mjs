// @see ../docs/shared/specification-system.md
import { describe, expect, it } from 'vitest'
import { parseMetadata, validateMetadata, validateStructure, anchors, checkReferences, deriveGraph, renderMermaid, renderStatus, validateBindings, validateImplementation, codeAnnotations } from './spec-graph.mjs'

const document = (id, extra = {}) => ({
  path: `${id}.md`, text: '# Contract',
  metadata: { id, status: 'accepted', implementation: 'partial', created: '2026-01-01', updated: '2026-01-01', consumers: ['Agent'], code: [], sections: [], uses: [], ...(id === 'product.education' ? {} : { parent: 'product.education' }), ...extra },
})

describe('specification graph validation', () => {
  it('reads explicit empty and multiline dependencies without treating unrelated YAML as graph edges', () => {
    expect(parseMetadata('---\nid: module.families\nstatus: accepted\nimplementation: partial\nparent: product.education\nuses:\n  - "shared.access"\nrelated:\n  - evidence.md\n---\n# Body')).toMatchObject({ id: 'module.families', uses: ['shared.access'], related: ['evidence.md'] })
    expect(parseMetadata('---\nid: product.education\nuses: []\n---\n')).toMatchObject({ uses: [] })
  })
  it('rejects duplicate identities, dangling dependencies, parent cycles and oversized specs', () => {
    const docs = [document('product.education'), document('module.one', { parent: 'module.two', uses: ['absent'] }), document('module.two', { parent: 'module.one' }), document('module.one')]
    const errors = validateMetadata(docs).join('\n')
    expect(errors).toContain('повтор id')
    expect(errors).toContain('неизвестный uses')
    expect(errors).toContain('цикл parent')
    const boundary = document('module.boundary'); boundary.text = '# Contract\n'.repeat(700)
    expect(validateMetadata([document('product.education'), boundary])).toEqual([])
    const huge = document('module.huge'); huge.text = '\n'.repeat(701)
    expect(validateMetadata([document('product.education'), huge]).join('\n')).toContain('700 строк')
  })
  it('requires real ordered ISO dates, nonempty unique consumers and a code list', () => {
    const invalidDate = document('product.education', { created: '2026-02-30', updated: '2025-01-01' })
    const errors = validateMetadata([invalidDate]).join('\n')
    expect(errors).toContain('реальной датой')
    expect(validateMetadata([document('product.education', { created: '2026-02-01', updated: '2025-01-01' })]).join('\n')).toContain('не может быть позже')
    const invalidFields = document('product.education', { consumers: ['Agent', 'Agent'], code: 'src/app.ts' })
    const fieldErrors = validateMetadata([invalidFields]).join('\n')
    expect(fieldErrors).toContain('consumers должен')
    expect(fieldErrors).toContain('code должен')
  })
  it('requires declared sections, a single H1 and a valid heading hierarchy', () => {
    const doc = document('product.education', { sections: ['scope', 'checks'] })
    doc.text = '# Contract\n## Scope\nText\n## Checks\nText'
    expect(validateStructure([doc])).toEqual([])
    doc.text = '# Contract\n## Scope\n<a id="checks"></a>'
    expect(validateStructure([doc]).join('\n')).toContain('обязательные разделы')
    doc.text = '# Contract\n# Duplicate\n### Jump'
    expect(validateStructure([doc]).join('\n')).toContain('H1')
    expect(validateStructure([doc]).join('\n')).toContain('уровень')
    delete doc.metadata.sections
    expect(validateStructure([doc]).join('\n')).toContain('sections должен')
  })
  it('validates local anchors and rejects checkout escapes while allowing explicit private references', () => {
    const data = {
      'docs/a.md': '[valid](b.md#критерий) [missing](b.md#gone) [private](petr-private:events/one.md) [escape](../../outside.md)',
      'docs/b.md': '# Критерий\n<a id="stable"></a>\n## Interface {#port}',
    }
    const errors = checkReferences(['docs/a.md'], {
      repositoryRoot: '/repo', read: (path) => data[path.replace('/repo/', '')], exists: (path) => Object.hasOwn(data, path.replace('/repo/', '')),
    })
    expect(errors).toHaveLength(2)
    expect(errors.join('\n')).toContain('якорь')
    expect(errors.join('\n')).toContain('выходит за checkout')
    expect(anchors('````md\n```\n# Fake\n````\n# Real')).toEqual(new Set(['real']))
    expect(anchors(data['docs/b.md'])).toEqual(new Set(['критерий', 'stable', 'port', 'interface']))
  })
  it('checks reference links and malformed URLs without reading fenced examples', () => {
    const data = {
      'docs/a.md': '[Ref][target] [Unknown][missing] [bad](b.md#%XX)\n[target]: b.md#valid\n```md\n[example](missing.md)\n```',
      'docs/b.md': '# Valid',
    }
    const errors = checkReferences(['docs/a.md'], { repositoryRoot: '/repo', read: (path) => data[path.replace('/repo/', '')], exists: (path) => Object.hasOwn(data, path.replace('/repo/', '')) })
    expect(errors).toHaveLength(2)
    expect(errors.join('\n')).toContain('undefined-reference-missing')
    expect(errors.join('\n')).toContain('неверный URL')
  })
  it('keeps verification separate from implementation and derives deterministic hierarchy/dependency edges', () => {
    const docs = [document('product.education'), document('module.one', { uses: ['product.education'] })]
    docs[0].path = 'docs/product/README.md'; docs[1].path = 'docs/modules/one/README.md'
    const mappings = [{ path: 'src/one.ts', specLink: 'modules/one/README.md' }, { path: 'src/one.test.ts', specLink: 'modules/one/README.md' }]
    const graph = deriveGraph(docs, mappings, '/repo')
    expect(graph.edges.map((edge) => edge.type).sort()).toEqual(['contains', 'implements', 'uses', 'verified-by'])
    expect(renderMermaid(graph)).toContain('-. uses .->')
    expect(JSON.stringify(deriveGraph([...docs].reverse(), mappings, '/repo'))).toBe(JSON.stringify(graph))
  })
  it('derives many-to-many implementation edges from every declared code path without duplicates', () => {
    const root = document('product.education', { code: ['src/one.ts'] })
    const module = document('module.one', { code: ['src/one.ts'] })
    root.path = 'docs/product/README.md'; module.path = 'docs/modules/one/README.md'
    const mappings = [{ path: 'src/one.ts', specLink: 'modules/one/README.md', purpose: 'Runtime', consumer: 'App' }]
    const graph = deriveGraph([root, module], mappings, '/repo')
    const implementationEdges = graph.edges.filter((edge) => edge.type === 'implements')
    expect(implementationEdges).toHaveLength(2)
    expect(implementationEdges).toContainEqual({ from: 'file:src/one.ts', to: 'product.education', type: 'implements' })
    expect(implementationEdges).toContainEqual({ from: 'file:src/one.ts', to: 'module.one', type: 'implements' })
    expect(graph.nodes.filter((node) => node.id === 'file:src/one.ts')).toHaveLength(1)
  })
  it('renders deterministic metadata status with escaped table values and local document/code links', () => {
    const module = document('module.one', { consumers: ['App | operator'], code: ['src/one.ts'] })
    const root = document('product.education', { implementation: 'planned' })
    module.path = 'docs/modules/one/README.md'; root.path = 'docs/product/README.md'
    const generated = renderStatus([module, root], '/repo')
    expect(generated).toBe(renderStatus([root, module], '/repo'))
    expect(generated).toContain('не доказывает смысловую полноту требований или deployment')
    expect(generated).toContain('[docs/modules/one/README.md](../modules/one/README.md)')
    expect(generated).toContain('App \\| operator')
    expect(generated).toContain('[src/one.ts](../../src/one.ts)')
  })
  it('does not silently drop malformed, duplicate or unresolved file bindings', () => {
    const doc = document('product.education'); doc.path = 'docs/product/README.md'
    const rows = [{ invalid: '| broken |' }, { path: 'src/one.ts', specLink: 'missing.md' }, { path: 'src/one.ts', specLink: 'product/README.md' }]
    expect(validateBindings([doc], rows, '/repo').join('\n')).toMatch(/неверная строка/)
    expect(validateBindings([doc], rows, '/repo').join('\n')).toMatch(/нет узла контракта/)
    expect(validateBindings([doc], rows, '/repo').join('\n')).toMatch(/повтор файла/)
  })
  it('requires implementation paths to exist in snapshot, be mapped and carry a direct @see backlink', () => {
    const doc = document('module.one', { code: ['src/one.ts'] }); doc.path = 'docs/modules/one.md'
    const mappings = [{ path: 'src/one.ts', specLink: 'modules/one.md', purpose: 'Runtime', consumer: 'App' }]
    const fileExists = (path) => path.endsWith('/src/one.ts')
    const errors = validateImplementation([doc], mappings, '/repo', { exists: fileExists, read: () => 'const spec = "@see ../docs/modules/one.md"' }).join('\n')
    expect(errors).toContain('требуется @see')
    expect(validateImplementation([doc], mappings, '/repo', { exists: fileExists, read: () => '/** @see ../docs/modules/one.md#runtime */' })).toEqual([])
    expect(validateImplementation([document('module.win', { code: ['C:\\repo\\src\\one.ts'] })], [], '/repo', { exists: () => true, read: () => '' }).join('\n')).toContain('только относительные runtime paths')
    expect(validateImplementation([document('module.dot', { code: ['src/./one.ts'] })], [], '/repo', { exists: () => true, read: () => '' }).join('\n')).toContain('только относительные runtime paths')
    expect(codeAnnotations('const s = "@see ../docs/modules/one.md"; // @see ../docs/modules/one.md')).toEqual(['../docs/modules/one.md'])
    expect(checkReferences(['src/one.ts'], { repositoryRoot: '/repo', read: () => 'const s = "@see ../docs/missing.md"', exists: () => false })).toEqual([])
    expect(validateImplementation([doc], mappings, '/repo', { exists: () => false, read: () => '' }).join('\n')).toContain('отсутствует в снимке')
    expect(validateImplementation([doc], [], '/repo', { exists: fileExists, read: () => '/** @see ../docs/modules/one.md */' }).join('\n')).toContain('строку file-map')
  })
  it('uses only virtual snapshot paths and contents for implementation validation', () => {
    const doc = document('module.one', { code: ['src/virtual.ts'] }); doc.path = 'docs/modules/one.md'
    const virtual = new Map([['src/virtual.ts', '/** @see ../docs/modules/one.md */']])
    const snapshot = {
      exists: (path) => virtual.has(path.replace('/repo/', '')),
      read: (path) => virtual.get(path),
    }
    const mappings = [{ path: 'src/virtual.ts', specLink: 'modules/one.md', purpose: 'Virtual runtime', consumer: 'App' }]
    expect(validateImplementation([doc], mappings, '/repo', snapshot)).toEqual([])
    expect(validateImplementation([doc], mappings, '/repo', { exists: () => false, read: () => { throw new Error('must not read absent worktree file') } }).join('\n')).toContain('отсутствует в снимке')
  })
})
