/** Local, opt-in HTTP trace. No files and no changes to the actual request.
 * @see ../../../docs/decisions/mesh-http-trace-2026-11-02.md */
import { randomUUID, createHash } from 'node:crypto'

export function maskSecret(value) {
  const chars = Array.from(String(value ?? ''))
  if (!chars.length) return '(пусто; длина: 0)'
  return `${chars.length > 4 ? chars.slice(0, 2).join('') : ''}******** (длина: ${chars.length})`
}
const publicKeys = new Set(['error', 'grant_type', 'software_id', 'device_type', 'response_type', 'scope',
  'access_type', 'display', 'code_challenge_method', 'expires_in', 'token_type'])
const publicHeaders = new Set(['accept', 'content-type', 'content-length', 'content-encoding', 'accept-language',
  'user-agent', 'date', 'server', 'cache-control', 'pragma', 'expires', 'retry-after', 'x-request-id',
  'request-id', 'x-correlation-id', 'correlation-id', 'traceparent', 'x-trace-id', 'connection', 'vary',
  'strict-transport-security', 'x-content-type-options', 'x-frame-options', 'accept-ch', 'critical-ch',
  'front-end-https', 'transfer-encoding'])
const errorCodes = new Set(['access_denied', 'invalid_client', 'invalid_grant', 'invalid_request', 'invalid_token', 'unauthorized_client', 'unsupported_grant_type', 'invalid_credentials', 'INVALID_PASSWORD', 'WRONG_PASSWORD', 'INVALID_SMS_CODE'])
const genericDenied = 'The resource owner or authorization server denied the request.'

export function traceStack(error) {
  return String(error?.stack || '').split('\n').slice(1).filter(line => /^\s*at .+:\d+:\d+\)?$/.test(line))
    .slice(0, 20).map(line => line.replace(/\?[^\s)]*/g, '?[masked]'))
}

