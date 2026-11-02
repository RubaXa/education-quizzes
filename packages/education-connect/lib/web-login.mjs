/** Cookie-preserving HTTP login for the existing official diary web client.
 * @see ../../../docs/decisions/mesh-web-login-2026-11-02.md */
import { createHash, randomBytes } from 'node:crypto'
import { CookieJar } from 'tough-cookie'
import { loginFailure } from './login-diagnostics.mjs'

const loginOrigin = 'https://login.mos.ru'
const callback = 'https://school.mos.ru/v3/auth/sudir/callback'
const hosts = new Set(['login.mos.ru', 'school.mos.ru', 'dnevnik.mos.ru'])
const labels = { 'oauth-init': 'подготовка веб-входа mos.ru', password: 'проверка логина и пароля mos.ru', sms: 'подтверждение SMS', 'mesh-exchange': 'завершение веб-входа МЭШ' }

export function validWebSession(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value.cookies)
    && value.cookies.length <= 100 && JSON.stringify(value).length <= 256 * 1024
    && value.cookies.every(c => c && typeof c.key === 'string' && typeof c.value === 'string'
      && typeof c.domain === 'string' && (hosts.has(c.domain.replace(/^\./, '')) || c.domain === 'mos.ru'))
}

export function webTokenIdentity(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
    if (typeof payload.msh !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(payload.msh)) throw Error()
    // A decoded claim is a lookup hint only. MeshDiaryAdapter verifies it against the server.
    return payload.msh
  } catch { throw loginFailure({ stage: 'profile', reason: 'unexpected-response' }) }
}

export function solveHashcash(header) {
  if (typeof header !== 'string' || header.length > 2048) throw loginFailure({ stage: 'password', reason: 'unexpected-response' })
  const bits = Number(header.split(':')[1])
  if (!/^1:\d+:/.test(header) || !Number.isInteger(bits) || bits < 1 || bits > 24) throw loginFailure({ stage: 'password', reason: 'unexpected-response' })
  const bytes = Math.floor(bits / 8), remaining = bits % 8
  for (let counter = 0; counter < 10_000_000; counter++) {
    const stamp = header + counter.toString(16), hash = createHash('sha1').update(stamp).digest()
    if (hash.subarray(0, bytes).every(byte => byte === 0) && (!remaining || hash[bytes] >>> (8 - remaining) === 0)) return stamp
  }
  throw loginFailure({ stage: 'password', reason: 'unexpected-response' })
}

