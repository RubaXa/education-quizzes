/** Shared browser/server allowlist for original solution files.
 * @see ../docs/shared/media-storage.md */
export const workFileTypes = Object.freeze({
  'image/jpeg': ['jpg', 'photo'], 'image/png': ['png', 'photo'], 'image/webp': ['webp', 'photo'],
  'image/heic': ['heic', 'photo'], 'image/heif': ['heif', 'photo'],
  'application/pdf': ['pdf', 'pdf'],
  'application/msword': ['doc', 'document'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx', 'document'],
  'application/vnd.ms-excel': ['xls', 'spreadsheet'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx', 'spreadsheet'],
  'application/vnd.ms-powerpoint': ['ppt', 'presentation'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['pptx', 'presentation'],
  'application/vnd.oasis.opendocument.text': ['odt', 'document'],
  'application/vnd.oasis.opendocument.spreadsheet': ['ods', 'spreadsheet'],
  'application/vnd.oasis.opendocument.presentation': ['odp', 'presentation'],
  'application/rtf': ['rtf', 'document'], 'text/plain': ['txt', 'text'],
  'text/csv': ['csv', 'spreadsheet'], 'text/markdown': ['md', 'text'],
})
const aliases = { 'image/jpg': 'image/jpeg', 'text/rtf': 'application/rtf', 'application/csv': 'text/csv', 'text/x-markdown': 'text/markdown' }
export const workFileAccept = ['image/*', ...Object.entries(workFileTypes).filter(([type]) => !type.startsWith('image/')).flatMap(([type, [ext]]) => [`.${ext}`, type])].join(',')
export const maxWorkFileSize = 25_000_000
export function workFileContentType(file) {
  const raw = (file?.type ?? file?.contentType ?? '').toLowerCase().split(';')[0].trim()
  const type = aliases[raw] ?? raw
  const extension = (file?.name ?? file?.originalName ?? '').split('.').pop()?.toLowerCase()
  const byExtension = Object.entries(workFileTypes).find(([, [ext]]) => ext === extension || ext === 'jpg' && extension === 'jpeg')?.[0]
  // Browsers often report CSV/Markdown as plain text and Office files as empty/octet-stream/zip.
  if ((!type || ['application/octet-stream', 'application/zip', 'text/plain'].includes(type)) && byExtension) return byExtension
  return Object.hasOwn(workFileTypes, type) ? type : ''
}
export function workFilePresentation(file) {
  const pathName = file?.storage?.path?.split('/').pop()
  const name = file?.name ?? file?.originalName ?? pathName ?? ''
  const type = workFileContentType({ type: file?.type ?? file?.contentType, name })
  const [extension, kind] = workFileTypes[type] ?? ['', 'photo']
  const label = ({ photo: 'Фото', pdf: 'PDF', document: 'Документ', spreadsheet: 'Таблица', presentation: 'Презентация', text: 'Текст' })[kind]
  return { type, extension, kind, label, name }
}
