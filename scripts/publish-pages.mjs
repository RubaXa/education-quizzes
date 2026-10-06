import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const remote = 'https://github.com/RubaXa/education-quizzes.git'
const pagesDir = resolve('.local/pages')
const distDir = resolve('dist')

function git(...args) {
  return execFileSync('git', args, { cwd: pagesDir, stdio: 'inherit' })
}

if (!existsSync(resolve(distDir, 'index.html'))) {
  throw new Error('Сначала соберите сайт командой npm run build.')
}

if (!existsSync(resolve(pagesDir, '.git'))) {
  mkdirSync(pagesDir, { recursive: true })
  let branchExists = true
  try {
    execFileSync('git', ['ls-remote', '--exit-code', '--heads', remote, 'gh-pages'], { stdio: 'ignore' })
  } catch {
    branchExists = false
  }
  if (branchExists) {
    execFileSync('git', ['clone', '--branch', 'gh-pages', '--single-branch', remote, pagesDir], { stdio: 'inherit' })
  } else {
    git('init', '-b', 'gh-pages')
    git('remote', 'add', 'origin', remote)
  }
} else {
  git('pull', '--ff-only', 'origin', 'gh-pages')
}

for (const entry of readdirSync(pagesDir)) {
  if (entry !== '.git') rmSync(resolve(pagesDir, entry), { recursive: true, force: true })
}
for (const entry of readdirSync(distDir)) {
  cpSync(resolve(distDir, entry), resolve(pagesDir, entry), { recursive: true })
}
writeFileSync(resolve(pagesDir, '.nojekyll'), '')

git('add', '-A')
const changed = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: pagesDir, encoding: 'utf8' }).trim()
if (changed) {
  git('commit', '-m', 'Publish quiz site')
  git('push', '-u', 'origin', 'gh-pages')
}
console.log('Сайт: https://rubaxa.github.io/education-quizzes/')
