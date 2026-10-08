import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const root = resolve('.')
const inputs = [
  'src', 'public', 'pwa', 'scripts/generate-sw.mjs', 'index.html', 'vite.config.ts', 'package.json',
  'package-lock.json', 'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json',
]

function addInput(hash, path) {
  if (!existsSync(path)) return
  if (statSync(path).isDirectory()) {
    for (const entry of readdirSync(path).sort()) addInput(hash, join(path, entry))
    return
  }
  hash.update(relative(root, path)).update('\0').update(readFileSync(path)).update('\0')
}

export function buildFingerprint() {
  const hash = createHash('sha256')
  for (const input of inputs) addInput(hash, resolve(input))
  return hash.digest('hex')
}
