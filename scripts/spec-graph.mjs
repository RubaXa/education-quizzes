/** Validate repository knowledge and derive the graph from specs and file-map.
 * @see ../docs/shared/specification-system.md
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = resolve(import.meta.dirname, '..')
const slash = (value) => value.replaceAll('\\', '/')
const scalar = (value) => value.trim().replace(/^(['"])(.*)\1$/, '$2')
const specDirectories = /^docs\/(product|services|modules|shared|operations|decisions|research|audits|plans)\/.*\.md$/
const allowedStatuses = new Set(['draft', 'accepted', 'superseded', 'reference'])
const allowedImplementations = new Set(['planned', 'partial', 'implemented', 'not-applicable'])

export function parseMetadata(source) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!match) return null
  const result = {}
  let listKey
  for (const line of match[1].split(/\r?\n/)) {
    const key = line.match(/^([a-z][a-z_-]*):\s*(.*)$/)
    if (key) {
      listKey = undefined
      const [, name, value] = key
      if (value === '' || value.trim() === '[]') {
        result[name] = []
        listKey = name
      } else if (value.trim().startsWith('[')) {
        result[name] = value.trim().slice(1, -1).split(',').map(scalar).filter(Boolean)
      } else result[name] = scalar(value)
    } else if (listKey) {
      const item = line.match(/^\s+-\s+(.+)$/)
      if (item) result[listKey].push(scalar(item[1]))
    }
  }
  return result
}

export function validateMetadata(documents) {
  const problems = []
  const byId = new Map()
  for (const { path, text, metadata } of documents) {
    if (!metadata || typeof metadata.id !== 'string' || !/^[a-z][a-z0-9.-]+$/.test(metadata.id)) {
      problems.push(`${path}: требуется устойчивый id в YAML-заголовке.`)
      continue
    }
    if (byId.has(metadata.id)) problems.push(`${path}: повтор id ${metadata.id} (${byId.get(metadata.id).path}).`)
    byId.set(metadata.id, { path, metadata })
    if (!allowedStatuses.has(metadata.status)) problems.push(`${path}: неизвестный status ${metadata.status}.`)
    if (!allowedImplementations.has(metadata.implementation)) problems.push(`${path}: неизвестный implementation ${metadata.implementation}.`)
    if (!Array.isArray(metadata.uses)) problems.push(`${path}: uses должен быть списком ID (либо []).`)
    if (text.replace(/\r?\n$/, '').split(/\r?\n/).length > 700) problems.push(`${path}: спецификация превышает 700 строк.`)
    if (metadata.id !== 'product.education' && typeof metadata.parent !== 'string') problems.push(`${path}: требуется parent.`)
    if (metadata.id === 'product.education' && metadata.parent) problems.push(`${path}: корень продукта не должен иметь parent.`)
  }
  if (!byId.has('product.education')) problems.push('Отсутствует корень product.education.')
  for (const { path, metadata } of documents) {
    if (!metadata?.id) continue
    if (metadata.parent && !byId.has(metadata.parent)) problems.push(`${path}: не найден parent ${metadata.parent}.`)
    for (const target of Array.isArray(metadata.uses) ? metadata.uses : []) {
      if (!byId.has(target)) problems.push(`${path}: неизвестный uses ${target}.`)
      if (target === metadata.id) problems.push(`${path}: uses ссылается на собственный id.`)
    }
    const visited = new Set([metadata.id])
    let cursor = metadata.parent
    while (cursor && byId.has(cursor)) {
      if (visited.has(cursor)) { problems.push(`${path}: цикл parent через ${cursor}.`); break }
      visited.add(cursor)
      cursor = byId.get(cursor).metadata.parent
    }
  }
  return problems
}

function outsideFences(source) {
  let fence
  return source.split(/\r?\n/).map((line) => {
    const delimiter = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
    if (!fence && delimiter) { fence = delimiter[1]; return '' }
    if (fence) {
      if (delimiter && delimiter[1][0] === fence[0] && delimiter[1].length >= fence.length && !delimiter[2].trim()) fence = undefined
      return ''
    }
    return line
  }).join('\n')
}

export function headings(source) {
  const body = outsideFences(source.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, ''))
  const result = []
  const counts = new Map()
  for (const line of body.split(/\r?\n/)) {
    const match = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/)
    if (!match) continue
    const explicit = match[2].match(/\{#([^}]+)\}/)?.[1]
    const slug = match[2].replace(/\{#[^}]+\}/g, '').replace(/<[^>]*>/g, '').toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '').trim().replace(/\s/g, '-')
    const count = counts.get(slug) ?? 0
    counts.set(slug, count + 1)
    result.push({ level: match[1].length, title: match[2], anchor: explicit ?? (count ? `${slug}-${count}` : slug) })
  }
  return result
}

export function validateStructure(documents) {
  const problems = []
  for (const { path, text, metadata } of documents) {
    const headers = headings(text)
    if (headers.filter((item) => item.level === 1).length !== 1) problems.push(`${path}: требуется ровно один заголовок H1.`)
    let previous = 0
    for (const header of headers) {
      if (!header.anchor) problems.push(`${path}: пустой заголовок.`)
      if (header.level > previous + 1) problems.push(`${path}: пропущен уровень заголовка у ${header.title}.`)
      previous = header.level
    }
    const expected = metadata?.sections
    const actual = headers.filter((item) => item.level === 2).map((item) => item.anchor)
    if (!Array.isArray(expected) || expected.some((item) => typeof item !== 'string' || !item) || new Set(expected).size !== expected.length) {
      problems.push(`${path}: sections должен быть списком уникальных якорей обязательных H2 (либо []).`)
    } else if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      problems.push(`${path}: обязательные разделы sections не совпадают с H2 или их порядком; ожидается ${JSON.stringify(expected)}, найдено ${JSON.stringify(actual)}.`)
    }
  }
  return problems
}

export function anchors(source) {
  const body = outsideFences(source)
  const found = new Set()
  for (const header of headings(source)) found.add(header.anchor)
  for (const item of body.matchAll(/\b(?:id|name)=["']([^"']+)["']/g)) found.add(item[1])
  // Preserve both renderer-generated and explicit heading anchors.
  for (const header of headings(source.replace(/\{#[^}]+\}/g, ''))) found.add(header.anchor)
  return found
}

export function localReferences(source, { code = false } = {}) {
  const refs = []
  if (!code) {
    // Ignore examples, but still validate inline code inside real link labels.
    const body = outsideFences(source)
    const definitions = new Map()
    for (const match of body.matchAll(/^ {0,3}\[([^\]]+)\]:\s*(<[^>]+>|\S+)/gm)) definitions.set(match[1].trim().toLowerCase(), match[2].replace(/^<|>$/g, ''))
    for (const match of body.matchAll(/!?\[([^\]\n]+)\]\[([^\]\n]*)\]/g)) {
      const id = (match[2] || match[1]).trim().toLowerCase()
      refs.push(definitions.get(id) ?? `#undefined-reference-${id}`)
    }
    for (const ref of definitions.values()) refs.push(ref)
    for (const match of body.matchAll(/!?\[[^\]\n]*\]\((<[^>]+>|[^\s)]+)(?:\s+["'][^\n]*?["'])?\)/g)) {
      refs.push(match[1].replace(/^<|>$/g, ''))
    }
  }
  for (const match of source.matchAll(/@see\s+([^\s*]+)/g)) {
    if (match[1].includes('docs/') || match[1].endsWith('.md')) refs.push(match[1])
  }
  return refs.filter((ref) => !/^[a-z][a-z0-9+.-]*:/i.test(ref) && !ref.startsWith('//'))
}

export function checkReferences(files, { repositoryRoot, read, exists }) {
  const problems = []
  for (const path of files) {
    const code = !path.endsWith('.md')
    for (const ref of localReferences(read(path), { code })) {
      const [filePart, fragment] = ref.split('#', 2)
      let decoded, decodedFragment
      try { decoded = decodeURIComponent(filePart); decodedFragment = decodeURIComponent(fragment ?? '') } catch { problems.push(`${path}: неверный URL ${ref}.`); continue }
      const target = decoded ? resolve(repositoryRoot, dirname(path), decoded) : resolve(repositoryRoot, path)
      if (relative(repositoryRoot, target).startsWith('..')) {
        problems.push(`${path}: ссылка выходит за checkout (${ref}); используй явный petr-private: reference.`)
      } else if (!exists(target)) problems.push(`${path}: отсутствует локальная ссылка ${ref}.`)
      else if (fragment && target.endsWith('.md') && !anchors(read(target)).has(decodedFragment)) {
        problems.push(`${path}: отсутствует якорь ${ref}.`)
      }
    }
  }
  return problems
}

export function parseFileMap(source) {
  return source.split(/\r?\n/).filter((line) => line.startsWith('| [')).map((line) => {
    const match = line.match(/^\| \[([^\]]+)\]\(([^)]+)\) \| \[[^\]]+\]\(([^)]+)\) \| ([^|]+) \| ([^|]+) \|$/)
    return match ? { path: match[1], fileLink: match[2], specLink: match[3], purpose: match[4].trim(), consumer: match[5].trim() } : { invalid: line }
  })
}

export function deriveGraph(documents, mappings, repositoryRoot) {
  const nodes = documents.map(({ path, metadata }) => ({ ...metadata, path }))
  const byPath = new Map(nodes.map((node) => [node.path, node.id]))
  const edges = []
  for (const node of nodes) {
    if (node.parent) edges.push({ from: node.parent, to: node.id, type: 'contains' })
    for (const target of node.uses) edges.push({ from: node.id, to: target, type: 'uses' })
  }
  for (const item of mappings) {
    if (item.invalid || byPath.has(item.path)) continue
    const specPath = slash(relative(repositoryRoot, resolve(repositoryRoot, 'docs', item.specLink.split('#')[0])))
    const target = byPath.get(specPath)
    if (!target) continue
    const id = `file:${item.path}`
    nodes.push({ id, path: item.path, kind: /\.test\./.test(item.path) ? 'verification' : 'artifact', purpose: item.purpose, consumer: item.consumer })
    edges.push(/\.test\./.test(item.path)
      ? { from: target, to: id, type: 'verified-by' }
      : { from: id, to: target, type: 'implements' })
  }
  return {
    schemaVersion: 1,
    nodes: nodes.sort((a, b) => a.id.localeCompare(b.id, 'en')),
    edges: edges.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), 'en')),
  }
}

export function validateBindings(documents, mappings, repositoryRoot) {
  const specs = new Set(documents.filter((doc) => doc.metadata?.id).map((doc) => doc.path))
  const seen = new Set()
  const problems = []
  for (const row of mappings) {
    if (row.invalid) { problems.push(`file-map: неверная строка ${row.invalid}`); continue }
    if (seen.has(row.path)) problems.push(`file-map: повтор файла ${row.path}.`)
    seen.add(row.path)
    const target = slash(relative(repositoryRoot, resolve(repositoryRoot, 'docs', row.specLink.split('#')[0])))
    if (!specs.has(target)) problems.push(`file-map: у ${row.path} нет узла контракта ${target}.`)
  }
  return problems
}

export function renderMermaid(graph) {
  const specs = graph.nodes.filter((node) => !node.id.startsWith('file:'))
  const names = new Map(specs.map((node, i) => [node.id, `s${i}`]))
  const lines = ['%% Generated by npm run specs:generate; edit spec metadata and docs/file-map.md.', 'flowchart TD']
  for (const node of specs) lines.push(`  ${names.get(node.id)}["${node.id}"]`)
  for (const edge of graph.edges) {
    if (!names.has(edge.from) || !names.has(edge.to)) continue
    lines.push(`  ${names.get(edge.from)} ${edge.type === 'uses' ? '-. uses .->' : '-->'} ${names.get(edge.to)}`)
  }
  return `${lines.join('\n')}\n`
}

export function inspectRepository(repositoryRoot = root, snapshot) {
  const paths = snapshot?.paths ?? execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: repositoryRoot, encoding: 'utf8' })
    .split('\0').filter((path) => path && existsSync(resolve(repositoryRoot, path)))
  const read = snapshot?.read ?? ((path) => readFileSync(resolve(repositoryRoot, path), 'utf8'))
  const specPaths = paths.filter((path) => specDirectories.test(path) || ['ARCHITECTURE.md', 'docs/README.md'].includes(path))
  const documents = specPaths.map((path) => ({ path, text: read(path), metadata: parseMetadata(read(path)) }))
  const problems = [...validateMetadata(documents), ...validateStructure(documents)]
  const references = paths.filter((path) => path.endsWith('.md') && !path.startsWith('docs/generated/')
    || /\.(ts|tsx|js|mjs|css|rules)$/.test(path))
  problems.push(...checkReferences(references, { repositoryRoot, read, exists: snapshot?.exists ?? existsSync }))
  if (!(snapshot?.exists ?? existsSync)(resolve(repositoryRoot, 'docs/file-map.md'))) return { problems: [...problems, 'Отсутствует docs/file-map.md.'], documents }
  const mappings = parseFileMap(read('docs/file-map.md'))
  problems.push(...validateBindings(documents, mappings, repositoryRoot))
  const actual = new Set(paths)
  const mapped = new Set(mappings.filter((row) => !row.invalid).map((row) => row.path))
  for (const path of actual) if (!mapped.has(path)) problems.push(`file-map: файл без контракта ${path}.`)
  for (const path of mapped) if (!actual.has(path)) problems.push(`file-map: запись без файла ${path}.`)
  for (const row of mappings.filter((item) => !item.invalid)) {
    if (slash(relative(repositoryRoot, resolve(repositoryRoot, 'docs', row.fileLink))) !== row.path) problems.push(`file-map: неверная ссылка файла ${row.path}.`)
  }
  if (problems.length) return { problems, documents }
  const graph = deriveGraph(documents, mappings, repositoryRoot)
  const generated = new Map([
    ['docs/generated/graph.json', `${JSON.stringify(graph, null, 2)}\n`],
    ['docs/generated/graph.mmd', renderMermaid(graph)],
  ])
  return { problems, documents, graph, generated }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = inspectRepository()
  if (!result.problems.length) {
    for (const [path, content] of result.generated) {
      if (process.argv.includes('--write')) {
        mkdirSync(dirname(resolve(root, path)), { recursive: true })
        writeFileSync(resolve(root, path), content)
      } else if (!existsSync(resolve(root, path)) || readFileSync(resolve(root, path), 'utf8') !== content) {
        result.problems.push(`${path}: устарел производный граф; выполни npm run specs:generate.`)
      }
    }
  }
  if (result.problems.length) {
    for (const problem of result.problems) console.error(problem)
    process.exitCode = 1
  } else console.log(`Граф спецификаций: ${result.documents.length} документов, ${result.graph.nodes.length} узлов, ${result.graph.edges.length} связей; ссылки, статусы и предел 700 строк проверены.`)
}
