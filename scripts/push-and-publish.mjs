import { execFileSync } from 'node:child_process'

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim()
}

if (git('branch', '--show-current') !== 'main') {
  console.error('Публиковать можно только основную ветку main.')
  process.exit(1)
}
if (git('status', '--porcelain')) {
  console.error('Сначала сохраните или уберите локальные изменения.')
  process.exit(1)
}

execFileSync('git', ['push', 'origin', 'main'], { stdio: 'inherit' })
execFileSync('npm', ['run', 'publish:pages'], { stdio: 'inherit' })
