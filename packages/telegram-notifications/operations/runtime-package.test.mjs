/** @see ../../../docs/services/telegram-bot/operations.md#release-retention */
import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import { resolve } from 'node:path'
import ts from 'typescript'
import { dependencyClosure } from './launch-agent.mjs'

const root = resolve(import.meta.dirname, '../../..')
const readJson = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'))
const runtime = 'packages/telegram-notifications/runtime/'

it('locks precisely the bare packages imported by the complete worker closure', () => {
  const imports = new Set()
  for (const file of dependencyClosure(root)) {
    const ast = ts.createSourceFile(file, readFileSync(resolve(root, file), 'utf8'), ts.ScriptTarget.Latest, true)
    const visit = node => {
      const specifier = (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) ? node.moduleSpecifier
        : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword ? node.arguments[0] : null
      if (specifier && ts.isStringLiteral(specifier)) {
        const value = specifier.text
        if (!value.startsWith('.') && !isBuiltin(value)) imports.add(value.startsWith('@')
          ? value.split('/').slice(0, 2).join('/') : value.split('/')[0])
      }
      ts.forEachChild(node, visit)
    }
    visit(ast)
  }
  const manifest = readJson(runtime + 'package.json')
  const lock = readJson(runtime + 'package-lock.json')
  expect(Object.keys(manifest.dependencies).sort()).toEqual([...imports].sort())
  expect(lock.packages[''].dependencies).toEqual(manifest.dependencies)
  expect(manifest.devDependencies).toBeUndefined()
  expect(manifest.scripts).toBeUndefined()
  for (const name of imports) expect(lock.packages['node_modules/' + name]).toBeDefined()
  for (const name of ['react', 'react-dom', 'lucide-react', 'firebase', '@firebase/app',
    'tailwindcss', '@tailwindcss/vite', 'shiki', 'vite']) expect(lock.packages['node_modules/' + name]).toBeUndefined()
})
