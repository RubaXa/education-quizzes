#!/usr/bin/env node
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { loadConfig } from './config.mjs'
import { readJson, writeJson } from './local-store.mjs'
import { loginToMesh, MeshDiaryAdapter, probeMesh } from './adapters/mesh.mjs'
import { syncDiary } from './application/sync.mjs'
import { lessonVisibility } from './application/lesson-visibility.mjs'
import { downloadDayAttachments } from './attachments.mjs'

function hiddenPrompt(label) {
  if (!stdin.isTTY || !stdin.setRawMode) throw new Error('Для входа нужен интерактивный терминал')
  stdout.write(label)
  return new Promise((resolve, reject) => {
    const bytes = []
    stdin.setRawMode(true)
    stdin.resume()
    function finish(error) {
      stdin.off('data', onData)
      stdin.setRawMode(false)
      stdout.write('\n')
      if (error) reject(error)
      else resolve(Buffer.from(bytes).toString('utf8'))
    }
    function onData(chunk) {
      for (const byte of chunk) {
        if (byte === 3) return finish(new Error('Вход прерван'))
        if (byte === 10 || byte === 13) return finish()
        if (byte === 127 || byte === 8) {
          if (bytes.length) {
            bytes.pop()
            while (bytes.length && (bytes.at(-1) & 0xc0) === 0x80) bytes.pop()
          }
          continue
        }
        bytes.push(byte)
      }
    }
    stdin.on('data', onData)
  })
}

async function chooseProfile(profiles) {
  if (profiles.length === 1) return 0
  stdout.write('Доступные ученические профили:\n')
  profiles.forEach((profile, index) => stdout.write(`${index + 1}. ${profile.name}\n`))
  const rl = createInterface({ input: stdin, output: stdout })
  try {
    const selected = Number(await rl.question('Номер профиля ученика: '))
    if (!Number.isInteger(selected) || selected < 1 || selected > profiles.length) throw new Error('Неверный номер профиля')
    return selected - 1
  } finally { rl.close() }
}

