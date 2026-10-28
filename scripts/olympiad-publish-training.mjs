/** @see ../docs/modules/assessments/olympiad-preparation.md */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { applicationDefault, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { publishTraining, trainingPublicationPlan } from '../olympiad/publish-training.mjs'

const command = process.argv[2]
if (command === 'plan') {
  console.log(JSON.stringify(trainingPublicationPlan(), null, 2))
} else if (command === 'apply') {
  if (process.env.GCLOUD_PROJECT !== 'education-9d7c6' && !/^demo-[a-z0-9-]+$/.test(process.env.GCLOUD_PROJECT || '')) throw new Error('Явно задайте ожидаемый GCLOUD_PROJECT')
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Нужны явные operator credentials')
  const tokens = (url, kind, slug) => {
    const parsed = new URL(url)
    if (parsed.origin !== 'https://rubaxa.github.io' || parsed.pathname !== '/education-quizzes/') throw new Error('Неизвестная ссылка')
    const prefix = `#/${kind}/${slug}~`
    if (!parsed.hash.startsWith(prefix)) throw new Error('Ссылка не совпадает с материалом')
    return parsed.hash.slice(prefix.length)
  }
  const names = ['enumeration', 'parity', 'counterexample']
  const receipts = names.map((name) => {
    const id = `training-${name}-v1`
    const receipt = JSON.parse(readFileSync(resolve('.local', `olympiad-training-create-${name}.json`), 'utf8'))
    return { lessonId: id, testId: receipt.testId, learnerToken: tokens(receipt.learner, 't', id), previewToken: tokens(receipt.preview, 'preview', id) }
  })
  const options = process.env.FIRESTORE_EMULATOR_HOST ? { projectId: process.env.GCLOUD_PROJECT } : { projectId: process.env.GCLOUD_PROJECT, credential: applicationDefault() }
  initializeApp(options)
  console.log(JSON.stringify(await publishTraining(getFirestore(), receipts)))
} else {
  throw new Error('Укажите plan или apply')
}
