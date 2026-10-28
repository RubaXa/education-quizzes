// @vitest-environment jsdom
// @see ../../docs/modules/materials/storage-privacy.md#multi-task-photo
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import LinkedWorkPhotos from './LinkedWorkPhotos'
import type { DayUpload } from '@/lib/dayStore'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
vi.mock('./ArtifactAvatar', () => ({ WorkArtifactImage: ({ upload }: { upload: DayUpload }) => <output data-photo={upload.id}>Исходное фото</output>, WorkUploadTime: () => <time dateTime="2026-10-20T10:03:00.000Z">20 октября 2026, 13:03 МСК</time>, workUploadTimeLabel: () => 'Загружено 20 октября 2026, 13:03 МСК' }))

describe('source sheet photo reference', () => {
  it('shows only the selected original intake photo without a second upload', async () => {
    const host = document.createElement('div'); const root = createRoot(host)
    const upload = { id: 'day:photo-one', taskId: 'intake', status: 'pending' } as DayUpload
    const unrelated = { id: 'day:photo-one', taskId: 'unrelated', status: 'pending' } as DayUpload
    try {
      await act(async () => root.render(<LinkedWorkPhotos taskId="task" uploads={[upload, unrelated]} pages={[]} source={{ intakeTaskId: 'intake', uploadIds: ['photo-one'] }} />))
      expect(host.querySelectorAll('button')).toHaveLength(1)
      expect(host.textContent).toContain('Фото условия')
      await act(async () => host.querySelector<HTMLButtonElement>('button')!.click())
      expect(host.querySelector('[data-photo]')?.getAttribute('data-photo')).toBe(upload.id)
      expect(host.textContent).toContain('исходное фото листа')
      expect(host.querySelector('input')).toBeNull()
    } finally { await act(async () => root.unmount()) }
  })
})

describe('read-only photo reference', () => {
  it('loads the original only on request, has no upload/delete action and closes on a second click', async () => {
    const host = document.createElement('div')
    const root = createRoot(host)
    const upload = { id: 'day:photo', taskId: 'p1', coveredTaskIds: ['p1', 'p2'], status: 'reviewed', createdAt: '2026-10-20T10:03:00Z' } as DayUpload
    try {
      await act(async () => root.render(<LinkedWorkPhotos taskId="p2" uploads={[upload]} pages={[]} />))
      expect(host.textContent).toContain('Фото загружено в «другое задание»')
      const reference = host.querySelector<HTMLButtonElement>('button')!
      expect(reference.title).toContain('Фото 1')
      expect(reference.title).toContain('Проверено')
      expect(reference.title).toContain('20 октября 2026, 13:03 МСК')
      expect(reference.getAttribute('aria-label')).toContain(reference.title)
      expect(host.querySelector('[data-photo]')).toBeNull()
      expect(host.querySelector('input')).toBeNull()
      await act(async () => reference.click())
      expect(reference.getAttribute('aria-expanded')).toBe('true')
      expect(host.querySelector('[data-photo]')?.getAttribute('data-photo')).toBe(upload.id)
      expect(host.textContent).toContain('файл остаётся в месте загрузки')
      expect(host.querySelector('.linked-work-photo-view time')?.textContent).toContain('МСК')
      expect(host.querySelectorAll('button')).toHaveLength(1)
      await act(async () => reference.click())
      expect(host.querySelector('[data-photo]')).toBeNull()
      await act(async () => root.render(<LinkedWorkPhotos taskId="p1" uploads={[upload]} pages={[]} />))
      expect(host.querySelector('.linked-work-photos')).toBeNull()
    } finally { await act(async () => root.unmount()) }
  })
})
