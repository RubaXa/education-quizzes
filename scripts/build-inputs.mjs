import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const root = resolve('.')
const inputs = [
  'src', 'public', 'pwa', 'packages', 'day', 'scripts/generate-sw.mjs', 'index.html', 'vite.config.ts', 'package.json',
  'package-lock.json', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json',
]

/** @see ../docs/product/pwa.md */
export function isBuildInput(path) {
  return !/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path)
}

function addInput(hash, path, baseRoot) {
  if (!existsSync(path)) return
  if (statSync(path).isDirectory()) {
    for (const entry of readdirSync(path).sort()) addInput(hash, join(path, entry), baseRoot)
    return
  }
  if (!isBuildInput(path)) return
  hash.update(relative(baseRoot, path)).update('\0').update(readFileSync(path)).update('\0')
}

export function buildFingerprint(projectRoot = root) {
  const hash = createHash('sha256')
  for (const input of inputs) addInput(hash, resolve(projectRoot, input), projectRoot)
  return hash.digest('hex')
}
