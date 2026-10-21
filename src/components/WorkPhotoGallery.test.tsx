// @vitest-environment jsdom
// @see ../../docs/modules/school-diary/day-page.md#photo-status
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import WorkPhotoGallery from './WorkPhotoGallery'
import type { DayUpload } from '@/lib/dayStore'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const image = 'data:image/png;base64,original'

describe('own photo actions', () => {
  it.each([false, true])('opens a local photo and preserves selection through the server handoff, compact=%s', async (compact) => {
    const host = document.createElement('div'), root = createRoot(host)
    const local = { id: 'local', taskId: 'p1', previewUrl: 'blob:preview', state: 'uploading' as const }
    const draw = (uploads: DayUpload[]) => <WorkPhotoGallery compact={compact} taskTitle="Работа" studentToken="day" uploads={uploads} localPhotos={[local]} now={0} />
    try {
      await act(async () => root.render(draw([])))
      await act(async () => host.querySelector<HTMLButtonElement>('.day-upload-chip')!.click())
      expect(host.querySelector('.day-upload-expanded img')?.getAttribute('src')).toBe('blob:preview')
      await act(async () => root.render(draw([{ id: 'day:local', taskId: 'p1', status: 'pending' }])))
      expect(host.querySelectorAll('.day-upload-chip')).toHaveLength(1)
      expect(host.querySelectorAll('.day-upload-expanded')).toHaveLength(1)
      expect(host.querySelector('.day-upload-expanded img')?.getAttribute('src')).toBe('blob:preview')
      await act(async () => host.querySelector<HTMLButtonElement>('.day-upload-chip')!.click())
      expect(host.querySelector('.day-upload-expanded')).toBeNull()
    } finally { await act(async () => root.unmount()) }
  })

  it.each([false, true])('retains pending removal and reviewed read-only viewing, compact=%s', async (compact) => {
    const host = document.createElement('div'), root = createRoot(host)
    const remove = vi.fn(async () => {})
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const photo = { id: 'day:photo', taskId: 'p1', status: 'pending', dataUrl: image } as DayUpload
    const draw = (upload: DayUpload) => <WorkPhotoGallery compact={compact} taskTitle="Работа" studentToken="day" uploads={[upload]} localPhotos={[]} now={0} onDelete={remove} />
    try {
      await act(async () => root.render(draw(photo)))
      await act(async () => host.querySelector<HTMLButtonElement>('.day-upload-chip')!.click())
      expect(host.querySelector('.day-upload-expanded img')?.getAttribute('src')).toBe(image)
      await act(async () => root.render(draw({ ...photo, status: 'reviewed' })))
      expect(host.querySelector('.day-upload-delete')).toBeNull()
      expect(host.querySelector('.weekend-math-photo-delete')).toBeNull()
      await act(async () => root.render(draw(photo)))
      await act(async () => host.querySelector<HTMLButtonElement>('.day-upload-delete')!.click())
      expect(remove).toHaveBeenCalledWith(photo.id)
      expect(host.querySelector('.day-upload-chip')).toBeNull()
    } finally { await act(async () => root.unmount()); confirm.mockRestore() }
  })

  it('retains retry for a failed local image', async () => {
    const host = document.createElement('div'), root = createRoot(host), retry = vi.fn()
    const local = { id: 'local', taskId: 'p1', previewUrl: 'blob:preview', state: 'failed' as const, error: 'Передача не удалась' }
    try {
      await act(async () => root.render(<WorkPhotoGallery taskTitle="Работа" studentToken="day" uploads={[]} localPhotos={[local]} now={0} onRetry={retry} />))
      await act(async () => host.querySelector<HTMLButtonElement>('.day-upload-chip')!.click())
      await act(async () => host.querySelector<HTMLButtonElement>('.day-upload-retry')!.click())
      expect(retry).toHaveBeenCalledWith(local)
    } finally { await act(async () => root.unmount()) }
  })

  it('exposes server upload time in thumbnail tooltip, accessible name, and expanded touch view', async () => {
    const host = document.createElement('div'), root = createRoot(host)
    const upload = { id: 'day:photo', taskId: 'p1', status: 'reviewed', createdAt: '2026-10-20T10:03:00Z', dataUrl: image } as DayUpload
    try {
      await act(async () => root.render(<WorkPhotoGallery taskTitle="Работа" studentToken="day" uploads={[upload]} localPhotos={[]} now={0} />))
      const thumbnail = host.querySelector<HTMLButtonElement>('.day-upload-chip')!
      expect(thumbnail.title).toContain('Фото 1')
      expect(thumbnail.title).toContain('Проверено')
      expect(thumbnail.title).toContain('20 октября 2026, 13:03 МСК')
      expect(thumbnail.getAttribute('aria-label')).toContain(thumbnail.title)
      await act(async () => thumbnail.click())
      const time = host.querySelector<HTMLTimeElement>('.day-upload-expanded time')!
      expect(time.dateTime).toBe('2026-10-20T10:03:00.000Z')
      expect(time.textContent).toContain('МСК')
    } finally { await act(async () => root.unmount()) }
  })

  it('does not invent a time for legacy uploads or local pending photos', async () => {
    const host = document.createElement('div'), root = createRoot(host)
    const upload = { id: 'day:old', taskId: 'p1', status: 'pending', storage: { syncedAt: '2026-10-20T10:03:00Z' } } as DayUpload
    const local = { id: 'local', taskId: 'p1', previewUrl: 'blob:preview', state: 'uploading' as const }
    try {
      await act(async () => root.render(<WorkPhotoGallery taskTitle="Работа" studentToken="day" uploads={[upload]} localPhotos={[local]} now={0} />))
      expect(host.querySelectorAll('.day-upload-chip')[0].getAttribute('aria-label')).toContain('Время загрузки неизвестно')
      expect(host.querySelectorAll('.day-upload-chip')[1].getAttribute('aria-label')).toContain('Время загрузки появится после передачи фото')
      await act(async () => host.querySelectorAll<HTMLButtonElement>('.day-upload-chip')[0].click())
      expect(host.querySelector('.day-upload-expanded time')).toBeNull()
      expect(host.querySelector('.day-upload-expanded')?.textContent).toContain('Время загрузки неизвестно')
    } finally { await act(async () => root.unmount()) }
  })
})
