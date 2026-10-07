export class WriteQueue {
  private tail: Promise<void> = Promise.resolve()

  add(write: () => Promise<void>): Promise<void> {
    const next = this.tail.catch(() => {}).then(write)
    this.tail = next
    return next
  }

  settled(): Promise<void> {
    return this.tail
  }
}
