/** @see ../docs/modules/assessments/olympiad-preparation.md */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { initializeApp, applicationDefault } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { verifyOlympiadEligibility } from '../olympiad/verify-eligibility.mjs'

if (process.argv[2] !== 'apply') throw new Error('Укажите apply')
if (process.env.GCLOUD_PROJECT !== 'education-9d7c6' || !process.env.GOOGLE_APPLICATION_CREDENTIALS) throw new Error('Нужны явные проект и operator credentials')
const profile = readFileSync(resolve('../learner/profile.md'), 'utf8')
const consent = JSON.parse(readFileSync(resolve('.local/olympiad-grade-consent.json'), 'utf8'))
if (consent.source !== 'explicit-parent-consent' || !Number.isInteger(consent.grade) || !consent.personId || !consent.confirmedAt || !consent.evidence) throw new Error('Нужно отдельное явное разрешение родителя')
const foundGrade = profile.match(/^\s*- Текущий класс:\s*(\d{1,2})[^\n]*$/m)
if (!foundGrade || Number(foundGrade[1]) !== consent.grade) throw new Error('Профиль не подтверждает указанный класс')
const registry = JSON.parse(readFileSync(resolve('.local/family-access.json'), 'utf8')).people
const matches = Object.entries(registry).filter(([id, v]) => id === consent.personId && v.role === 'student' && v.familyId && v.childId)
if (matches.length !== 1) throw new Error('Профиль ученика не определён однозначно')
const [personId, { familyId, childId }] = matches[0]
const receipts = ['enumeration', 'parity', 'counterexample'].map(name => {
  const lessonId = `training-${name}-v1`, r = JSON.parse(readFileSync(resolve('.local', `olympiad-training-create-${name}.json`), 'utf8'))
  const url = new URL(r.learner), prefix = `#/t/${lessonId}~`
  if (url.origin !== 'https://rubaxa.github.io' || url.pathname !== '/education-quizzes/' || !url.hash.startsWith(prefix)) throw new Error('Квитанция не совпадает с уроком')
  return { lessonId, learnerToken: url.hash.slice(prefix.length), testId: r.testId }
})
initializeApp({ projectId: process.env.GCLOUD_PROJECT, credential: applicationDefault() })
console.log(JSON.stringify(await verifyOlympiadEligibility(getFirestore(), { familyId, childId, personId, grade: consent.grade, receipts })))
