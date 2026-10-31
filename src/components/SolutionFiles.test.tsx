// @vitest-environment jsdom
/** @see ../../docs/shared/media-storage.md */
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { it, expect, vi } from 'vitest'
import WorkPhotoGallery from './WorkPhotoGallery'
import PhotoUploadControl from './PhotoUploadControl'
import WorkFilePreview from './WorkFilePreview'
import WorkReview from './WorkReview'
import type { DayUpload } from '@/lib/dayStore'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

it('selects a mixed batch, resets the input, and permits selecting it again', async () => {
  const host = document.createElement('div'), root = createRoot(host), receive = vi.fn()
  const files = [new File(['%PDF'], 'work.pdf', { type: 'application/pdf' }), new File(['text'], 'work.txt', { type: 'text/plain' }), new File(['image'], 'work.png', { type: 'image/png' })]
  try {
    await act(async () => root.render(<PhotoUploadControl label="Загрузить решение" onPhotos={receive} />))
    const input = host.querySelector('input')!
    Object.defineProperty(input, 'files', { value: files })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
    expect(receive).toHaveBeenLastCalledWith(files)
    expect(input.value).toBe('')
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
    expect(receive).toHaveBeenCalledTimes(2)
    expect(host.querySelector('.lucide-paperclip')).toBeTruthy()
  } finally { await act(async () => root.unmount()) }
})

it.each([false, true])('opens local and confirmed documents with names and format icons; compact=%s', async compact => {
  const host = document.createElement('div'), root = createRoot(host), remove = vi.fn(async () => {})
  const files = [new File(['%PDF'], 'Решение.pdf', { type: 'application/pdf' }), new File(['doc'], 'Решение.docx'), new File(['sheet'], 'Ответ.xlsx'), new File(['text'], 'Ответ.txt', { type: 'text/plain' })]
  const local = files.map((file, i) => ({ id: `file${i}`, taskId: 'task', previewUrl: `blob:local${i}`, state: 'uploading' as const, file }))
  const uploads = files.map((file, i) => ({ id: `day:file${i}`, taskId: 'task', originalName: file.name, status: 'pending', storage: { provider: 'yandex-disk', state: 'stored', path: `app:/work/${file.name}`, publicUrl: `https://disk.yandex.ru/i/file${i}` } } as DayUpload))
  try {
    const draw = (saved: DayUpload[]) => root.render(<WorkPhotoGallery compact={compact} taskTitle="Работа" studentToken="day" uploads={saved} localPhotos={local} now={0} onDelete={remove} />)
    await act(async () => draw([]))
    expect(host.querySelectorAll('.work-file-preview-compact')).toHaveLength(4)
    expect(host.querySelector('img')).toBeNull()
    expect(host.querySelectorAll('[data-file-kind="spreadsheet"]')).toHaveLength(1)
    await act(async () => host.querySelectorAll<HTMLButtonElement>('.day-upload-chip')[1].click())
    expect(host.querySelector('.day-upload-expanded')?.textContent).toContain('Решение.docx')
    expect(host.querySelector('.day-upload-expanded a')?.getAttribute('href')).toBe('blob:local1')
    await act(async () => draw(uploads))
    expect(host.querySelectorAll('.day-upload-chip')).toHaveLength(4)
    expect(host.querySelector('.day-upload-expanded')?.textContent).toContain('Решение.docx')
    expect(host.querySelector('.day-upload-expanded a')?.getAttribute('href')).toBe('https://disk.yandex.ru/i/file1')
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Закрыть файл"]')!.click())
    expect(host.querySelector('.day-upload-expanded')).toBeNull()
  } finally { await act(async () => root.unmount()) }
})

it('keeps local document retry and delete actions', async () => {
  const host = document.createElement('div'), root = createRoot(host), retry = vi.fn(), remove = vi.fn(async () => {})
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  const file = new File(['text'], 'solution.txt', { type: 'text/plain' })
  const local = { id: 'text', taskId: 'task', previewUrl: 'blob:text', state: 'failed' as const, file, error: 'Сеть недоступна' }
  try {
    await act(async () => root.render(<WorkPhotoGallery taskTitle="Работа" studentToken="day" uploads={[]} localPhotos={[local]} now={0} onRetry={retry} onDelete={remove} />))
    await act(async () => host.querySelector<HTMLButtonElement>('.day-upload-chip')!.click())
    await act(async () => host.querySelector<HTMLButtonElement>('.day-upload-retry')!.click())
    expect(retry).toHaveBeenCalledWith(local)
    expect(host.textContent).toContain('Сеть недоступна')
    await act(async () => host.querySelector<HTMLButtonElement>('.day-upload-delete')!.click())
    expect(remove).toHaveBeenCalledWith('day:text')
    expect(confirm).toHaveBeenCalledWith('Удалить этот файл из задания?')
    expect(host.querySelector('.day-upload-expanded')).toBeNull()
  } finally { confirm.mockRestore(); await act(async () => root.unmount()) }
})

it('restores a local document link and releases its Blob URL on close', async () => {
  const host = document.createElement('div'), root = createRoot(host)
  const resolve = vi.fn(async () => 'blob:restored'), revoke = vi.fn()
  vi.stubGlobal('URL', class extends URL { static revokeObjectURL = revoke })
  try {
    await act(async () => root.render(<WorkFilePreview file={{originalName:'solution.pdf', contentType:'application/pdf'}} source="day:file" resolver={resolve} />))
    expect(resolve).toHaveBeenCalledWith('day:file')
    expect(host.querySelector('a')?.getAttribute('href')).toBe('blob:restored')
    await act(async () => root.unmount())
    expect(revoke).toHaveBeenCalledWith('blob:restored')
  } finally { vi.unstubAllGlobals() }
})

it('describes received documents as work awaiting review, without changing the result', async () => {
  const host = document.createElement('div'), root = createRoot(host)
  try {
    await act(async () => root.render(<WorkReview uploads={[{id:'day:pdf',taskId:'task',status:'pending',contentType:'application/pdf',originalName:'solution.pdf'}]} />))
    expect(host.textContent).toContain('Работа получена · ждёт проверки')
    expect(host.textContent).not.toContain('Фото получено')
    expect(host.textContent).not.toContain('Засчитано')
  } finally { await act(async () => root.unmount()) }
})
