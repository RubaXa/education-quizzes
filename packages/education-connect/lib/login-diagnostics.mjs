/** @see ../../../docs/decisions/mesh-login-stages-2026-11-01.md */
/** Safe local login stages; provider bodies and submitted credentials are never logged.
 * @see ../../../docs/shared/server-runtime.md#авторизация-и-совместимость
 */
const labels = {
  registration: 'регистрация приложения',
  'oauth-init': 'подготовка входа mos.ru',
  password: 'вход mos.ru',
  sms: 'подтверждение SMS',
  'token-exchange': 'обмен кода на токен',
  'mesh-exchange': 'получение доступа МЭШ',
  profile: 'проверка профиля',
}
const providerCodes = new Set(['invalid_client', 'invalid_grant', 'invalid_request', 'invalid_token',
  'access_denied', 'unauthorized_client', 'unsupported_grant_type', 'invalid_credentials',
  'INVALID_CREDENTIALS', 'INVALID_PASSWORD', 'WRONG_PASSWORD', 'INVALID_SMS_CODE'])
const networkCodes = new Set(['ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT'])
export function loginFailure({stage, httpStatus, providerCode, networkCode, reason = 'provider-rejected'} = {}) {
  return Object.assign(new Error('Вход МЭШ не завершён'), {
    code: 'mesh_login_failed', stage: Object.hasOwn(labels, stage) ? stage : 'profile',
    httpStatus: Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599 ? httpStatus : null,
    providerCode: providerCodes.has(providerCode) ? providerCode : null,
    networkCode: networkCodes.has(networkCode) ? networkCode : null,
    reason: ['provider-rejected', 'network', 'non-json-response', 'incomplete-registration', 'unexpected-response'].includes(reason) ? reason : 'unexpected-response',
  })
}
export function formatLoginFailure(error) {
  if (error?.code !== 'mesh_login_failed') return null
  const safe = loginFailure(error)
  return `Не завершён этап «${labels[safe.stage]}»; ${[
    safe.httpStatus ? `HTTP ${safe.httpStatus}` : null, safe.providerCode, safe.networkCode, safe.reason,
  ].filter(Boolean).join(' · ')}. Пароль, SMS и тело ответа не выводятся.`
}
function stageFor(url) {
  const path = new URL(url).pathname
  if (path.endsWith('/oauth/register')) return 'registration'
  if (path.endsWith('/oauth/ae')) return 'oauth-init'
  if (path.includes('/headless/password')) return 'password'
  if (path.includes('/sms/') || path.includes('/askToTrust')) return 'sms'
  if (path.endsWith('/oauth/te')) return 'token-exchange'
  if (path.endsWith('/sudir/auth')) return 'mesh-exchange'
  return 'profile'
}
export function createLoginDiagnostics(fetcher, onProgress = () => {}) {
  let stage = 'registration'
  return {
    async fetch(url, options) {
      const next = stageFor(url)
      if (stage !== next || next === 'registration') onProgress(`Этап: ${labels[next]}…`)
      stage = next
      let response
      try { response = await fetcher(url, options) }
      catch (error) { throw loginFailure({stage, reason:'network', networkCode:error?.cause?.code ?? error?.code}) }
      // Redirects are part of the SMS/trust flow. Never print Location or OAuth query parameters.
      if (response.status >= 300 && response.status < 400 && ['sms','password'].includes(stage)) return response
      let payload
      if (response.headers.get('content-type')?.includes('json')) {
        try { payload = await response.clone().json() } catch { /* Report the stage, not the raw parser error. */ }
      }
      const providerCode = payload?.error ?? payload?.errors?.[0]?.code
      if (!response.ok || payload?.error || payload?.errors?.length) {
        throw loginFailure({stage,httpStatus:response.status,providerCode})
      }
      if (['registration','oauth-init'].includes(stage) && (!payload || typeof payload !== 'object')) {
        throw loginFailure({stage,httpStatus:response.status,reason:'non-json-response'})
      }
      if (stage === 'registration' && (!payload.client_id || !payload.client_secret)) {
        throw loginFailure({stage,httpStatus:response.status,reason:'incomplete-registration'})
      }
      return response
    },
    failure(error) {
      if (error?.code === 'mesh_login_failed' || error?.message === 'Вход прерван') return error
      return loginFailure({stage,reason:'unexpected-response'})
    },
  }
}
