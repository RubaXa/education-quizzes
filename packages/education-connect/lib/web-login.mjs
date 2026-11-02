/** Cookie-preserving HTTP login for the existing official diary web client.
 * @see ../../../docs/decisions/mesh-web-login-2026-11-02.md */
import { createHash, randomBytes } from 'node:crypto'
import { CookieJar } from 'tough-cookie'
import parse5 from 'parse5'
import { loginFailure } from './login-diagnostics.mjs'
import { maskSecret } from './http-trace.mjs'

const loginOrigin = 'https://login.mos.ru'
const callback = 'https://school.mos.ru/v3/auth/sudir/callback'
const hosts = new Set(['login.mos.ru', 'school.mos.ru', 'dnevnik.mos.ru'])
const trustPath = '/sps/login/ur/askToTrust'
const labels = { 'oauth-init': 'подготовка веб-входа mos.ru', password: 'проверка логина и пароля mos.ru', sms: 'подтверждение SMS', trust: 'подтверждение доверия mos.ru', 'mesh-exchange': 'завершение веб-входа МЭШ' }

export function validPendingLogin(value, now = Date.now()) {
  return value?.schemaVersion === 1 && Number.isFinite(value.createdAt) && value.createdAt <= now
    && now - value.createdAt < 10 * 60 * 1000 && value.url === `${loginOrigin}${trustPath}`
    && typeof value.state === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value.state)
    && typeof value.html === 'string' && value.html.length <= 512 * 1024 && validWebSession(value.session)
}

export function trustPageDiagnostic(html, address) {
  const nodes = []
  const walk = node => { nodes.push(node); (node.childNodes || []).forEach(walk) }
  walk(parse5.parse(html))
  const attrs = node => Object.fromEntries((node.attrs || []).map(a => [a.name, a.value]))
  const safeName = value => /^[A-Za-z_][A-Za-z0-9_.:-]{0,63}$/.test(value || '') ? value : maskSecret(value)
  return nodes.filter(n => n.tagName === 'form' || ['input', 'button', 'select'].includes(n.tagName)).slice(0,50).map(node => {
    const a = attrs(node)
    if (node.tagName === 'form') {
      let action
      try { const u = new URL(a.action || address, address); action = { origin: u.origin, path: u.pathname, queryKeys: [...u.searchParams.keys()] } } catch { action = '[invalid]' }
      return { tag: 'form', method: a.method || 'get', action }
    }
    return { tag: node.tagName, type: a.type || '', name: safeName(a.name || ''), value: maskSecret(a.value || '') }
  })
}

