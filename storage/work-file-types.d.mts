/** @see ../docs/shared/media-storage.md */
export type WorkFileKind = 'photo' | 'pdf' | 'document' | 'spreadsheet' | 'presentation' | 'text'
export type WorkFileMetadata = { name?: string; originalName?: string; type?: string; contentType?: string; storage?: { path?: string } }
export const workFileTypes: Readonly<Record<string, readonly [string, WorkFileKind]>>
export const workFileAccept: string
export const maxWorkFileSize: number
export function workFileContentType(file: WorkFileMetadata): string
export function workFilePresentation(file: WorkFileMetadata): { type: string; extension: string; kind: WorkFileKind; label: string; name: string }
