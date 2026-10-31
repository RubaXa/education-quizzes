/** Verify the actual Firestore Rules evaluator with synthetic attachment/role fixtures.
 * @see ../docs/shared/media-storage.md */
import { readFileSync, writeFileSync } from 'node:fs'
import { GoogleAuth } from 'google-auth-library'
import { createPhotoUploadRulesTestSuite } from '../rules-test-fixtures/photo-upload-suite.mjs'
const auth = new GoogleAuth({ keyFilename: '.local/adc.json', scopes: ['https://www.googleapis.com/auth/cloud-platform'] })
const project = JSON.parse(readFileSync('.firebaserc', 'utf8')).projects.default
const cases = createPhotoUploadRulesTestSuite()
const client = await auth.getClient()
try {
  const { data } = await client.request({ url: `https://firebaserules.googleapis.com/v1/projects/${project}:test`, method: 'POST', data: {
    source: { files: [{ name: 'firestore.rules', content: readFileSync('firestore.rules', 'utf8') }] },
    testSuite: { testCases: cases.map(({ name: _name, ...test }) => test) },
  } })
  writeFileSync('.local/solution-file-rules-result.json', JSON.stringify(data, null, 2), { mode: 0o600 })
  const failures = (data.testResults ?? []).flatMap((result, index) => result.state === 'SUCCESS' ? [] : [{ name: cases[index]?.name, state: result.state, messages: result.debugMessages }])
  const errors = data.issues?.filter(issue => issue.severity === 'ERROR') ?? []
  console.log(JSON.stringify({ cases: cases.length, results: data.testResults?.length, failures, errors }))
  if (failures.length || errors.length || data.testResults?.length !== cases.length) process.exitCode = 1
} catch (error) { console.error('Rules API failed', error.response?.status ?? error.code ?? 'unknown'); process.exitCode = 1 }
