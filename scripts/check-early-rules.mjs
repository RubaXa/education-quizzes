/** @see ../docs/modules/families/early-development.md */
import { readFileSync, writeFileSync } from 'node:fs'
import { GoogleAuth } from 'google-auth-library'
import { earlyDevelopmentRulesSuite } from '../rules-test-fixtures/early-development-suite.mjs'
const auth = new GoogleAuth({ keyFilename: '.local/adc.json', scopes: ['https://www.googleapis.com/auth/cloud-platform'] })
const client = await auth.getClient()
const cases = earlyDevelopmentRulesSuite()
const response = await client.request({ url: 'https://firebaserules.googleapis.com/v1/projects/education-9d7c6:test', method: 'POST', data: {
  source: { files: [{ name: 'firestore.rules', content: readFileSync('firestore.rules', 'utf8') }] },
  testSuite: { testCases: cases.map(({ name: _name, ...test }) => test) },
} }).catch((error) => { console.error('Rules API failed', error.response?.status); process.exit(1) })
const result = response.data
writeFileSync('.local/early-rules-result.json', JSON.stringify(result, null, 2))
console.log(JSON.stringify({ issues: result.issues, results: result.testResults?.map((item, i) => ({ name: cases[i].name, state: item.state, errors: item.debugMessages, position: item.errorPosition })) }, null, 2))
if (result.testResults?.length !== cases.length || result.testResults.some((item) => item.state !== 'SUCCESS') || result.issues?.some((item) => item.severity === 'ERROR')) process.exitCode = 1
