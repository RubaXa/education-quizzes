/** A storage pause is resolved only after every photo in that review set is on Disk. */
export function resolvedStoragePause(processing, uploads) {
  if (processing?.phase !== 'paused' || !Array.isArray(processing.uploadIds) || !processing.uploadIds.length) return false
  const storageBlock = processing.blocker === 'storage'
    || !processing.blocker && /перенести именно этот снимок из Firebase в семейный архив Яндекс\.Диска/.test(processing.reason ?? '')
  if (!storageBlock) return false
  return processing.uploadIds.every((id) => {
    const upload = uploads.get(id)
    return upload?.status === 'pending' && upload.storage?.provider === 'yandex-disk'
      && upload.storage.state === 'stored' && Boolean(upload.storage.publicUrl) && !upload.dataUrl
  })
}
