#!/usr/bin/env node
/** @see ../../../docs/decisions/local-connect-diagnostics-2026-11-01.md */
/** @see ../../../docs/decisions/mesh-login-stages-2026-11-01.md */
import { stdout, stderr } from 'node:process'
import { encryptHandoff } from '../lib/envelope.mjs'
import { loginToMesh, MeshDiaryAdapter } from '../lib/mesh.mjs'
import { formatLoginFailure, loginFailure } from '../lib/login-diagnostics.mjs'
import { confirmPrompt, hiddenPrompt, visiblePrompt, credentialInputSummary } from '../lib/prompts.mjs'

/** @see ../../../docs/modules/school-diary/README.md#family-onboarding-research */
async function main() {
  const inputOnly = process.argv.includes('--input-check')
  if (inputOnly) {
    stdout.write('Локальная проверка ввода: сетевых запросов, регистрации и передачи доступа нет.\n')
    await readCredentials()
    return
  }
  const at = process.argv.indexOf('--invite')
  const code = at >= 0 ? process.argv[at + 1] : null
  if (!code || !/^[A-Za-z0-9_-]{43}$/.test(code)) {
    stdout.write('Использование: npx education-connect --invite <одноразовый-код>\n')
    process.exitCode = 2
    return
  }
  const { loadInvite, submitHandoff } = await import('../lib/handoff-store.mjs')
  stdout.write('Этап: проверка приглашения…\n')
  const invite = await loadInvite(code)
  stdout.write('Подключение МЭШ. Логин, пароль и SMS вводятся только здесь и не отправляются в Education.\n')
  const {username, password} = await readCredentials()
  stdout.write('Проверяем вход в МЭШ. При необходимости запросим SMS…\n')
  let profiles = []
  let secret = await loginToMesh({
    username, password, onProgress: (message) => stdout.write(`${message}\n`),
    onDiagnostic: process.argv.includes('--diagnose') ? (event) => stdout.write(`[МЭШ] ${event.stage}: HTTP ${event.httpStatus}; ${event.contentType}\n`) : undefined,
    askSmsCode: () => hiddenPrompt('Код из SMS: '),
    chooseProfile: (available) => { profiles = available; return 0 },
  })
  stdout.write('Сверяем роль взрослого и доступных детей…\n')
  const adapter = new MeshDiaryAdapter(secret, (updated) => { secret = updated })
  try { await adapter.verifyAccess() }
  catch (error) {
    throw loginFailure({stage:'profile',httpStatus:Number(String(error?.message ?? '').match(/^API (401|403):/)?.[1]),reason:'provider-rejected'})
  }
  stdout.write(`Подтверждён родительский доступ. Доступные дети: ${profiles.map((item) => item.name).join(', ')}.\n`)
  stdout.write('После подключения оператор Education сможет повторно читать данные МЭШ этих детей до отзыва доступа.\n')
  if (!await confirmPrompt('Передать зашифрованный доступ оператору? Напишите «да»: ')) {
    stdout.write('Подключение отменено; данные не переданы.\n')
    return
  }
  const { profileName: _profileName, ...credentials } = secret
  const envelope = encryptHandoff(code, invite.publicKey, {
    schemaVersion: 1,
    source: 'mesh',
    issuedAt: new Date().toISOString(),
    credentials,
  })
  stdout.write('Передаём зашифрованный пакет…\n')
  await submitHandoff(code, envelope)
  stdout.write('Доступ передан в зашифрованном виде. Заявка ожидает подтверждения оператором.\n')
}

async function readCredentials() {
  stdout.write('Логин mos.ru — телефон, email или СНИЛС вашей учётной записи. Для телефона рекомендуем +7XXXXXXXXXX; автоматически формат не меняем.\n')
  const username = await visiblePrompt('Логин mos.ru (виден при вводе): ')
  const password = await hiddenPrompt('Пароль mos.ru: ')
  if (!username || !password) throw new Error('Логин и пароль обязательны')
  if (process.argv.includes('--diagnose') || process.argv.includes('--input-check')) {
    stdout.write(credentialInputSummary(password, {showPrefix: process.argv.includes('--show-password-prefix')}))
  }
  return {username, password}
}

main().catch((error) => {
  const diagnostic = formatLoginFailure(error)
  if (diagnostic) { stderr.write(`${diagnostic}\n`); process.exitCode = 1; return }
  const firebaseCode = ['permission-denied','unavailable','unauthenticated','auth/network-request-failed','auth/operation-not-allowed'].includes(error?.code) ? error.code : null
  if (firebaseCode) { stderr.write(`Подключение: Firebase ${firebaseCode}. Секреты и тело ответа не выводятся.\n`); process.exitCode = 1; return }
  const safe = /^(Неверный код приглашения|Приглашение закрыто|Для входа нужен|Вход прерван|Логин и пароль обязательны|Слишком большой пакет подключения)/.test(String(error?.message))
  stderr.write(`${safe ? error.message : 'Подключение не завершилось. Проверьте приглашение и доступ к МЭШ.'}\n`)
  process.exitCode = 1
})
