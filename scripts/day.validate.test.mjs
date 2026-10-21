import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { afterEach, describe, expect, it } from 'vitest'

const repo = resolve(fileURLToPath(new URL('..', import.meta.url)))
const workspaces = []
afterEach(() => workspaces.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })))

function cliValidate(source) {
  const workspace = mkdtempSync(resolve(tmpdir(), 'day-validate-notice-'))
  workspaces.push(workspace)
  mkdirSync(resolve(workspace, 'day-source'), { recursive: true })
  writeFileSync(resolve(workspace, 'day-source-2026-11-01.json'), JSON.stringify(source))
  return spawnSync(process.execPath, [resolve(repo, 'scripts/day.mjs'), 'validate', '2026-11-01'], {
    cwd: repo, encoding: 'utf8', env: { ...process.env, EDUCATION_CHILD_WORKSPACE: workspace },
  })
}

describe('штатный day validate для записи-уведомления', () => {
  const source = () => ({ targetDate: '2026-11-02', subjects: [{ id: 'math', name: 'Математика', icon: '∑',
    materials: '', mesh: 'Всем хороших каникул!', summary: '', tasks: [] }],
  sourceOnlyEntries: [{ kind: 'notice', id: 'mesh-352682606', subjectId: 'math', rawText: 'Всем хороших каникул!',
    reason: 'Точная отдельная поздравительная запись МЭШ; в ней нет учебного действия.' }] })

  it('accepts the exact no-task notice source', () => {
    const result = cliValidate(source())
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({ tasks: 0, valid: true })
  })

  it('rejects an action-bearing line masquerading as a notice', () => {
    const value = source()
    value.subjects[0].mesh = 'Всем хороших каникул! Решить № 5.'
    value.sourceOnlyEntries[0].rawText = 'Всем хороших каникул! Решить № 5.'
    const result = cliValidate(value)
    expect(result.status).not.toBe(0)
    expect(result.stderr.toLocaleLowerCase('ru-RU')).toContain('уведомление')
  })
})