async function main() {
  const [command, ...args] = process.argv.slice(2)
  const config = loadConfig()
  if (!command || command === 'help') {
    stdout.write('Команды: npm run diary -- doctor | login | verify | sync --date YYYY-MM-DD | files --date YYYY-MM-DD | status\n')
    return
  }
  if (command === 'doctor') {
    const status = await probeMesh()
    stdout.write(`МЭШ доступен по HTTPS; HTTP ${status}. Авторизация для doctor не нужна.\n`)
    return
  }
  if (command === 'login') {
    const username = await hiddenPrompt('Логин mos.ru (ввод скрыт): ')
    const password = await hiddenPrompt('Пароль mos.ru (ввод скрыт): ')
    if (!username || !password) throw new Error('Логин и пароль обязательны')
    const secret = await loginToMesh({ username, password, askSmsCode: () => hiddenPrompt('Код из SMS (ввод скрыт): '), chooseProfile })
    const name = secret.profileName
    const { profileName: _profileName, ...stored } = secret
    writeJson(config.dataDir, 'secret.json', stored)
    const adapter = new MeshDiaryAdapter(stored, (updated) => writeJson(config.dataDir, 'secret.json', updated))
    const verified = await adapter.verifyAccess()
    stdout.write(`Родительский доступ подтверждён; ученик ${name} связан с аккаунтом. Доступ сохранён локально. Роль: ${verified.accountRole}.\n`)
    return
  }
  if (command === 'status') {
    const secret = readJson(config.dataDir, 'secret.json')
    const status = readJson(config.dataDir, 'status.json')
    stdout.write(`Источник: ${config.provider}\nВход: ${secret ? 'есть локальный токен' : 'нужен login'}\n`)
    if (secret) stdout.write(`Связь родитель → ученик: ${secret.verifiedAt ? `подтверждена ${secret.verifiedAt}` : 'нужна команда verify'}\n`)
    if (status) {
      stdout.write(`Последняя загрузка: ${status.date}; ${status.complete ? 'запросы без ошибок' : 'часть запросов с ошибками'}; ${status.fetchedAt}\n`)
      if (status.counts) {
        const snapshot = readJson(config.dataDir, `snapshot-${status.date}.json`)
        const visibility = lessonVisibility(snapshot?.schedule)
        const scheduleLabel = visibility.conducted
          ? `строк МЭШ: ${status.counts.schedule}; проводимых уроков: ${visibility.conducted.length}`
          : `уроков в последнем снимке: ${status.counts.schedule}`
        stdout.write(`Расписание — ${scheduleLabel}; предметов в сводке оценок: ${status.counts.markSubjects}; отметок в сводке: ${status.counts.markItems}; заданий из расписания: ${status.counts.assignments}.\n`)
        if (visibility.hidden.length) stdout.write(`Семейных исключений из ученического расписания: ${visibility.hidden.length}. Исходные строки сохранены.\n`)
      }
      if (status.changes) printChanges(status.changes)
    }
    return
  }
  if (command === 'verify') {
    const secret = readJson(config.dataDir, 'secret.json')
    if (!secret) throw new Error('Сначала выполните npm run diary -- login')
    const adapter = new MeshDiaryAdapter(secret, (updated) => writeJson(config.dataDir, 'secret.json', updated))
    const result = await adapter.verifyAccess()
    stdout.write(`Роль: ${result.accountRole}; ученический профиль связан с аккаунтом; детей доступно: ${result.childrenCount}.\n`)
    return
  }
  if (command === 'sync') {
    const dateIndex = args.indexOf('--date')
    const date = dateIndex >= 0 ? args[dateIndex + 1] : null
    if (!date) throw new Error('Укажите --date YYYY-MM-DD')
    const secret = readJson(config.dataDir, 'secret.json')
    if (!secret) throw new Error('Сначала выполните npm run diary -- login')
    const adapter = new MeshDiaryAdapter(secret, (updated) => writeJson(config.dataDir, 'secret.json', updated))
    await adapter.verifyAccess()
    const result = await syncDiary({ adapter, dataDir: config.dataDir, date })
    const counts = {
      schedule: Array.isArray(result.schedule) ? result.schedule.length : null,
      markSubjects: Array.isArray(result.marks) ? result.marks.length : null,
      markItems: Array.isArray(result.marks) ? result.marks.reduce((sum, subject) => sum + (Array.isArray(subject.marks) ? subject.marks.length : 0), 0) : null,
      assignments: Array.isArray(result.assignments) ? result.assignments.length : null,
    }
    const visibility = lessonVisibility(result.schedule)
    writeJson(config.dataDir, 'status.json', { date, fetchedAt: result.fetchedAt, complete: result.complete, errors: result.errors, counts, changes: result.changesSincePrevious })
    for (const key of ['profile', 'schedule', 'marks', 'assignments']) {
      const value = result[key]
      const count = Array.isArray(value) ? value.length : value == null ? 'ошибка' : 'получено'
      const presentation = key === 'schedule' && visibility.conducted
        ? `${count} исходных строк; ${visibility.conducted.length} проводимых уроков`
        : count
      stdout.write(`${key}: ${presentation}${result.errors[key] ? ` (${result.errors[key]})` : ''}\n`)
    }
    printChanges(result.changesSincePrevious)
    stdout.write(`Снимок: ${config.dataDir}/snapshot-${date}.json\n`)
    if (!result.complete) process.exitCode = 2
    return
  }
  if (command === 'files') {
    const dateIndex = args.indexOf('--date')
    const date = dateIndex >= 0 ? args[dateIndex + 1] : null
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) throw new Error('Укажите --date YYYY-MM-DD')
    const secret = readJson(config.dataDir, 'secret.json')
    if (!secret) throw new Error('Сначала выполните npm run diary -- login')
    const adapter = new MeshDiaryAdapter(secret, (updated) => writeJson(config.dataDir, 'secret.json', updated))
    await adapter.verifyAccess()
    const result = await downloadDayAttachments(config.dataDir, date, adapter.api.token)
    stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    if (result.failed.length) process.exitCode = 2
    return
  }
  throw new Error(`Неизвестная команда: ${command}`)
}

function printChanges(changes) {
  if (changes.baseline) {
    stdout.write('Сравнение: это первый снимок на дату.\n')
    return
  }
  stdout.write(`Сравнение с загрузкой ${changes.previousFetchedAt}:\n`)
  for (const [label, key] of [['уроки', 'schedule'], ['оценки', 'marks'], ['ДЗ', 'assignments']]) {
    const section = changes.sections[key]
    stdout.write(`  ${label}: ${section?.comparable ? `+${section.added.length} / -${section.removed.length} / изменено ${section.changed.length}` : 'сравнение недоступно'}\n`)
  }
}

main().catch((error) => {
  const message = String(error?.message || '')
  const safe = /^(Сначала |Укажите |Дата должна|Неизвестная команда|Для входа нужен|Вход прерван|Логин и пароль|Неверный номер|МЭШ запросил|Поставщик |ACCESS_NOT_VERIFIED:)/.test(message)
  console.error(safe ? message : 'Команда не завершена. Проверьте доступ к МЭШ или повторите вход; секреты не выводятся.')
  process.exitCode = 1
})