export function createHttpTrace(fetcher, { write = line => process.stdout.write(`${line}\n`),
  now = () => performance.now(), id = randomUUID } = {}) {
  const traceId = id()
  let sequence = 0
  function urlView(value) {
    try {
      const u = new URL(value)
      u.username = ''; u.password = ''; u.hash = ''
      const query = [...u.searchParams].map(([key, val]) => [key, publicKeys.has(key) ? val : maskSecret(val)])
      return { endpoint: `${u.origin}${u.pathname}`, query }
    } catch { return maskSecret(value) }
  }
  function valueView(value, key = '', depth = 0) {
    if (value == null) return value
    if (depth > 8) return '[ограничена глубина]'
    if (Array.isArray(value)) return { items: value.slice(0, 10).map(v => valueView(v, key, depth + 1)), count: value.length }
    if (typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 100)
      .map(([k, v]) => [k, valueView(v, k, depth + 1)]))
    if (key === 'error_description' && value === genericDenied) return value
    if (key === 'error') return errorCodes.has(value) ? value : maskSecret(value)
    if (publicKeys.has(key) && key !== 'token_type') return String(value).slice(0, 1000)
    if (key === 'token_type') return ['Bearer', 'bearer'].includes(value) ? value : maskSecret(value)
    return maskSecret(value)
  }
  function cookieView(line, response) {
    const [pair, ...attributes] = line.split(';')
    const at = pair.indexOf('=')
    if (at < 1) return { name: '[некорректная cookie]', value: maskSecret(line) }
    const result = { name: at < 0 ? pair.trim() : pair.slice(0, at).trim(), value: maskSecret(at < 0 ? '' : pair.slice(at + 1)) }
    if (response) result.attributes = attributes.map(attribute => {
      const at = attribute.indexOf('=')
      const name = (at < 0 ? attribute : attribute.slice(0, at)).trim()
      if (at < 0) return { name }
      const value = attribute.slice(at + 1).trim()
      return { name, value: ['path', 'domain', 'max-age', 'expires', 'samesite'].includes(name.toLowerCase()) ? value : maskSecret(value) }
    })
    return result
  }
  function headersView(input) {
    const headers = new Headers(input)
    return Object.fromEntries([...headers].map(([key, value]) => {
      if (key === 'set-cookie') return [key, headers.getSetCookie().map(line => cookieView(line, true))]
      if (key === 'cookie') return [key, value.split(';').map(line => cookieView(line.trim(), false))]
      if (key === 'location') return [key, urlView(value)]
      if (key === 'authorization') {
        const [scheme, ...parts] = value.split(' ')
        return [key, `${/^(Basic|Bearer)$/i.test(scheme) ? scheme : 'credential'} ${maskSecret(parts.join(' '))}`]
      }
      return [key, publicHeaders.has(key) || /(?:request|correlation|trace)[-_]id$/.test(key) ? value : maskSecret(value)]
    }))
  }
  async function bodyView(body, contentType = '') {
    if (body == null || body === '') return null
    const raw = body instanceof URLSearchParams ? body.toString() : typeof body === 'string' ? body : null
    if (raw == null) return { kind: 'stream-or-binary', inspected: false }
    const summary = { bytes: Buffer.byteLength(raw) }
    try { return { ...summary, json: valueView(JSON.parse(raw)) } } catch { /* Try form data. */ }
    if (body instanceof URLSearchParams || contentType.includes('application/x-www-form-urlencoded')) {
      return { ...summary, form: [...new URLSearchParams(raw)].map(([k, v]) => [k, valueView(v, k)]) }
    }
    return { ...summary, text: maskSecret(raw) }
  }
  function emit(event) { try { write(JSON.stringify(event, null, 2)) } catch { /* Logging cannot change login. */ } }
  return Object.freeze({ traceId, async fetch(url, options = {}) {
    const requestId = `${traceId}:${++sequence}`
    const started = now()
    emit({ direction: 'request', requestId, time: new Date().toISOString(), method: options.method || 'GET',
      url: urlView(url), headers: headersView(options.headers),
      body: await bodyView(options.body, Object.fromEntries(new Headers(options.headers))['content-type'] || ''),
      note: 'Заголовки приложения до HTTP-транспорта; автоматически добавленные транспортом здесь не перечислены.' })
    let response
    try { response = await fetcher(url, options) }
    catch (error) {
      emit({ direction: 'network-error', requestId, elapsedMs: Math.round(now() - started),
        name: ['Error', 'TypeError', 'AbortError', 'TimeoutError'].includes(error?.name) ? error.name : maskSecret(error?.name),
        code: ['ENOTFOUND', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET', 'ABORT_ERR'].includes(error?.cause?.code ?? error?.code) ? (error?.cause?.code ?? error?.code) : maskSecret(error?.cause?.code ?? error?.code), message: maskSecret(error?.message), stack: traceStack(error) })
      throw error
    }
    // Inspect a clone, preserving the exact original response and its readable stream.
    let body
    try {
      const clone = response.clone()
      const limit = 64 * 1024
      const reader = clone.body?.getReader()
      let bytes = 0, pieces = [], truncated = false
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          bytes += value.byteLength
          if (bytes > limit) { truncated = true; void reader.cancel().catch(() => {}); break }
          pieces.push(value)
        }
      }
      const raw = Buffer.concat(pieces).toString('utf8')
      body = truncated ? { inspected: false, reason: 'response-over-64KiB', bytesRead: bytes }
        : { ...await bodyView(raw, Object.fromEntries(response.headers)['content-type'] || ''), sha256: createHash('sha256').update(raw).digest('hex') }
    } catch { body = { inspected: false, reason: 'body-unavailable' } }
    emit({ direction: 'response', requestId, elapsedMs: Math.round(now() - started), httpStatus: response.status,
      statusText: response.statusText, redirected: response.redirected,
      serverRequestIds: Object.fromEntries([...response.headers].filter(([key]) => /(?:request|correlation|trace)[-_]id$/.test(key))),
      headers: headersView(response.headers), body })
    return response
  } })
}
