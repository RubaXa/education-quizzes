/** @see ../docs/operations/deployment.md */
import { execFileSync } from 'node:child_process'

export function assertReleaseSource({ dirty, sourceTree, mainTree }) {
  if (dirty) throw new Error('Публикация остановлена: сохраните рабочие изменения и объедините их с main.')
  if (sourceTree !== mainTree) throw new Error('Публикация остановлена: исходники отличаются от актуального origin/main. Объедините проверенные изменения через PR; старый артефакт gh-pages не восстанавливайте.')
}

export function confirmReleaseSource(expected) {
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()
  execFileSync('git', ['fetch', 'origin', 'main'], { stdio: 'inherit' })
  const sourceCommit = git('rev-parse', 'HEAD')
  const mainCommit = git('rev-parse', 'origin/main')
  const sourceTree = git('rev-parse', 'HEAD^{tree}')
  assertReleaseSource({ dirty: git('status', '--porcelain', '--untracked-files=normal'), sourceTree, mainTree: git('rev-parse', 'origin/main^{tree}') })
  if (expected && (expected.sourceCommit !== sourceCommit || expected.mainCommit !== mainCommit)) {
    throw new Error('Исходники или main изменились во время сборки. Повторите проверку и выпуск из актуального main.')
  }
  return { sourceCommit, mainCommit, sourceTree }
}
