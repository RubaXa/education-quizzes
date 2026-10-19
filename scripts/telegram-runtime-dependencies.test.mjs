import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { builtinModules } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import packageJson from '../package.json' with { type: 'json' }

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const entryPoints = ['scripts/telegram-bot.mjs', 'scripts/education-sync-dispatch.mjs']
const importPattern = /(?:\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?|\bimport\s*\()(['"])([^'"\n]+)\1/g
const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]))

function packageName(specifier) {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/')
  return specifier.split('/')[0]
}

function runtimeImports(file, visited = new Set(), imports = new Set()) {
  if (visited.has(file)) return imports
  visited.add(file)
  const source = readFileSync(file, 'utf8')
  for (const match of source.matchAll(new RegExp(importPattern))) {
    const specifier = match[2]
    if (specifier.startsWith('.')) {
      const importedFile = resolve(dirname(file), specifier)
      runtimeImports(importedFile, visited, imports)
    } else if (!builtins.has(specifier)) imports.add(packageName(specifier))
  }
  return imports
}

describe('Telegram production runtime dependency closure', () => {
  it('uses production dependencies only throughout the worker and dispatch CLI import graphs', () => {
    const importedPackages = new Set()
    for (const entry of entryPoints) runtimeImports(resolve(root, entry), new Set(), importedPackages)

    const runtimeDependencies = new Set(Object.keys(packageJson.dependencies ?? {}))
    const devOnlyImports = [...importedPackages].filter((name) => !runtimeDependencies.has(name))
    expect(devOnlyImports).toEqual([])
    expect(importedPackages).not.toContain('firebase-admin')
  })

  it('can load the production worker and dispatch CLI entry points without starting either process', () => {
    execFileSync(process.execPath, ['--input-type=module', '-e',
      "await import('./scripts/telegram-bot.mjs'); await import('./scripts/education-sync-dispatch.mjs')"], { cwd: root })
  })
})
