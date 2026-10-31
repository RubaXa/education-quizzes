/** @see ../docs/decisions/olympiad-calendar-2026-10-31.md */
import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { publishOlympiadCalendar } from '../olympiad/publish-calendar.mjs'
if (process.argv.length !== 3 || !['--plan','--apply'].includes(process.argv[2])) throw Error('Usage: node scripts/olympiad-calendar.mjs --plan|--apply')
initializeApp({ credential: applicationDefault(), projectId: 'education-9d7c6' })
console.log(JSON.stringify(await publishOlympiadCalendar(getFirestore(), { apply: process.argv[2] === '--apply' })))
