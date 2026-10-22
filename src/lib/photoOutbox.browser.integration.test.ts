import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const runner = fileURLToPath(new URL('../../scripts/photo-outbox-chromium-integration.mjs', import.meta.url))

describe('photo transfer in real Chromium IndexedDB', () => {
  let child: ReturnType<typeof spawn> | undefined
  afterEach(() => { child?.kill(); child = undefined })

  it('recovers a real aborted IDB read and uploads the same stored blob once with its source event', async () => {
    const result = await new Promise<{ code: number | null; output: string }>((resolve, reject) => {
      child = spawn(process.execPath, [runner], { stdio: ['ignore', 'pipe', 'pipe'] })
      let output = ''
      child.stdout?.on('data', (chunk) => { output += String(chunk) })
      child.stderr?.on('data', (chunk) => { output += String(chunk) })
      child.once('error', reject)
      child.once('close', (code) => resolve({ code, output }))
    })
    expect(result.code, result.output).toBe(0)
    expect(result.output).toContain('Chromium real IndexedDB save/read abort recovery → same Blob PUT → atomic bytes-uploaded source/event: passed')
  }, 30_000)
})
