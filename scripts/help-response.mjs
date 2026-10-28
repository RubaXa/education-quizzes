#!/usr/bin/env node
/** @see ../docs/services/operator-cli/README.md#operation-contract */
import { readFileSync } from 'node:fs'
import { operatorFirestore } from './lib/admin-firebase.mjs'
import { publishHelpResponse } from '../sync/help-response.mjs'

const [command, eventId, artifactId, answerPath] = process.argv.slice(2)
if (command !== 'publish' || !eventId || !artifactId || !answerPath) throw new Error('Usage: help-response publish EVENT ARTIFACT ANSWER_FILE')
const result = await publishHelpResponse(operatorFirestore(), { eventId, artifactId, text: readFileSync(answerPath, 'utf8') })
process.stdout.write(`${JSON.stringify(result)}\n`)
