/** @see ../docs/decisions/collapsed-variant-status-2026-10-21.md */
/** Literal UI labels are checked without interpreting source data or accessibility names.
 * @see ../docs/shared/design/README.md#controls */
import ts from 'typescript'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stagedSnapshot } from './check-docs.mjs'

const forbidden = /(?:^|[^\p{L}])(?:по\s+желанию|обязательно|опционально)(?=$|[^\p{L}])/iu
const labelTags = new Set(['summary', 'button', 'span', 'small', 'strong', 'b', 'label', 'p'])

export function visibleRequirementCopyProblems(filename, source) {
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const problems = []
  const bindings = new Map()
  function collect(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const entries = bindings.get(node.name.text) ?? []
      entries.push(node.initializer)
      bindings.set(node.name.text, entries)
    }
    ts.forEachChild(node, collect)
  }
  collect(tree)
  function literalCopy(node, seen = new Set()) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
      || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) return [node.text]
    if (ts.isIdentifier(node)) {
      if (seen.has(node.text)) return []
      const definitions = bindings.get(node.text) ?? []
      // Ambiguous scopes and incoming/object data require component tests.
      if (definitions.length !== 1) return []
      const next = new Set(seen).add(node.text)
      return literalCopy(definitions[0], next)
    }
    if (ts.isCallExpression(node) || ts.isPropertyAccessExpression(node)
      || ts.isElementAccessExpression(node) || ts.isObjectLiteralExpression(node)
      || ts.isArrayLiteralExpression(node)) return []
    const values = []
    ts.forEachChild(node, child => { values.push(...literalCopy(child, seen)) })
    return values
  }
  function visibleLabel(node) {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (ts.isJsxAttribute(parent)) return false
      if (ts.isJsxElement(parent)) return labelTags.has(parent.openingElement.tagName.getText(tree))
    }
    return false
  }
  function visit(node) {
    if (ts.isJsxExpression(node) && node.expression && visibleLabel(node)
      && literalCopy(node.expression).some(copy => forbidden.test(copy))) {
      const line = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1
      problems.push(`${filename}:${line}: вычисляемая подпись обязательности дублирует переключатель.`)
      return
    }
    if ((ts.isJsxText(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
      || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node))
      && forbidden.test(node.text) && visibleLabel(node)) {
      const line = tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1
      problems.push(`${filename}:${line}: обязательность обозначает переключатель; видимая подпись дублирует его.`)
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return problems
}

export function checkRequirementCopy(root, { staged = false } = {}) {
  const snapshot = staged ? stagedSnapshot(root) : null
  function walk(directory) {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
      ? walk(resolve(directory, entry.name)) : [relative(root, resolve(directory, entry.name))])
  }
  const paths = (snapshot?.paths ?? walk(resolve(root, 'src')))
    .filter(path => path.startsWith('src/') && path.endsWith('.tsx') && !path.includes('.test.'))
  return paths.flatMap(path => visibleRequirementCopyProblems(path,
    snapshot ? snapshot.read(resolve(root, path)) : readFileSync(resolve(root, path), 'utf8')))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = checkRequirementCopy(resolve('.'), { staged: process.argv.includes('--staged') })
  if (problems.length) { console.error(problems.join('\n')); process.exitCode = 1 }
  else console.log('Подписи переключателей: видимые текстовые дубли отсутствуют.')
}
