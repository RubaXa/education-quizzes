// @see ../docs/shared/specification-system.md
import { describe, expect, it } from 'vitest'
import { parseMetadata, validateMetadata, validateStructure, anchors, checkReferences, deriveGraph, renderMermaid, validateBindings } from './spec-graph.mjs'

const document = (id, extra = {}) => ({
  path: `${id}.md`, text: '# Contract',
  metadata: { id, status: 'accepted', implementation: 'partial', sections: [], uses: [], ...(id === 'product.education' ? {} : { parent: 'product.education' }), ...extra },
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
  it('does not silently drop malformed, duplicate or unresolved file bindings', () => {
    const doc = document('product.education'); doc.path = 'docs/product/README.md'
    const rows = [{ invalid: '| broken |' }, { path: 'src/one.ts', specLink: 'missing.md' }, { path: 'src/one.ts', specLink: 'product/README.md' }]
    expect(validateBindings([doc], rows, '/repo').join('\n')).toMatch(/неверная строка/)
    expect(validateBindings([doc], rows, '/repo').join('\n')).toMatch(/нет узла контракта/)
    expect(validateBindings([doc], rows, '/repo').join('\n')).toMatch(/повтор файла/)
  })
})
