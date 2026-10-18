/** Read-only, local browser receipt tools. Never uploads logs or changes authentication.
 * @see ../docs/modules/families/browser-access-trace.md */
import { readFile, stat } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { inspectAccessTrace } from '../src/lib/browserAccessTrace.ts'

export const browserTraceSnippet = "copy(await import('/education-quizzes/access-snapshot.js?v=1').then(m => m.collectBrowserAccessSnapshot()))"

export function summarizeReceipt(input) {
  if (!input || input.schemaVersion !== 1 || !Array.isArray(input.events)) throw new Error('Expected Education access trace schemaVersion 1')
  const baseline = input.baseline ?? {}
  return { ...inspectAccessTrace(input), complete: input.complete === true,
    droppedRecords: Number.isSafeInteger(input.droppedRecords) && input.droppedRecords >= 0 ? input.droppedRecords : null,
    coverageUnknown: input.coverageUnknown === true || input.complete === undefined, baseline: {
    roles: Array.isArray(baseline.roles) ? baseline.roles.filter(role => ['parent','student'].includes(role)) : [],
    bundles: Array.isArray(baseline.bundles) ? baseline.bundles.filter(file => typeof file === 'string' && /^index-[A-Za-z0-9_-]{1,64}\.js$/.test(file)) : [],
    parentGuide: baseline.parentGuide === true, studentUpload: baseline.studentUpload === true,
    sessionProfileMatch: baseline.sessionProfileMatch === true,
    person: typeof baseline.person === 'string' && /^[a-f0-9]{24}$/.test(baseline.person) ? baseline.person : null,
    device: typeof baseline.device === 'string' && /^[a-f0-9]{24}$/.test(baseline.device) ? baseline.device : null,
  }, limitation: input.events.length ? 'Findings describe this receipt; compare with visible UI and authoritative membership.' : 'Baseline only: this build has no execution trace; past role decisions cannot be reconstructed.' }
}
export async function main(args) {
  if (args[0] === 'snippet' && args.length === 1) return browserTraceSnippet
  if (args[0] !== 'inspect' || args.length !== 2) throw new Error('Usage: npm run diagnostics:browser -- snippet | inspect <private-file.json>')
  if ((await stat(args[1])).size > 256 * 1024) throw new Error('Receipt exceeds 256 KiB')
  return JSON.stringify(summarizeReceipt(JSON.parse(await readFile(args[1], 'utf8'))), null, 2)
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(result => process.stdout.write(`${result}\n`)).catch(() => {
    process.stderr.write('Browser trace command failed. Expected snippet or inspect <private JSON receipt <=256 KiB>.\n'); process.exitCode = 1
  })
}
