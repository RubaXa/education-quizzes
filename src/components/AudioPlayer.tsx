import { useEffect, useId, useRef, useState } from 'react'
import { ExternalLink, Headphones, LoaderCircle, Play, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { DayMaterialLink } from '@/lib/dayStore'
import { publicAudio } from '@/lib/yandexPublic'
import './AudioPlayer.css'

/** One player for assignments, family library and UI Kit. No media request until intent.
 * @see ../../docs/modules/materials/audio-library.md#player */
export default function AudioPlayer({ link, resolver = publicAudio }: {
  link: DayMaterialLink; resolver?: (url: string, sha256?: string) => Promise<string>
}) {
  const labelId = useId()
  const audio = useRef<HTMLAudioElement>(null)
  const request = useRef(0)
  const object = useRef<string | undefined>(undefined)
  const [state, setState] = useState<{ phase: 'idle' | 'loading' | 'ready' | 'error'; src?: string }>({ phase: 'idle' })

  useEffect(() => {
    request.current += 1
    setState({ phase: 'idle' })
    return () => { request.current += 1; release() }
  }, [link.url, link.sourceSha256])

  useEffect(() => {
    // Run after React installs src, so its update cannot cancel this Play intent.
    if (state.phase === 'ready') void audio.current?.play().catch(() => {})
  }, [state.phase, state.src])

  function release() {
    audio.current?.pause()
    if (object.current?.startsWith('blob:')) URL.revokeObjectURL(object.current)
    object.current = undefined
  }

  async function prepare() {
    if (state.phase === 'loading') return
    const generation = ++request.current
    release()
    setState({ phase: 'loading' })
    try {
      const src = await resolver(link.url, link.sourceSha256)
      if (request.current !== generation) { if (src.startsWith('blob:')) URL.revokeObjectURL(src); return }
      object.current = src
      setState({ phase: 'ready', src })

    } catch {
      if (request.current === generation) setState({ phase: 'error' })
    }
  }

  return <section className="edu-audio" aria-labelledby={labelId}>
    <div className="edu-audio-heading"><Headphones size={18} aria-hidden="true" /><strong id={labelId}>{link.title}</strong></div>
    <div className="edu-audio-panel" aria-busy={state.phase === 'loading'}>
      <audio ref={audio} controls preload="none" src={state.src} aria-hidden={state.phase !== 'ready'} tabIndex={state.phase === 'ready' ? 0 : -1} aria-label={`Прослушать: ${link.title}`}
        onPlay={(event) => {
          document.querySelectorAll('audio').forEach((other) => { if (other !== event.currentTarget) other.pause() })
        }} onError={() => { if (object.current) { release(); setState({ phase: 'error' }) } }} />
      {(state.phase === 'idle' || state.phase === 'loading') && <Button type="button" variant="ghost" className="edu-audio-initial-play"
        aria-label={`Воспроизвести: ${link.title}`} disabled={state.phase === 'loading'} onClick={() => void prepare()}>
        {state.phase === 'loading' ? <LoaderCircle size={18} aria-hidden="true" /> : <Play size={18} fill="currentColor" aria-hidden="true" />}
      </Button>}
    </div>
    {state.phase === 'loading' && <p role="status"><LoaderCircle size={16} aria-hidden="true" />Загружаем запись…</p>}
    {state.phase === 'error' && <><p role="alert">Не удалось загрузить запись. Попробуйте ещё раз или откройте её на Диске.</p><Button type="button" variant="outline" onClick={() => void prepare()}><RotateCcw size={16} aria-hidden="true" />Повторить</Button></>}
    <a className="edu-audio-original" href={link.url} target="_blank" rel="noopener noreferrer">Открыть на Яндекс.Диске <ExternalLink size={13} aria-hidden="true" /></a>
  </section>
}
