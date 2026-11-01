#!/usr/bin/env node
/** @see ../docs/services/operator-cli/README.md#operation-contract */
import { readFileSync } from 'node:fs'
import { operatorFirestore } from './lib/admin-firebase.mjs'
import { publishHelpResponse } from '../sync/help-response.mjs'

const [command, eventId, artifactId, answerPath] = process.argv.slice(2)
if (command !== 'publish' || !eventId || !artifactId || !answerPath) throw new Error('Usage: help-response publish EVENT ARTIFACT ANSWER_FILE')
const content=readFileSync(answerPath, 'utf8')
const payload=content.trim().startsWith('{')?JSON.parse(content):{text:content}
const result = await publishHelpResponse(operatorFirestore(), { text:payload.text, reviewResponse:payload.reviewResponse, decision:payload.decision, eventId, artifactId })
process.stdout.write(`${JSON.stringify(result)}\n`)