// Parse data from the provider's form, never execute embedded scripts or guess fields.
export function trustForm(text, address) {
  const nodes = []
  const walk = node => { nodes.push(node); (node.childNodes || []).forEach(walk) }
  walk(parse5.parse(text))
  const attrs = node => Object.fromEntries((node.attrs || []).map(a => [a.name, a.value]))
  const textOf = node => node.nodeName === '#text' ? node.value : (node.childNodes || []).map(textOf).join('')
  const results = []
  for (const form of nodes.filter(n => n.tagName === 'form')) {
    const a = attrs(form), url = new URL(a.action || address, address)
    if (url.origin !== loginOrigin || url.pathname !== trustPath || url.search || url.hash || url.username || url.password) continue
    const method = (a.method || 'get').toUpperCase()
    if (!['GET', 'POST'].includes(method)) continue
    const controls = []
    const collect = node => { if (node !== form && node.tagName === 'form') return; controls.push(node); (node.childNodes || []).forEach(collect) }
    collect(form)
    // Official askToTrust.js sets #action=trust and submits #decision on #agree.
    // Match that exact known DOM contract; never evaluate the supplied JavaScript.
    const actionInputs = controls.filter(n => n.tagName === 'input' && attrs(n).id === 'action' && attrs(n).name === 'action' && attrs(n).type === 'hidden')
    const scriptedDecision = a.id === 'decision' && method === 'POST' && actionInputs.length === 1
      && controls.some(n => n.tagName === 'button' && attrs(n).id === 'disagree' && attrs(n).type === 'button' && textOf(n).trim() === 'Не доверять')
    const buttons = controls.filter(n => n.tagName === 'button' && (!attrs(n).type || attrs(n).type === 'submit' || scriptedDecision && attrs(n).id === 'agree' && attrs(n).type === 'button') || n.tagName === 'input' && attrs(n).type === 'submit')
      .filter(n => !Object.hasOwn(attrs(n), 'disabled') && /^(?:да|доверять|доверять этому устройству|запомнить устройство)$/i.test((n.tagName === 'input' ? attrs(n).value : textOf(n)).trim()))
    if (buttons.length !== 1) continue
    const fields = controls.filter(n => n.tagName === 'input' && attrs(n).type === 'hidden' && attrs(n).name && !Object.hasOwn(attrs(n), 'disabled'))
      .map(n => [attrs(n).name, attrs(n).value || ''])
    if (scriptedDecision && attrs(buttons[0]).id === 'agree') {
      if (fields.filter(([name]) => name === 'action').length !== 1) continue
      fields.find(([name]) => name === 'action')[1] = 'trust'
    }
    const submit = attrs(buttons[0])
    if (submit.formaction || submit.formmethod) continue
    if (submit.name) fields.push([submit.name, submit.value || ''])
    if (fields.length > 50 || fields.some(([name, value]) => /^(?:login|password|sms-code)$/i.test(name) || name.length > 256 || value.length > 8192)) continue
    results.push({ url: url.toString(), method, body: new URLSearchParams(fields).toString() })
  }
  return results.length === 1 ? results[0] : null
}

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
  onProgress = () => {}, onTrustPage, resume = null, session = null, interactive = true, state = randomBytes(24).toString('base64url') }) {
  if (resume) {
    if (!interactive || !validPendingLogin(resume)) throw loginFailure({ stage: 'trust', reason: 'interactive-required' })
    session = resume.session
    state = resume.state
  }
  if (session && !validWebSession(session)) throw loginFailure({ stage: 'oauth-init', reason: 'unexpected-response' })
  const jar = session ? CookieJar.deserializeSync(session) : new CookieJar(undefined, { prefixSecurity: 'strict' })
  let requests = 0, stage = 'oauth-init', passwordSent = false, smsSent = false, smsAttempts = 0, callbackSeen = false, issuedToken = null, trustSubmitted = false
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
    if (body != null && (url.origin !== loginOrigin || !['/sps/login/methods/headless/password', '/sps/login/methods/headless/sms/bind', trustPath].includes(url.pathname))) throw fail(null, 'unexpected-redirect')
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
  let current = await request(resume ? resume.url : initial, resume ? 'trust' : 'oauth-init')
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
      current = await request(next, callbackSeen ? 'mesh-exchange' : next.pathname === trustPath ? 'trust' : 'oauth-init')
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
    if (!data && url.origin === loginOrigin && url.pathname === trustPath) {
      stage = 'trust'
      if (onTrustPage) await onTrustPage({ schemaVersion: 1, createdAt: resume?.createdAt ?? Date.now(),
        state, url: url.toString(), session: jar.serializeSync(), html: text })
      if (trustSubmitted) throw fail(null, 'unexpected-response', response.status)
      const form = trustForm(text, url.toString())
      if (!form) {
        onProgress(JSON.stringify({ kind: 'trust-page-structure', controls: trustPageDiagnostic(text, url.toString()) }))
        throw fail(null, 'interactive-required', response.status)
      }
      if (!await confirmTrust?.()) throw fail(null, 'interactive-required', response.status)
      trustSubmitted = true
      const next = new URL(form.url)
      if (form.method === 'GET') next.search = form.body
      current = await request(next, 'trust', form.method === 'POST' ? form.body : undefined)
      continue
    }
    if (items.some(i => /captcha/i.test(i.inquire)) || /captcha/i.test(data?.inquire || '')) throw fail('captcha_required', 'interactive-required', response.status)
    throw fail(null, data ? 'interactive-required' : 'non-json-response', response.status)
  }
  throw fail(null, 'unexpected-response')
}
