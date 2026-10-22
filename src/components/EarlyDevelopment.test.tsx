// @vitest-environment jsdom
/** @see ../../docs/modules/families/early-development.md */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import EarlyDevelopment from './EarlyDevelopment'
import { JOURNAL_KEY, readObservations } from '@/lib/earlyDevelopment'
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement, root: Root
const click = async (label: string) => { const button = [...host.querySelectorAll('button')].find((item) => item.textContent?.includes(label)); expect(button, label).toBeTruthy(); await act(async () => button!.click()) }
const mount = async () => { await act(async () => { root = createRoot(host); root.render(<EarlyDevelopment />) }) }
async function observe() {
  await click('Одна контрастная картинка')
  expect(host.textContent).toContain('Когда остановиться')
  await click('Записать наблюдение')
  await act(async () => host.querySelector<HTMLInputElement>('input[value="Отвернулась"]')!.click())
  await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
}
beforeEach(async () => { localStorage.clear(); host = document.createElement('div'); document.body.append(host); await mount() })
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks() })
describe('parent early development preview', () => {
  it('completes the daily path, survives reload and edits the same observation', async () => {
    await observe()
    expect(host.textContent).toContain('Наблюдение сохранено в этом браузере')
    const original = readObservations(localStorage)[0]
    await act(async () => root.unmount()); await mount()
    expect(host.textContent).toContain('В последней записи о картинке')
    await click('Дневник'); expect(host.textContent).toContain('Отвернулась')
    await click('Изменить')
    await act(async () => host.querySelector<HTMLInputElement>('input[value="Уснула"]')!.click())
    await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(readObservations(localStorage)).toEqual([expect.objectContaining({ id: original.id, observedAt: original.observedAt, reaction: 'Уснула', updatedAt: expect.any(String) })])
    await click('Посмотреть дневник'); await click('Удалить')
    expect(host.textContent).toContain('Пока нет наблюдений')
    expect(readObservations(localStorage)).toEqual([])
  })
  it('keeps the form after storage failure and does not claim successful saving', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    await observe()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Не удалось сохранить')
    expect(host.querySelector('form')).toBeTruthy()
    expect(host.textContent).not.toContain('Наблюдение сохранено')
  })
  it('does not silently discard an unreadable journal', async () => {
    await act(async () => root.unmount()); localStorage.setItem(JOURNAL_KEY, 'broken'); await mount()
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('не перезаписаны')
    await click('Знакомый голос'); await click('Записать наблюдение')
    expect(host.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true)
    expect(localStorage.getItem(JOURNAL_KEY)).toBe('broken')
  })
  it('separates the available first stage from the roadmap and clinical screening', async () => {
    await click('Программа')
    expect(host.textContent).toContain('План содержания')
    expect(host.textContent).toContain('Здесь нет диагностического теста')
    expect(host.textContent).not.toContain('Календарь не подключён')
  })
})
