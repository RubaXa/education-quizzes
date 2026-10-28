// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import type { DayUpload } from '@/lib/dayStore'
import PhotoHelpPanel from './PhotoHelpPanel'
import WorkPhotoGallery from './WorkPhotoGallery'

vi.mock('@/lib/browserAccessTrace', () => ({ tracePhotoHelp: vi.fn() }))
import { tracePhotoHelp } from '@/lib/browserAccessTrace'
vi.mock('@/lib/dayStore', () => ({ requestDayHelp: vi.fn(async () => {}), watchDayHelpHistory: vi.fn((_day, _task, onChange) => { onChange([]); return () => {} }) }))
import { requestDayHelp } from '@/lib/dayStore'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const photo = (id: string, status = 'pending') => ({ id: `day:${id}`, taskId: 'task', status, storage: { state: 'stored' }, dataUrl: 'data:image/png;base64,eA==' }) as DayUpload

describe('photo help through the shared gallery', () => {
  it('selects two stored photos, requires evidence and submits exactly these photos', async () => {
    const rootElement = document.createElement('div'), root = createRoot(rootElement)
    const photos = [photo('aaaaaaaaaaaaaaaaaaaa'), photo('bbbbbbbbbbbbbbbbbbbb'), photo('cccccccccccccccccccc', 'upload-error')]
    const draw = <PhotoHelpPanel studentToken="day" taskId="task" parent={false} canRequest uploads={photos} guidance={[]} gallery={selection => <WorkPhotoGallery taskTitle="Задача" studentToken="day" uploads={photos} localPhotos={[]} now={0} selection={selection} />} />
    try {
      await act(async () => root.render(draw))
      const details = rootElement.querySelector<HTMLDetailsElement>('details')!
      await act(async () => { details.open = true; details.dispatchEvent(new Event('toggle', { bubbles: false })) })
      const submit = rootElement.querySelector<HTMLButtonElement>('.problem-statement-help-button')!
      expect(submit.disabled).toBe(true)
      const chips = rootElement.querySelectorAll<HTMLButtonElement>('.day-upload-chip')
      expect(chips[2].disabled).toBe(true)
      await act(async () => chips[0].click())
      await act(async () => chips[1].click())
      expect(submit.disabled).toBe(false)
      await act(async () => submit.click())
      expect(requestDayHelp).toHaveBeenCalledWith('day', 'task', 1, 'step', '', { photoUploadIds: ['aaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbb'], operationId: expect.any(String) })
      expect(tracePhotoHelp).toHaveBeenCalledWith('selection-changed', 'product', 'student', { count: 2 })
      expect(tracePhotoHelp).toHaveBeenCalledWith('submitted', 'product', 'student', { count: 2, hasNote: false })
    } finally { await act(async () => root.unmount()) }
  })
  it('allows a text-only addition to a pending request using its existing photo evidence', async () => {
    const host = document.createElement('div'), root = createRoot(host), id = 'aaaaaaaaaaaaaaaaaaaa'
    try {
      await act(async () => root.render(<PhotoHelpPanel studentToken="day" taskId="task" parent={false} canRequest uploads={[photo(id)]} help={{ id: 'x', taskId: 'task', revision: 1, photoUploadIds: [id], eventReceiptId: 'pending' }} guidance={[]} gallery={() => null} />))
      const textarea = host.querySelector<HTMLTextAreaElement>('textarea')!
      await act(async () => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(textarea, 'Новое пояснение'); textarea.dispatchEvent(new Event('input', { bubbles: true })) })
      const button = host.querySelector<HTMLButtonElement>('.problem-statement-help-button')!
      expect(button.disabled).toBe(false)
      await act(async () => button.click())
      expect(requestDayHelp).toHaveBeenLastCalledWith('day', 'task', 1, 'step', 'Новое пояснение', { photoUploadIds: [id], operationId: expect.any(String) })
    } finally { await act(async () => root.unmount()) }
  })
  it('shows the parent the pending request and answer without request controls', async () => {
    const host = document.createElement('div'), root = createRoot(host)
    try {
      await act(async () => root.render(<PhotoHelpPanel studentToken="day" taskId="task" parent canRequest={false} uploads={[photo('one'), photo('two')]} help={{ id: 'x', taskId: 'task', revision: 1, eventReceiptId: 'event', photoUploadIds: ['one', 'two'], requestText: 'Вопрос' }} guidance={[{ id: 'g', taskId: 'task', stageId: 'help-response', stageIndex: 0, level: 'reveal', text: 'Следующий шаг', guideRevision: 1, actorPersonId: 'operator', createdAt: 1, sourceRequestEventId: 'event' }]} gallery={() => null} />))
      expect(host.textContent).toContain('Фото в запросе: 2 (в галерее: 1, 2)')
      expect(host.textContent).toContain('Следующий шаг')
      expect(host.querySelector('textarea')).toBeNull()
      expect(host.textContent).not.toContain('ждём ответ')
    } finally { await act(async () => root.unmount()) }
  })
})
