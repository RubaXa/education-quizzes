#!/usr/bin/env node
import { stdout, stderr } from 'node:process'
import { encryptHandoff } from '../lib/envelope.mjs'
import { loadInvite, submitHandoff } from '../lib/handoff-store.mjs'
import { loginToMesh, MeshDiaryAdapter } from '../lib/mesh.mjs'
import { confirmPrompt, hiddenPrompt } from '../lib/prompts.mjs'

/** @see ../../../docs/architecture/school-diary-port-adapter.md#family-onboarding-research */
async function main() {
  const at = process.argv.indexOf('--invite')
  const code = at >= 0 ? process.argv[at + 1] : null
  if (!code || !/^[A-Za-z0-9_-]{43}$/.test(code)) {
    stdout.write('Использование: npx education-connect --invite <одноразовый-код>\n')
    process.exitCode = 2
    return
  }
  const invite = await loadInvite(code)
  stdout.write('Подключение МЭШ. Логин, пароль и SMS вводятся только здесь и не отправляются в Education.\n')
  const username = await hiddenPrompt('Логин mos.ru: ')
  const password = await hiddenPrompt('Пароль mos.ru: ')
  if (!username || !password) throw new Error('Логин и пароль обязательны')
  stdout.write('Проверяем вход в МЭШ. При необходимости запросим SMS…\n')
  let profiles = []
  let secret = await loginToMesh({
    username, password,
    askSmsCode: () => hiddenPrompt('Код из SMS: '),
    chooseProfile: (available) => { profiles = available; return 0 },
  })
  stdout.write('Сверяем роль взрослого и доступных детей…\n')
  const adapter = new MeshDiaryAdapter(secret, (updated) => { secret = updated })
  await adapter.verifyAccess()
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

main().catch((error) => {
  const safe = /^(Неверный код приглашения|Приглашение закрыто|Для входа нужен|Вход прерван|Логин и пароль обязательны|Слишком большой пакет подключения)/.test(String(error?.message))
  stderr.write(`${safe ? error.message : 'Подключение не завершилось. Проверьте приглашение и доступ к МЭШ.'}\n`)
  process.exitCode = 1
})
