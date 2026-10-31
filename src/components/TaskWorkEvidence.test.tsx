// @vitest-environment jsdom
/** @see ../../docs/shared/design/components.md#work-artifacts */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import TaskWorkEvidence from './TaskWorkEvidence'
import WorkAttachmentThumbnail from './WorkAttachmentThumbnail'
import type { DayUpload } from '@/lib/dayStore'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const uploads: DayUpload[] = [
  { id: 'demo:image', taskId: 'task', status: 'pending', contentType: 'image/png', dataUrl: 'data:image/png;base64,preview' },
  { id: 'demo:pdf', taskId: 'task', status: 'pending', contentType: 'application/pdf', originalName: 'Решение.pdf' },
]

describe('canonical task evidence layouts', () => {
  it.each(['day', 'weekend'] as const)('keeps %s controls, opens images and documents and deletes the exact owned file', async layout => {
    const host = document.createElement('div'), root = createRoot(host), remove = vi.fn(async () => {})
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    try {
      await act(async () => root.render(<TaskWorkEvidence layout={layout} taskId="task" taskTitle="Работа" studentToken="demo" uploads={uploads} localPhotos={[]} now={0} pages={[]} onDelete={remove} />))
      expect(Boolean(host.querySelector('.work-photo-gallery-compact'))).toBe(layout === 'weekend')
      expect(Boolean(host.querySelector('.day-upload-head'))).toBe(layout === 'day')
      expect(host.querySelectorAll('.weekend-math-photo-delete')).toHaveLength(layout === 'weekend' ? 2 : 0)
      await act(async () => host.querySelectorAll<HTMLButtonElement>('.day-upload-chip')[0].click())
      expect(host.querySelector('.day-upload-expanded img')?.getAttribute('src')).toContain('data:image/png')
      await act(async () => host.querySelectorAll<HTMLButtonElement>('.day-upload-chip')[1].click())
      expect(host.querySelector('.day-upload-expanded strong')?.textContent).toBe('Решение.pdf')
      expect(host.querySelector('.day-upload-expanded img')).toBeNull()
      await act(async () => host.querySelector<HTMLButtonElement>('.day-upload-delete')!.click())
      expect(remove).toHaveBeenCalledWith('demo:pdf')
      expect(confirm).toHaveBeenCalledTimes(layout === 'day' ? 1 : 0)
    } finally { confirm.mockRestore(); await act(async () => root.unmount()) }
  })
  it('keeps selection and compact deletion as separate sibling actions', async () => {
    const host = document.createElement('div'), root = createRoot(host), toggle = vi.fn(), remove = vi.fn()
    const draw = (choosing: boolean) => root.render(<WorkAttachmentThumbnail compact choosing={choosing} label="PDF · работа" selected onToggle={toggle} onDelete={remove} deleteLabel="Удалить PDF"><span>PDF</span></WorkAttachmentThumbnail>)
    try {
      await act(async () => draw(false))
      expect(host.querySelector('.day-upload-chip')?.getAttribute('aria-expanded')).toBe('true')
      expect(host.querySelector('.day-upload-chip button')).toBeNull()
      await act(async () => host.querySelector<HTMLButtonElement>('.weekend-math-photo-delete')!.click())
      expect(remove).toHaveBeenCalledTimes(1); expect(toggle).not.toHaveBeenCalled()
      await act(async () => draw(true))
      expect(host.querySelector('.day-upload-chip')?.getAttribute('aria-pressed')).toBe('true')
      expect(host.querySelector('.day-upload-chip')?.hasAttribute('aria-expanded')).toBe(false)
      expect(host.querySelector('.weekend-math-photo-delete')).toBeNull()
      await act(async () => host.querySelector<HTMLButtonElement>('.day-upload-chip')!.click())
      expect(toggle).toHaveBeenCalledTimes(1)
    } finally { await act(async () => root.unmount()) }
  })
})
