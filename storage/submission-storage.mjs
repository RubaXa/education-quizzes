// A submission archive stores private file bytes and returns a stable provider path.
// The caller keeps task, review and UI state separately from the archive.
export class SubmissionStoragePort {
  async put(_key, _bytes, _expectedMd5) {
    throw new Error('SubmissionStoragePort.put must be implemented')
  }
}
