/** Fixed recipes preserve fresh inbox evidence without scanning it twice.
 * @see ../docs/architecture/operator-core.md#operation-contract */
const recipes = Object.freeze({
  status: ['project.plan', 'inbox.snapshot', 'queue.list'],
  discover: ['queue.scan', 'project.plan'],
  finalize: ['queue.scan'],
})

export async function executeRecipe(name, run) {
  const operations = recipes[name]
  if (!operations) throw new Error(`Unknown operator recipe: ${name}`)
  const stages = []
  for (const operation of operations) {
    const result = await run({ schemaVersion: 1, operation, input: {} })
    stages.push(result)
    if (operation === 'queue.scan' && result.summary?.inbox?.complete !== true
      || operation === 'inbox.snapshot' && result.summary?.complete !== true) {
      throw new Error(`${operation}: inbox is incomplete; do not treat it as empty. Inspect ${result.journal}`)
    }
  }
  return { schemaVersion: 1, stages }
}
