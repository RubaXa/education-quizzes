import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

/** @see ../../../docs/modules/school-diary/README.md#family-onboarding-research */
export function hiddenPrompt(label) {
  if (!stdin.isTTY || !stdin.setRawMode) throw new Error('Для входа нужен интерактивный терминал')
  stdout.write(label)
  return new Promise((resolve, reject) => {
    const bytes = []
    stdin.setRawMode(true)
    stdin.resume()
    function finish(error) {
      stdin.off('data', onData)
      stdin.setRawMode(false)
      stdout.write('\n')
      if (error) reject(error)
      else resolve(Buffer.from(bytes).toString('utf8'))
    }
    function onData(chunk) {
      for (const byte of chunk) {
        if (byte === 3) return finish(new Error('Вход прерван'))
        if (byte === 10 || byte === 13) return finish()
        if (byte === 127 || byte === 8) {
          if (bytes.length) {
            bytes.pop()
            while (bytes.length && (bytes.at(-1) & 0xc0) === 0x80) bytes.pop()
          }
          continue
        }
        bytes.push(byte)
      }
    }
    stdin.on('data', onData)
  })
}

export async function confirmPrompt(question) {
  const rl = createInterface({ input: stdin, output: stdout })
  try { return /^(да|yes|y)$/i.test((await rl.question(question)).trim()) }
  finally { rl.close() }
}
