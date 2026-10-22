// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AudioPlayer from './AudioPlayer'
import AudioLibrary from './AudioLibrary'
import type { DayMaterialLink } from '@/lib/dayStore'

const link: DayMaterialLink = { title: 'Учебник · с. 31, упр. 2a', sourceType: 'audio', url: 'https://disk.yandex.ru/d/one', sourceRef: 'audio:one', audioKind: 'sb' }
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const click = async (text: string) => { await act(async () => { [...host.querySelectorAll('button')].find((button) => button.textContent?.includes(text))!.click() }) }

describe('AudioPlayer', () => {
  it('waits for intent, exposes native controls and applies speed without autoplay', async () => {
    const resolver = vi.fn().mockResolvedValue('https://downloader.disk.yandex.ru/one.mp3')
    await act(async () => root.render(<AudioPlayer link={link} resolver={resolver} />))
    expect(resolver).not.toHaveBeenCalled(); expect(host.querySelector('audio')).toBeNull()
    await click('Слушать')
    const audio = host.querySelector('audio')!
    expect(audio.controls).toBe(true); expect(audio.preload).toBe('none'); expect(audio.autoplay).toBe(false)
    expect(host.querySelector('a')?.href).toBe(link.url)
    await act(async () => { const select = host.querySelector('select')!; select.value = '0.75'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(audio.playbackRate).toBe(.75)
  })
  it('re-resolves expired links after network or media failure', async () => {
    const resolver = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce('https://downloader.disk.yandex.ru/old').mockResolvedValueOnce('https://downloader.disk.yandex.ru/new')
    await act(async () => root.render(<AudioPlayer link={link} resolver={resolver} />))
    await click('Слушать'); expect(host.querySelector('[role=alert]')).not.toBeNull()
    await click('Повторить')
    await act(async () => host.querySelector('audio')!.dispatchEvent(new Event('error')))
    await click('Повторить')
    expect(resolver).toHaveBeenCalledTimes(3)
    expect(host.querySelector('audio')?.src).toContain('/new')
  })
  it('ignores late resolution after selecting another track and pauses other media', async () => {
    let resolveOld!: (value: string) => void
    const resolver = vi.fn().mockImplementationOnce(() => new Promise<string>((resolve) => { resolveOld = resolve })).mockResolvedValue('https://downloader.disk.yandex.ru/new')
    await act(async () => root.render(<AudioPlayer link={link} resolver={resolver} />)); await click('Слушать')
    await act(async () => root.render(<AudioPlayer link={{ ...link, url: 'https://disk.yandex.ru/d/two' }} resolver={resolver} />))
    await act(async () => resolveOld('https://downloader.disk.yandex.ru/old'))
    expect(host.querySelector('audio')).toBeNull()
    await click('Слушать')
    const other = document.createElement('audio'); host.append(other)
    await act(async () => host.querySelector('audio')!.dispatchEvent(new Event('play', { bubbles: true })))
    expect(other.pause).toHaveBeenCalled()
    expect(host.querySelector('audio')?.src).toContain('/new')
  })
  it('revokes ready and late in-memory objects when changing a track or leaving', async () => {
    const revoke = vi.fn()
    vi.stubGlobal('URL', { revokeObjectURL: revoke })
    let resolveLate!: (value: string) => void
    const resolver = vi.fn().mockResolvedValueOnce('blob:first').mockImplementationOnce(() => new Promise<string>((resolve) => { resolveLate = resolve }))
    await act(async () => root.render(<AudioPlayer link={link} resolver={resolver} />)); await click('Слушать')
    await act(async () => root.render(<AudioPlayer link={{ ...link, url: 'https://disk.yandex.ru/d/two' }} resolver={resolver} />))
    expect(revoke).toHaveBeenCalledWith('blob:first')
    await click('Слушать')
    await act(async () => root.render(<div>closed</div>))
    await act(async () => resolveLate('blob:late'))
    expect(revoke).toHaveBeenCalledWith('blob:late')
  })
  it('selects library tracks without mounting a player for every recording', async () => {
    await act(async () => root.render(<AudioLibrary tracks={[link, { ...link, audioKind: 'wb', sourceRef: 'audio:two', url: 'https://disk.yandex.ru/d/two', title: 'Рабочая тетрадь · с. 15' }]} />))
    expect(host.querySelectorAll('.edu-audio')).toHaveLength(1)
    await act(async () => { const select = host.querySelector('select')!; select.value = 'audio:two'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(host.querySelector('.edu-audio-heading')?.textContent).toContain('Рабочая тетрадь')
  })
})
