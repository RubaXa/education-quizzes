import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { createRotatingJsonlSink, createTelemetry, createTelemetryFromEnvironment, parseTraceContext } from './telemetry.mjs'

describe('shared telemetry', () => {
  it('propagates trace and span parents across async work and aggregates monotonic durations', async () => {
    const events = []
    const telemetry = createTelemetry({ sink: (event) => events.push(event) })
    await telemetry.trace('operator.run', async () => {
      const parent = telemetry.current()
      await telemetry.span('mesh.request', async () => {
        expect(telemetry.current().traceId).toBe(parent.traceId)
        telemetry.count('mesh.http.attempts')
      }, { source: 'mesh', url: 'https://private.example/path', actorId: 'private-id' })
      expect(telemetry.snapshot().wall.active).toBe(true)
    }, { operation: 'project.collect', consumer: 'operator' })
    const outer = events.find((event) => event.kind === 'span' && event.operation === 'operator.run')
    const inner = events.find((event) => event.kind === 'span' && event.operation === 'mesh.request')
    expect(inner.traceId).toBe(outer.traceId)
    expect(inner.parentSpanId).toBe(outer.spanId)
    expect(inner.durationMs).toBeGreaterThanOrEqual(0)
    expect(events.find((event) => event.kind === 'span' && event.operation === 'mesh.request').attributes)
      .toEqual({ source: 'mesh' })
    expect(telemetry.snapshot().counters['mesh.http.attempts']).toBe(1)
    expect(telemetry.snapshot().wall).toMatchObject({ count: 1, active: false, totalMs: expect.any(Number), p50Ms: expect.any(Number), p95Ms: expect.any(Number) })
    expect(JSON.stringify(events)).not.toContain('private.example')
    expect(JSON.stringify(events)).not.toContain('private-id')
  })

  it('starts a fresh trace per standalone operation and preserves an explicit upstream parent', async () => {
    const events = []
    const telemetry = createTelemetry({ sink: (event) => events.push(event) })
    let firstTrace
    let secondTrace
    await telemetry.trace('operation.first', async () => {
      firstTrace = telemetry.current().traceId
      await telemetry.span('nested.first', () => {})
    })
    await telemetry.trace('operation.second', async () => { secondTrace = telemetry.current().traceId })
    expect(firstTrace).not.toBe(secondTrace)
    expect(telemetry.snapshot().traceCount).toBe(2)
    expect(events.find((event) => event.operation === 'nested.first').traceId).toBe(firstTrace)

    const upstreamEvents = []
    const upstreamId = 'a'.repeat(32)
    const parentId = 'b'.repeat(32)
    const child = createTelemetry({ sink: (event) => upstreamEvents.push(event), traceId: upstreamId, parentSpanId: parentId })
    await child.trace('child.operation', () => child.span('child.stage', () => {}))
    expect(upstreamEvents.find((event) => event.operation === 'child.operation')).toMatchObject({
      traceId: upstreamId, parentSpanId: parentId,
    })
    expect(upstreamEvents.find((event) => event.operation === 'child.stage').traceId).toBe(upstreamId)
  })

  it('exports hashed event IDs only when their digest is opaque', async () => {
    const events = []
    const telemetry = createTelemetry({ sink: (event) => events.push(event) })
    await telemetry.span('telegram.accept', () => {}, { eventId: 'a'.repeat(64), jobId: 'raw-job-id' })
    expect(events[0].attributes).toEqual({ eventId: 'a'.repeat(64) })
  })

  it('contains sink failures and makes drops visible in the safe summary', () => {
    const telemetry = createTelemetry({ sink: () => { throw new Error('contains sensitive text') } })
    telemetry.count('mesh.http.retries')
    expect(telemetry.snapshot()).toMatchObject({ exporterErrors: 1,
      counters: { 'mesh.http.retries': 1, 'telemetry.exporter.errors': 1 } })
    expect(JSON.stringify(telemetry.snapshot())).not.toContain('sensitive')
  })

  it('contains asynchronous exporter failures as well', async () => {
    const telemetry = createTelemetry({ sink: async () => { throw new Error('private exporter failure') } })
    await telemetry.span('operator.command', () => {})
    await Promise.resolve()
    expect(telemetry.snapshot().exporterErrors).toBe(1)
  })

  it('bounds span memory while keeping total and dropped counts accurate', () => {
    const telemetry = createTelemetry({ maxSpans: 1 })
    telemetry.span('first', () => {})
    telemetry.span('second', () => {})
    expect(telemetry.snapshot()).toMatchObject({ spanCount: 2, bufferedSpanCount: 1, droppedSpans: 1,
      counters: { 'telemetry.spans.dropped': 1 } })
  })

  it('accepts only well-formed propagated identifiers', () => {
    expect(parseTraceContext('{"traceId":"' + 'a'.repeat(32) + '","spanId":"' + 'b'.repeat(32) + '"}'))
      .toEqual({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(32) })
    expect(parseTraceContext('{"traceId":"secret","spanId":"' + 'b'.repeat(32) + '"}')).toBeNull()
    expect(parseTraceContext('not-json')).toBeNull()
  })

  it('initializes a child telemetry port from the operator context environment variable', async () => {
    const previous = process.env.EDUCATION_TRACE_CONTEXT
    const traceId = 'c'.repeat(32)
    const parentSpanId = 'd'.repeat(32)
    process.env.EDUCATION_TRACE_CONTEXT = JSON.stringify({ traceId, spanId: parentSpanId })
    const events = []
    try {
      const telemetry = createTelemetryFromEnvironment({ sink: (event) => events.push(event) })
      await telemetry.trace('child.cli', () => telemetry.span('child.phase', () => {}))
      expect(events.find((event) => event.operation === 'child.cli')).toMatchObject({ traceId, parentSpanId })
      expect(events.find((event) => event.operation === 'child.phase').traceId).toBe(traceId)
    } finally {
      if (previous === undefined) delete process.env.EDUCATION_TRACE_CONTEXT
      else process.env.EDUCATION_TRACE_CONTEXT = previous
    }
  })

  it('writes private JSONL and rotates within the configured file count', () => {
    const directory = mkdtempSync(resolve(tmpdir(), 'education-telemetry-'))
    const path = resolve(directory, 'telemetry.jsonl')
    try {
      const sink = createRotatingJsonlSink(path, { maxBytes: 1024, maxFiles: 2 })
      for (let i = 0; i < 45; i++) sink.write({ kind: 'counter', name: 'test.count', value: i, note: 'x'.repeat(120) })
      sink.write({ kind: 'span', traceId: 'a'.repeat(32), spanId: 'b'.repeat(32), operation: 'mesh.request',
        outcome: 'ok', durationMs: 1, attributes: { source: 'mesh' }, url: 'https://private.example/path', error: 'raw-error' })
      expect(statSync(path).mode & 0o777).toBe(0o600)
      expect(statSync(directory).mode & 0o777).toBe(0o700)
      expect(statSync(`${path}.1`).size).toBeGreaterThan(0)
      expect(statSync(`${path}.2`).size).toBeGreaterThan(0)
      expect(statSync(`${path}.1`).mode & 0o777).toBe(0o600)
      expect(statSync(`${path}.2`).mode & 0o777).toBe(0o600)
      expect(readFileSync(path, 'utf8').trim().split('\n').length).toBeGreaterThan(0)
      expect(readFileSync(path, 'utf8')).not.toContain('private.example')
      expect(readFileSync(path, 'utf8')).not.toContain('raw-error')
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
})
