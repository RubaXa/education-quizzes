import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'

/** Local operator credentials only. Never import this module in the browser or npm connector.
 * @see ../../docs/architecture/family-data-model.md#provisioning
 */
function prepareCredentials() {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return
  const file = resolve('.local/adc.json')
  if (existsSync(file)) { process.env.GOOGLE_APPLICATION_CREDENTIALS = file; return }
  const loginFile = resolve('.local/config/configstore/firebase-tools.json')
  if (!existsSync(loginFile)) throw new Error('Нужен локальный вход Firebase CLI.')
  const login = JSON.parse(readFileSync(loginFile, 'utf8'))
  if (!login.tokens?.refresh_token) throw new Error('Вход Firebase CLI устарел.')
  const require = createRequire(import.meta.url)
  const { clientId, clientSecret } = require('firebase-tools/lib/api')
  writeFileSync(file, JSON.stringify({ type: 'authorized_user', client_id: clientId(), client_secret: clientSecret(), refresh_token: login.tokens.refresh_token }), { mode: 0o600 })
  process.env.GOOGLE_APPLICATION_CREDENTIALS = file
}

export function operatorFirestore() {
  prepareCredentials()
  if (!getApps().length) initializeApp({ credential: applicationDefault(), projectId: 'education-9d7c6' })
  return getFirestore()
}
