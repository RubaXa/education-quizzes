#!/usr/bin/env node
/** Single deterministic entry point for Education operator operations.
 * @see ../docs/architecture/operator-core.md#operation-contract */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { operationCatalog } from '../operator/operation-contract.mjs'
import { executeOperation } from '../operator/run-operation.mjs'

const [command, argument, flag] = process.argv.slice(2)
const apply = process.argv.includes('--apply')
const root = resolve(import.meta.dirname, '..')
const request = (operation) => ({ schemaVersion: 1, operation, input: {} })
const run = (data) => executeOperation(data, { apply, root })
const output = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)

try {
  if (command === 'catalog' && !argument) output({ schemaVersion: 1, operations: operationCatalog() })
  else if (command === 'run' && argument && (!flag || flag === '--apply')) {
    output(await run(JSON.parse(readFileSync(resolve(argument), 'utf8'))))
  } else if (command === 'status' && !argument) {
    output({ schemaVersion: 1, stages: [
      await run(request('project.plan')),
      await run(request('inbox.snapshot')),
      await run(request('queue.list')),
    ] })
  } else if (command === 'discover' && argument === '--apply') {
    output({ schemaVersion: 1, stages: [
      await run(request('queue.scan')),
      await run(request('project.plan')),
      await run(request('inbox.snapshot')),
    ] })
  } else if (command === 'finalize' && argument === '--apply') {
    output({ schemaVersion: 1, stages: [
      await run(request('inbox.snapshot')),
      await run(request('queue.scan')),
    ] })
  } else if (command === 'result' && argument && !flag) {
    const id = /^[a-f0-9-]{36}$/.test(argument) ? argument : null
    if (!id) throw new Error('Result requires a run UUID.')
    const item = JSON.parse(readFileSync(resolve(root, `.local/operator-runs/${id}.json`), 'utf8'))
    output({ schemaVersion: 1, runId: item.runId, operation: item.operation, status: item.status,
      summary: item.summary ?? null, metrics: item.metrics ?? null, startedAt: item.startedAt,
      finishedAt: item.finishedAt ?? null })
  } else {
    throw new Error('Usage: npm run education -- catalog | status | discover --apply | finalize --apply | run REQUEST.json [--apply] | result RUN_UUID')
  }
} catch (error) {
  console.error(String(error?.message ?? error))
  process.exitCode = 1
}
