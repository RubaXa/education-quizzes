#!/usr/bin/env node
/**
 * Retired alias: upload processing now runs inside the unified Telegram runtime.
 * This script intentionally never installs/starts a separate LaunchAgent.
 * @see ../docs/services/upload-worker/README.md
 * @see ../docs/modules/synchronization/education-pipeline.md
 * @see ../docs/modules/synchronization/event-queue.md
 * @see ../docs/operations/deployment.md
 */
export const replacementCommand = 'npm run telegram:install-worker -- --apply'

export function main({ write = console.error } = {}) {
  write(`The standalone upload worker has been retired. Install the unified Education runtime with: ${replacementCommand}`)
  return 2
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = main()
