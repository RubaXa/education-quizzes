import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, ExternalLink, X, ZoomIn, ZoomOut } from 'lucide-react'
import type { DayMaterialLink } from '@/lib/dayStore'
import EducationImage from '@/components/EducationImage'

function pageName(link: DayMaterialLink, index: number) {
  return link.printedPage ? `Страница ${link.printedPage}` : `Лист ${index + 1}`
}

export function canReadInside(link: DayMaterialLink) {
  if (link.sourceType !== 'textbook-page' && link.sourceType !== 'teacher-attachment') return false
  try { return ['yadi.sk', 'disk.yandex.ru'].includes(new URL(link.url).hostname) }
  catch { return false }
}

/**
 * Открывает страницы задания или всю семейную книгу внутри Education.
 * @see ../../docs/product/materials.md#material-reader
 * @see ../../docs/product/family-library.md#full-book-reader
 * @see ../../docs/product/design-system.md#images
 */
export default function MaterialReader({ links, parent, statement = false, book = false }: { links: DayMaterialLink[]; parent: boolean; statement?: boolean; book?: boolean }) {
  const [active, setActive] = useState<number | null>(null)
  const [preview, setPreview] = useState(0)
  const [zoomed, setZoomed] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)
  const touchStart = useRef<number | null>(null)
  const first = links[0]
  const title = first.title.replace(/,\s*(?:стр\.\s*\d+|PDF-страница\s*\d+)\s*$/, '')
  const start = links[0].printedPage
  const end = links.at(-1)?.printedPage
  const range = book ? `${links.length} ${links.length === 1 ? 'страница' : 'страниц'}`
    : start && end ? `стр. ${start}${start === end ? '' : `–${end}`}` : `${links.length} ${links.length === 1 ? 'лист' : 'листов'}`

  useEffect(() => {
    if (active === null) return
    setZoomed(false)
  }, [active, links])

  useEffect(() => {
    if (active === null) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') setActive(null)
      if (event.key === 'ArrowLeft') setActive((value) => value === null ? null : Math.max(0, value - 1))
      if (event.key === 'ArrowRight') setActive((value) => value === null ? null : Math.min(links.length - 1, value + 1))
    }
    window.addEventListener('keydown', keydown)
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', keydown) }
  }, [active !== null, links.length])

  const quote = links.find((link) => link.sourceQuote)?.sourceQuote?.trim()
  return <div className={`day-reader ${statement ? 'day-reader-statement' : ''}`}>
    <div className="day-reader-heading"><strong>{first.sourceType === 'textbook-page' ? 'Страницы учебника' : 'Лист учителя'} · {range}</strong><span>{title}</span></div>
    {book ? <div className="day-reader-book">
      <button type="button" className="day-reader-book-page" onClick={() => setActive(preview)} aria-label={`Открыть крупно: ${pageName(links[preview], preview)}`}>
        <EducationImage key={links[preview].url} source={links[preview].url} mode="public" alt={`${title}, ${pageName(links[preview], preview)}`} retryControl={false} />
      </button>
      <div className="day-reader-book-controls"><button type="button" disabled={preview === 0} onClick={() => setPreview((value) => value - 1)} aria-label="Предыдущая страница"><ChevronLeft size={20} /></button>
        <span>{pageName(links[preview], preview)} · {preview + 1} из {links.length}</span>
        <button type="button" disabled={preview === links.length - 1} onClick={() => setPreview((value) => value + 1)} aria-label="Следующая страница"><ChevronRight size={20} /></button></div>
      <input type="range" min="0" max={links.length - 1} value={Math.min(preview, links.length - 1)} onChange={(event) => setPreview(Number(event.target.value))} aria-label="Перейти к странице книги" />
      <small>Нажмите на страницу, чтобы открыть её крупно.</small>
    </div> : <div className="day-reader-thumbs" aria-label={`Открыть страницы: ${range}`}>
      {links.map((link, index) => <button type="button" className="day-reader-thumb" key={link.url} onClick={() => setActive(index)} aria-label={`Открыть ${pageName(link, index)}`}>
        <EducationImage source={link.url} mode="public" alt="" size={statement ? 'XXXL' : 'S'} fit={statement ? 'contain' : 'cover'} compact={!statement} retryControl={false} />
        <small>{statement ? 'Открыть лист крупно' : pageName(link, index)}</small>
      </button>)}
    </div>}
    {quote && <small className="day-reader-quote">Из учебника: «{quote}»</small>}
    {active !== null && createPortal(<div className="day-reader-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setActive(null) }}>
      <div className="day-reader-dialog" role="dialog" aria-modal="true" aria-label={`${title}, ${pageName(links[active], active)}`}>
        <header><div><strong>{title}</strong><span>{pageName(links[active], active)} · {active + 1} из {links.length}</span></div><div className="day-reader-header-actions"><button type="button" className="day-reader-close" onClick={() => setZoomed((value) => !value)} aria-label={zoomed ? 'Уменьшить страницу' : 'Увеличить страницу'}>{zoomed ? <ZoomOut size={22} /> : <ZoomIn size={22} />}</button><button ref={closeRef} type="button" className="day-reader-close" onClick={() => setActive(null)} aria-label="Закрыть просмотрщик"><X size={23} /></button></div></header>
        <div className={`day-reader-stage ${zoomed ? 'zoomed' : ''}`} onTouchStart={(event) => { touchStart.current = event.changedTouches[0]?.screenX ?? null }} onTouchEnd={(event) => {
          if (touchStart.current === null) return
          const delta = (event.changedTouches[0]?.screenX ?? touchStart.current) - touchStart.current
          if (!zoomed && Math.abs(delta) > 55) setActive((value) => value === null ? null : Math.max(0, Math.min(links.length - 1, value + (delta < 0 ? 1 : -1))))
          touchStart.current = null
        }}>
          <EducationImage source={links[active].url} mode="public" alt={`${title}, ${pageName(links[active], active)}`} className="day-reader-full-image" loading="eager" />
        </div>
        <footer><button type="button" onClick={() => setActive((value) => Math.max(0, (value ?? 0) - 1))} disabled={active === 0}><ChevronLeft size={20} /> Назад</button><span>{pageName(links[active], active)}{parent && links[active].sourceRef ? ` · ${links[active].sourceRef}` : ''}</span><button type="button" onClick={() => setActive((value) => Math.min(links.length - 1, (value ?? 0) + 1))} disabled={active === links.length - 1}>Дальше <ChevronRight size={20} /></button></footer>
        <a className="day-reader-external" href={links[active].url} target="_blank" rel="noopener noreferrer">Открыть оригинал на Яндекс.Диске <ExternalLink size={14} /></a>
      </div>
    </div>, document.body)}
  </div>
}
