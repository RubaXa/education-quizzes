import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { buildFingerprint } from './build-inputs.mjs'
import { loadReleaseNote } from './release-note.mjs'

const remote = 'https://github.com/RubaXa/education-quizzes.git'
const pagesDir = resolve('.local/pages')
const distDir = resolve('dist')
const buildMarker = resolve(pagesDir, '.build-inputs.sha256')
const dryRun = process.argv.includes('--dry-run')
const prepareOnly = process.argv.includes('--prepare-only')
const releaseNoteIndex = process.argv.indexOf('--release-note')
const releaseNotePath = releaseNoteIndex >= 0 ? process.argv[releaseNoteIndex + 1] : undefined
const silentReasonIndex = process.argv.indexOf('--silent-reason')
const silentReason = silentReasonIndex >= 0 ? process.argv[silentReasonIndex + 1] : undefined
if (releaseNotePath && silentReason) throw new Error('Укажите либо --release-note, либо --silent-reason.')
if (releaseNoteIndex >= 0 && (!releaseNotePath || releaseNotePath.startsWith('--'))) throw new Error('После --release-note нужен JSON-файл в .local/.')
if (silentReasonIndex >= 0 && (!silentReason || silentReason.startsWith('--') || silentReason.trim().length < 12)) throw new Error('После --silent-reason нужна причина от 12 символов.')

async function announceRelease() {
  if (!releaseNotePath || dryRun || prepareOnly) return
  const builtHtml = readFileSync(resolve(pagesDir, 'index.html'), 'utf8')
  const scriptAsset = builtHtml.match(/assets\/[^"']+\.js/)?.[0]
  if (!scriptAsset) throw new Error('В сборке не найден основной JS-файл; выпуск новости остановлен.')
  const site = 'https://rubaxa.github.io/education-quizzes/'
  let live = false
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const response = await fetch(site, { cache: 'no-store', signal: AbortSignal.timeout(8000) })
      if (response.ok && (await response.text()).includes(scriptAsset)) { live = true; break }
    } catch { /* GitHub Pages may still be building; retry the published HTML. */ }
    await delay(3000)
  }
  if (!live) throw new Error('Новая версия сайта пока не видна на GitHub Pages. Новость не отправлена; повторите команду после появления сайта.')
  // A failed Firestore write must fail the release command. Repeating it is safe: IDs are stable.
  execFileSync('node', [resolve('scripts/notifications.mjs'), 'publish', releaseNotePath], { stdio: 'inherit' })
}

function git(...args) {
  return execFileSync('git', args, { cwd: pagesDir, stdio: 'inherit' })
}

function preparePagesBranch() {
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
}

preparePagesBranch()
const currentFingerprint = buildFingerprint()
if (existsSync(buildMarker) && readFileSync(buildMarker, 'utf8').trim() === currentFingerprint) {
  console.log('Сайт уже собран из этих исходников. Повторная сборка не нужна.')
  await announceRelease()
  process.exit(0)
}
if (dryRun) {
  console.log('Есть изменения сайта. Для публикации выполните npm run publish:pages.')
  process.exit(0)
}
if (!prepareOnly && !releaseNotePath && !silentReason) {
  throw new Error('Для публикации сайта подготовьте --release-note .local/release.json либо укажите --silent-reason для незаметного изменения.')
}
if (releaseNotePath) loadReleaseNote(releaseNotePath)

execFileSync('npm', ['run', 'build'], { stdio: 'inherit' })
if (!existsSync(resolve(distDir, 'index.html'))) throw new Error('Сборка не создала dist/index.html.')
if (existsSync(resolve(distDir, 'materials'))) throw new Error('Сборка содержит страницы учебников: публикация остановлена.')

for (const entry of readdirSync(pagesDir)) {
  if (entry !== '.git') rmSync(resolve(pagesDir, entry), { recursive: true, force: true })
}
for (const entry of readdirSync(distDir)) {
  cpSync(resolve(distDir, entry), resolve(pagesDir, entry), { recursive: true })
}
writeFileSync(resolve(pagesDir, '.nojekyll'), '')
writeFileSync(buildMarker, `${currentFingerprint}\n`)

git('add', '-A')
const changed = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: pagesDir, encoding: 'utf8' }).trim()
if (changed) {
  git('commit', '-m', 'Publish quiz site')
  if (!prepareOnly) {
    execFileSync('node', [resolve('scripts/check-privacy.mjs'), '--history'], { cwd: pagesDir, stdio: 'inherit' })
    git('push', '-u', 'origin', 'gh-pages')
  }
}
console.log(prepareOnly ? 'Сборка сайта подготовлена локально; отправки в GitHub не было.' : 'Сайт: https://rubaxa.github.io/education-quizzes/')
await announceRelease()