export async function authenticateWeb({ fetch: fetcher, username, password, askSmsCode, confirmTrust,
  onProgress = () => {}, session = null, interactive = true, state = randomBytes(24).toString('base64url') }) {
  if (session && !validWebSession(session)) throw loginFailure({ stage: 'oauth-init', reason: 'unexpected-response' })
  const jar = session ? CookieJar.deserializeSync(session) : new CookieJar(undefined, { prefixSecurity: 'strict' })
  let requests = 0, stage = 'oauth-init', passwordSent = false, smsSent = false, smsAttempts = 0, callbackSeen = false, issuedToken = null
  const fail = (providerCode, reason = 'provider-rejected', httpStatus) => loginFailure({ stage, providerCode, reason, httpStatus })
  function allowed(value) {
    const url = new URL(value)
    if (url.protocol !== 'https:' || !hosts.has(url.hostname) || url.username || url.password || url.port) throw fail(null, 'unexpected-redirect')
    return url
  }
  async function request(address, nextStage, body) {
    stage = nextStage
    const url = allowed(address)
    if (++requests > 24) throw fail(null, 'unexpected-response')
    if (body != null && (url.origin !== loginOrigin || !['/sps/login/methods/headless/password', '/sps/login/methods/headless/sms/bind'].includes(url.pathname))) throw fail(null, 'unexpected-redirect')
    onProgress(`Этап: ${labels[stage]}…`)
    const headers = { Accept: 'application/json' }
    const cookies = await jar.getCookieString(url.toString())
    if (cookies) headers.Cookie = cookies
    if (body != null) headers['Content-Type'] = 'application/x-www-form-urlencoded'
    let response
    try { response = await fetcher(url.toString(), { method: body == null ? 'GET' : 'POST', redirect: 'manual', headers, ...(body == null ? {} : { body }) }) }
    catch (error) { throw loginFailure({ stage, reason: 'network', networkCode: error?.cause?.code ?? error?.code }) }
    try {
      for (const cookie of response.headers.getSetCookie()) {
        const stored = await jar.setCookie(cookie, url.toString())
        if (url.origin === 'https://school.mos.ru' && stage === 'mesh-exchange' && ['auth_token', 'aupd_token', 'aupdtoken'].includes(stored?.key)) issuedToken = stored.value
      }
    }
    catch { throw fail(null, 'unexpected-response', response.status) }
    let data = null, text = ''
    try { text = await response.text() } catch (error) { throw loginFailure({ stage, reason: 'network', networkCode: error?.cause?.code ?? error?.code }) }
    try { data = JSON.parse(text) } catch { /* A callback may be an HTML redirect. */ }
    return { response, data, text, url }
  }
  async function resultIfReady() {
    if (!callbackSeen) return null
    const cookies = await jar.getCookies('https://school.mos.ru/')
    const token = cookies.find(c => ['auth_token', 'aupd_token', 'aupdtoken'].includes(c.key) && c.value && c.value === issuedToken)?.value
    if (!token) return null
    return { token, personId: webTokenIdentity(token), authMethod: 'web', webSession: jar.serializeSync() }
  }
  const initial = new URL(`${loginOrigin}/sps/oauth/ae`)
  initial.search = new URLSearchParams({ response_type: 'code', access_type: 'offline', client_id: 'dnevnik.mos.ru',
    scope: 'openid profile birthday contacts snils blitz_user_rights blitz_change_password', redirect_uri: callback,
    display: 'script', state, ...(!interactive ? { prompt: 'none' } : {}) }).toString()
  let current = await request(initial, 'oauth-init')
  for (let step = 0; step < 24; step++) {
    const { response, data, text, url } = current
    const location = Object.fromEntries(response.headers).location
    if (response.status >= 300 && response.status < 400 && location) {
      const next = allowed(new URL(location, url).toString())
      if (next.origin === 'https://school.mos.ru' && next.pathname === '/v3/auth/sudir/callback') {
        const query = Object.fromEntries(next.searchParams)
        if ([...next.searchParams].filter(([key]) => key === 'state').length !== 1 || query.state !== state) throw fail(null, 'state-mismatch', response.status)
        if (next.searchParams.has('error')) throw fail(query.error, 'provider-rejected', response.status)
        if (!query.code) throw fail(null, 'unexpected-response', response.status)
        callbackSeen = true
      }
      current = await request(next, callbackSeen ? 'mesh-exchange' : 'oauth-init')
      const ready = await resultIfReady()
      if (current.response.ok || current.response.status >= 300 && current.response.status < 400) { if (ready) return ready }
      continue
    }
    const providerError = data?.error ?? data?.errors?.[0]?.code
    if (!response.ok || providerError) {
      if (interactive && providerError === 'invalid_otp' && Number(data?.remain_attempts) > 0 && smsAttempts < 3) {
        const code = await askSmsCode?.()
        if (!code) throw fail(null, 'interactive-required')
        smsAttempts++
        current = await request(`${loginOrigin}/sps/login/methods/headless/sms/bind`, 'sms', new URLSearchParams({ 'sms-code': code }).toString())
        continue
      }
      throw fail(providerError, 'provider-rejected', response.status)
    }
    const ready = await resultIfReady()
    if (ready) return ready
    if (!interactive) throw fail('login_required', 'interactive-required', response.status)
    const items = Array.isArray(data?.items) ? data.items : []
    const passwordItem = data?.inquire === 'login_with_password' ? data : items.find(i => i.inquire === 'login_with_password')
    if (passwordItem && !passwordSent) {
      if (!username || !password) throw fail(null, 'interactive-required')
      passwordSent = true
      const proofOfWork = passwordItem.proofOfWork ? solveHashcash(String(passwordItem.proofOfWork)) : ''
      current = await request(`${loginOrigin}/sps/login/methods/headless/password`, 'password', new URLSearchParams({ login: username, password, proofOfWork }).toString())
      continue
    }
    if ((data?.inquire === 'ask_to_send_sms' || items.some(i => i.inquire === 'ask_to_send_sms')) && !smsSent) {
      smsSent = true
      current = await request(`${loginOrigin}/sps/login/methods/headless/sms/bind`, 'sms', '')
      continue
    }
    if (data?.inquire === 'enter_sms_code' && smsAttempts < 3) {
      const code = await askSmsCode?.()
      if (!code) throw fail(null, 'interactive-required')
      smsAttempts++
      current = await request(`${loginOrigin}/sps/login/methods/headless/sms/bind`, 'sms', new URLSearchParams({ 'sms-code': code }).toString())
      continue
    }
    if (!data && /Доверять|доверять этому|Доверенное устройство/i.test(text) && await confirmTrust?.()) {
      current = await request(`${loginOrigin}/sps/login/ur/askToTrust`, 'sms')
      continue
    }
    if (items.some(i => /captcha/i.test(i.inquire)) || /captcha/i.test(data?.inquire || '')) throw fail('captcha_required', 'interactive-required', response.status)
    throw fail(null, data ? 'interactive-required' : 'non-json-response', response.status)
  }
  throw fail(null, 'unexpected-response')
}
