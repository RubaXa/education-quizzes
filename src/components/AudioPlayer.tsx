import { useEffect, useId, useRef, useState } from 'react'
import { ExternalLink, Headphones, LoaderCircle, RotateCcw } from 'lucide-react'
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

  function release() {
    audio.current?.pause()
    if (object.current?.startsWith('blob:')) URL.revokeObjectURL(object.current)
    object.current = undefined
  }

  async function prepare() {
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
    {state.phase === 'idle' && <Button type="button" variant="outline" onClick={() => void prepare()}><Headphones size={16} aria-hidden="true" />Слушать</Button>}
    {state.phase === 'loading' && <p role="status"><LoaderCircle size={16} aria-hidden="true" />Загружаем запись…</p>}
    {state.phase === 'error' && <><p role="alert">Не удалось загрузить запись. Попробуйте ещё раз или откройте её на Диске.</p><Button type="button" variant="outline" onClick={() => void prepare()}><RotateCcw size={16} aria-hidden="true" />Повторить</Button></>}
    {state.phase === 'ready' && <>
      <audio ref={audio} controls preload="none" src={state.src} aria-label={`Прослушать: ${link.title}`}
        onPlay={(event) => {
          document.querySelectorAll('audio').forEach((other) => { if (other !== event.currentTarget) other.pause() })
        }} onError={() => { release(); setState({ phase: 'error' }) }} />

    </>}
    <a className="edu-audio-original" href={link.url} target="_blank" rel="noopener noreferrer">Открыть на Яндекс.Диске <ExternalLink size={13} aria-hidden="true" /></a>
  </section>
}
