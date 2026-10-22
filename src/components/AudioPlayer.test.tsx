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
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const click = async (text: string) => { await act(async () => { [...host.querySelectorAll('button')].find((button) => (button.getAttribute('aria-label') || button.textContent)?.includes(text))!.click() }) }

describe('AudioPlayer', () => {
  it('keeps the same visible controls before and after loading without native controls or autoplay', async () => {
    const resolver = vi.fn().mockResolvedValue('https://downloader.disk.yandex.ru/one.mp3')
    await act(async () => root.render(<AudioPlayer link={link} resolver={resolver} />))
    expect(resolver).not.toHaveBeenCalled(); expect(host.querySelector('audio')?.controls).toBe(false)
    expect(host.textContent).not.toContain('Слушать')
    const toolbar = host.querySelector('.edu-audio-panel')
    const speed = host.querySelector('select[aria-label="Скорость воспроизведения"]')
    expect(speed).not.toBeNull()
    await click('Воспроизвести')
    expect(host.querySelector('.edu-audio-panel')).toBe(toolbar)
    expect(host.querySelector('select[aria-label="Скорость воспроизведения"]')).toBe(speed)
    const audio = host.querySelector('audio')!
    expect(audio.play).toHaveBeenCalledTimes(1)
    expect(audio.controls).toBe(false); expect(audio.preload).toBe('none'); expect(audio.autoplay).toBe(false)
    expect(host.querySelector('a')?.href).toBe(link.url)
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="Скорость воспроизведения"]')!
    await act(async () => { select.value = '0.75'; select.dispatchEvent(new Event('change', { bubbles: true })) })
    await act(async () => audio.dispatchEvent(new Event('play', { bubbles: true })))
    expect(audio.playbackRate).toBe(.75)
    audio.pause()
    await act(async () => audio.dispatchEvent(new Event('play', { bubbles: true })))
    expect(audio.playbackRate).toBe(.75)
  })
  it('keeps the panel during loading and starts after one Play intent', async () => {
    let resolve!: (value: string) => void
    const resolver = vi.fn(() => new Promise<string>((done) => { resolve = done }))
    await act(async () => root.render(<AudioPlayer link={link} resolver={resolver} />))
    const original = host.querySelector('audio')!
    expect(original.play).not.toHaveBeenCalled()
    await click('Воспроизвести')
    expect(host.querySelector('audio')).toBe(original)
    expect(host.querySelector('[role=status]')?.textContent).toContain('Загружаем')
    expect(host.querySelector<HTMLButtonElement>('button')?.disabled).toBe(true)
    expect(original.play).not.toHaveBeenCalled()
    await act(async () => resolve('https://downloader.disk.yandex.ru/one.mp3'))
    expect(host.querySelector('audio')).toBe(original)
    expect(original.play).toHaveBeenCalledTimes(1)
    expect(original.src).toContain('/one.mp3')
    expect(host.querySelector('[role=status]')).toBeNull()
  })
  it('uses dashes until a finite positive duration is known, and clears it for another track', async () => {
    const resolver = vi.fn().mockResolvedValue('https://downloader.disk.yandex.ru/one.mp3')
    await act(async () => root.render(<AudioPlayer link={link} resolver={resolver} />))
    expect(host.querySelector('.edu-audio-time-unknown')?.textContent).toBe('--:-- / --:--')
    expect(host.querySelector('audio')?.getAttribute('aria-hidden')).toBe('true')
    await click('Воспроизвести')
    const audio = host.querySelector('audio')!
    for (const duration of [NaN, Infinity, 0]) {
      Object.defineProperty(audio, 'duration', { configurable: true, value: duration })
      await act(async () => audio.dispatchEvent(new Event('durationchange')))
      expect(host.querySelector('.edu-audio-time-unknown')).not.toBeNull()
    }
    Object.defineProperty(audio, 'duration', { configurable: true, value: 93.59 })
    await act(async () => audio.dispatchEvent(new Event('loadedmetadata')))
    expect(host.querySelector('.edu-audio-time-unknown')).toBeNull()
    expect(audio.getAttribute('aria-hidden')).toBe('true')
    expect(host.querySelector('.edu-audio-time')?.textContent).toBe('0:00 / 1:33')
    await act(async () => root.render(<AudioPlayer link={{ ...link, url: 'https://disk.yandex.ru/d/two' }} resolver={resolver} />))
    expect(host.querySelector('.edu-audio-time-unknown')?.textContent).toBe('--:-- / --:--')
    expect(audio.getAttribute('aria-hidden')).toBe('true')
  })
  it('keeps slowdown visible through loading and applies it without starting paused audio', async () => {
    let resolve!: (value: string) => void
    const resolver = vi.fn(() => new Promise<string>((done) => { resolve = done }))
    await act(async () => root.render(<AudioPlayer link={link} resolver={resolver} />))
    const select = host.querySelector<HTMLSelectElement>('select[aria-label="Скорость воспроизведения"]')!
    const choose = async (value: string) => act(async () => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })) })
    await choose('0.5')
    expect(resolver).not.toHaveBeenCalled()
    await click('Воспроизвести')
    expect(host.querySelector('select')).toBe(select)
    expect(select.disabled).toBe(false)
    await choose('0.75')
    await act(async () => resolve('https://downloader.disk.yandex.ru/one.mp3'))
    const audio = host.querySelector('audio')!
    expect(audio.playbackRate).toBe(.75)
    expect(audio.controls).toBe(false); expect(audio.hidden).toBe(true)
    await act(async () => audio.dispatchEvent(new Event('pause')))
    const plays = vi.mocked(audio.play).mock.calls.length
    await choose('0.5')
    expect(audio.playbackRate).toBe(.5)
    expect(audio.play).toHaveBeenCalledTimes(plays)
    await click('Воспроизвести')
    expect(audio.playbackRate).toBe(.5)
    expect(audio.play).toHaveBeenCalledTimes(plays + 1)
  })
  it('connects the stable panel to pause, time, seek, volume and mute', async () => {
    await act(async () => root.render(<AudioPlayer link={link} resolver={async () => 'https://downloader.disk.yandex.ru/one.mp3'} />))
    const panel = host.querySelector('.edu-audio-panel')
    await click('Воспроизвести')
    const audio = host.querySelector('audio')!
    Object.defineProperty(audio, 'duration', { configurable: true, value: 27.4 })
    await act(async () => audio.dispatchEvent(new Event('loadedmetadata')))
    await act(async () => { audio.currentTime = 8; audio.dispatchEvent(new Event('timeupdate')); audio.dispatchEvent(new Event('play')) })
    expect(host.querySelector('.edu-audio-time')?.textContent).toBe('0:08 / 0:27')
    const pauses = vi.mocked(audio.pause).mock.calls.length
    await click('Пауза')
    expect(audio.pause).toHaveBeenCalledTimes(pauses + 1)
    const seek = host.querySelector<HTMLInputElement>('[aria-label="Позиция записи"]')!
    expect(seek.disabled).toBe(false)
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(seek, '12'); seek.dispatchEvent(new Event('input', { bubbles: true })) })
    expect(audio.currentTime).toBe(12)
    const volume = host.querySelector<HTMLInputElement>('[aria-label="Громкость"]')!
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(volume, '0.4'); volume.dispatchEvent(new Event('input', { bubbles: true })) })
    expect(audio.volume).toBe(.4)
    await click('Выключить звук'); expect(audio.muted).toBe(true)
    await click('Включить звук'); expect(audio.muted).toBe(false); expect(audio.volume).toBe(.4)
    await act(async () => audio.dispatchEvent(new Event('ended')))
    expect(host.querySelector('[aria-label^="Воспроизвести:"]')).not.toBeNull()
    expect(host.querySelector('.edu-audio-panel')).toBe(panel)
    expect(audio.controls).toBe(false); expect(audio.hidden).toBe(true)
  })
  it('re-resolves expired links after network or media failure', async () => {
    const resolver = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce('https://downloader.disk.yandex.ru/old').mockResolvedValueOnce('https://downloader.disk.yandex.ru/new')
    await act(async () => root.render(<AudioPlayer link={link} resolver={resolver} />))
    await click('Воспроизвести'); expect(host.querySelector('[role=alert]')).not.toBeNull()
    await click('Повторить')
    await act(async () => host.querySelector('audio')!.dispatchEvent(new Event('error')))
    await click('Повторить')
    expect(resolver).toHaveBeenCalledTimes(3)
    expect(host.querySelector('audio')?.src).toContain('/new')
  })
  it('ignores late resolution after selecting another track and pauses other media', async () => {
    let resolveOld!: (value: string) => void
    const resolver = vi.fn().mockImplementationOnce(() => new Promise<string>((resolve) => { resolveOld = resolve })).mockResolvedValue('https://downloader.disk.yandex.ru/new')
    await act(async () => root.render(<AudioPlayer link={link} resolver={resolver} />)); await click('Воспроизвести')
    await act(async () => root.render(<AudioPlayer link={{ ...link, url: 'https://disk.yandex.ru/d/two' }} resolver={resolver} />))
    await act(async () => resolveOld('https://downloader.disk.yandex.ru/old'))
    expect(host.querySelector('audio')?.getAttribute('src')).toBeNull()
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled()
    await click('Воспроизвести')
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
    await act(async () => root.render(<AudioPlayer link={link} resolver={resolver} />)); await click('Воспроизвести')
    await act(async () => root.render(<AudioPlayer link={{ ...link, url: 'https://disk.yandex.ru/d/two' }} resolver={resolver} />))
    expect(revoke).toHaveBeenCalledWith('blob:first')
    await click('Воспроизвести')
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
