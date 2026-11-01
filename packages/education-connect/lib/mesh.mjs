/** @see ../../../docs/decisions/mesh-login-stages-2026-11-01.md */
/** @see ../../../docs/decisions/mesh-auth-recovery-2026-11-01.md */
import { authenticate } from 'mesh-diary/lib/auth.js'
import { MeshAPI } from 'mesh-diary/lib/api.js'
import { createLoginDiagnostics } from './login-diagnostics.mjs'
import { fetchMeshRead } from './network-retry.mjs'

const allowedHosts = new Set(['login.mos.ru', 'school.mos.ru', 'dnevnik.mos.ru'])

function retryObserver(telemetry) {
  if (!telemetry?.count) return undefined
  return {
    onAttempt: () => telemetry.count('mesh.http.attempts'),
    onRetry: ({ reason }) => {
      telemetry.count('mesh.http.retries')
      if (reason === 'network') telemetry.count('mesh.http.network-retries')
      else telemetry.count('mesh.http.status-retries')
    },
  }
}

function meshFetch(url, options = {}, telemetry = null, shutdownSignal = null) {
  const address = new URL(url)
  if (address.protocol !== 'https:' || !allowedHosts.has(address.hostname)) {
    throw new Error('МЭШ запросил неизвестный адрес')
  }
  const timeoutSignal = options.signal ?? AbortSignal.timeout(30_000)
  const signal = shutdownSignal ? AbortSignal.any([timeoutSignal, shutdownSignal]) : timeoutSignal
  return fetchMeshRead(address, { ...options, signal }, { observer: retryObserver(telemetry) })
}

function childLabel(profile) {
  return profile.user_name || profile.short_name || `Профиль ${profile.id}`
}

function attachmentUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'school.mos.ru' && url.pathname.startsWith('/ej/attachments/files/')
      ? url.toString() : null
  } catch { return null }
}

function attachedFiles(items, scope) {
  if (!Array.isArray(items)) return []
  return items.flatMap((item) => {
    const urls = [...(Array.isArray(item.urls) ? item.urls.map((value) => value.url) : []), item.url, item.link]
    return urls.map(attachmentUrl).filter(Boolean).map((url) => ({
      id: String(item.id ?? url.split('/')[6] ?? ''), title: item.title || item.name || decodeURIComponent(new URL(url).pathname.split('/').at(-1)),
      url, scope,
    }))
  })
}

function lessonFiles(detail) {
  const files = [
    ...attachedFiles(detail.kr_attachments, 'lesson'),
    ...attachedFiles(detail.details?.materials, 'lesson'),
    ...(detail.lesson_homeworks || []).flatMap((homework) => [
      ...attachedFiles(homework.attachments, 'homework'),
      ...attachedFiles(homework.additional_materials, 'homework'),
      ...attachedFiles(homework.materials, 'homework'),
    ]),
  ]
  return [...new Map(files.map((file) => [file.url, file])).values()]
}

export function isCalendarOnlyEvent(event, requestedDate = null) {
  if (!event || typeof event !== 'object' || !validMeshDate(requestedDate)) return false
  const { hasSubject, hasHomework, hasLessonType } = meshEventSignals(event)
  // МЭШ помещает в расписание также события без урока (например, OLYMPIAD).
  // Для них endpoint lesson_schedule_items может вернуть внутреннюю ошибку 500.
  // Если признаки ДЗ есть, событие не скрываем: подробная карточка обязательна.
  // PLAN/FACT identify lesson records. Keep malformed lesson records visible to
  // downstream validation instead of treating missing descriptive fields as proof
  // that they are calendar-only.
  const startMs = isZonedTimestamp(event.start_at) ? Date.parse(event.start_at) : NaN
  const finishMs = isZonedTimestamp(event.finish_at) ? Date.parse(event.finish_at) : NaN
  const dayStart = Date.parse(`${requestedDate}T00:00:00+03:00`)
  const dayEnd = dayStart + 24 * 60 * 60 * 1000
  const validInterval = Number.isFinite(startMs) && Number.isFinite(finishMs) && finishMs > startMs
    && Number.isFinite(dayStart) && startMs < dayEnd && finishMs > dayStart
  return event.source === 'OLYMPIAD' && validInterval && !hasSubject && !hasHomework && !hasLessonType
}
export function meshEventSignals(event) {
  return { hasSubject: Boolean(event?.subject_name || event?.subject?.name || event?.subject_id != null || event?.subject?.id != null),
    hasHomework: Boolean(event?.homework?.total_count || event?.homework?.descriptions?.length),
    hasLessonType: Boolean(event?.lesson_type || event?.course_lesson_type) }
}
function validMeshDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
}
function isZonedTimestamp(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && validMeshDate(value.slice(0, 10))
    && !Number.isNaN(Date.parse(value))
}

// Preserve source order while bounding requests to the lesson detail endpoint.
// @see ../../../docs/audits/education-sync-latency-audit-2026-10-15.md
async function mapBounded(values, limit, visit) {
  const results = new Array(values.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (next < values.length) {
      const index = next++
      results[index] = await visit(values[index])
    }
  }))
  return results
}

/** @see ../../../docs/modules/school-diary/README.md#full-grade-period */
export function normalizeSubjectPeriods(subjects, date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())) {
  if (!Array.isArray(subjects)) throw new Error('Полный журнал оценок МЭШ не является списком')
  return subjects.flatMap((subject) => {
    const period = subject.periods?.find((item) => item.start_iso <= date && date <= item.end_iso)
    if (!period) return []
    if (!Number.isInteger(period.count) || !Array.isArray(period.marks) || period.marks.length !== period.count) {
      throw new Error(`МЭШ вернул неполный список отметок: ${subject.subject_name}`)
    }
    return [{ subject_name: subject.subject_name, subject_id: subject.subject_id, period: period.title,
      start: period.start_iso, end: period.end_iso, average: period.value, count: period.count,
      ...(period.dynamic != null ? { dynamic: period.dynamic } : {}),
      ...(period.target != null ? { target: period.target } : {}),
      ...(period.fixed_value != null ? { fixed_value: period.fixed_value } : {}),
      marks: period.marks }]
  })
}

/** @see ../../../docs/modules/school-diary/README.md#diary-adapter */
export async function loginToMesh({ username, password, askSmsCode, chooseProfile, onProgress }, { telemetry = null } = {}) {
  const diagnostic = createLoginDiagnostics((url, options) => meshFetch(url, options, telemetry), onProgress)
  const fetch = diagnostic.fetch
  try {
  const auth = await authenticate({ fetch, username, password, askSmsCode, onProgress: () => {} })
  if (!auth.token || !auth.personId) throw new Error('Вход прошёл, но профиль МЭШ не найден')
  const api = new MeshAPI({ token: auth.token, profileId: '0', fetch })
  const profiles = await api.getStudentProfiles(auth.personId)
  if (!Array.isArray(profiles) || profiles.length === 0) throw new Error('Нет доступных ученических профилей')
  const index = await chooseProfile(profiles.map((profile) => ({ id: String(profile.id), name: childLabel(profile) })))
  const selected = profiles[index]
  if (!selected) throw new Error('Ученический профиль не выбран')
  return {
    token: auth.token,
    refreshToken: auth.refreshToken,
    clientId: auth.clientId,
    clientSecret: auth.clientSecret,
    actorPersonId: auth.personId,
    personId: String(selected.person_id || ''),
    profileId: String(selected.id),
    studentId: String(selected.id),
    profileName: childLabel(selected),
  }
  } catch (error) { throw diagnostic.failure(error) }
}

/** Safe authorization diagnostics: never retain SDK URL, response body or credentials.
 * @see ../../../docs/shared/server-runtime.md#авторизация-и-совместимость
 */
export function meshAuthDiagnostic(error) {
  const httpStatus = Number(error?.httpStatus ?? String(error?.message ?? '').match(/^API (401|403):/)?.[1])
  if (error?.code !== 'mesh_auth_required' && ![401, 403].includes(httpStatus)) return null
  const stage = ['oauth-refresh', 'mesh-exchange', 'mesh-activation'].includes(error?.stage) ? error.stage : 'mesh-api'
  const oauthError = ['invalid_client', 'invalid_grant', 'unauthorized_client', 'access_denied'].includes(error?.oauthError) ? error.oauthError : null
  return { code: 'mesh_auth_required', stage, httpStatus: [400, 401, 403].includes(httpStatus) ? httpStatus : null, oauthError }
}
export function meshAuthFailure(error) {
  const diagnostic = meshAuthDiagnostic(error)
  return diagnostic ? Object.assign(new Error('AUTH_REQUIRED: требуется повторный вход в МЭШ'), diagnostic) : null
}
async function rejectAuth(response, stage) {
  if (![400, 401, 403].includes(response.status)) return
  let data
  try { data = await response.clone().json() } catch { /* Never include untrusted response text. */ }
  if (![401, 403].includes(response.status) && !['invalid_client', 'invalid_grant', 'unauthorized_client', 'access_denied'].includes(data?.error)) return
  throw meshAuthFailure({ code: 'mesh_auth_required', httpStatus: response.status, stage, oauthError: data?.error })
}

async function refreshToken(secret, telemetry = null, shutdownSignal = null) {
  if (!secret.clientId || !secret.clientSecret) return null
  const authorization = `Basic ${Buffer.from(`${secret.clientId}:${secret.clientSecret}`).toString('base64')}`
  const request = async (body) => {
    const response = await meshFetch('https://login.mos.ru/sps/oauth/te', {
      method: 'POST',
      headers: { Authorization: authorization, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    }, telemetry, shutdownSignal)
    await rejectAuth(response, 'oauth-refresh')
    return response.ok ? response.json() : null
  }
  const mos = secret.refreshToken
    ? await request({ grant_type: 'refresh_token', refresh_token: secret.refreshToken })
    : await request({ grant_type: 'client_credentials', scope: 'openid profile' })
  if (!mos?.access_token) return null
  const response = await meshFetch('https://school.mos.ru/v3/auth/sudir/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_authentication_for_mobile_request: { mos_access_token: mos.access_token } }),
  }, telemetry, shutdownSignal)
  await rejectAuth(response, 'mesh-exchange')
  if (!response.ok) return null
  const data = await response.json()
  const token = data.user_authentication_for_mobile_response?.mesh_access_token
  if (!token) return null
  const activation = await meshFetch('https://dnevnik.mos.ru/acl/api/users/profile_info', {
    headers: { 'auth-token': token, 'partner-source-id': 'MOBILE', Accept: '*/*' },
  }, telemetry, shutdownSignal)
  await rejectAuth(activation, 'mesh-activation')
  if (!activation.ok) return null
  return { token, refreshToken: mos.refresh_token || secret.refreshToken }
}

/** @see ../../../docs/modules/school-diary/README.md#diary-adapter */
export class MeshDiaryAdapter {
  constructor(secret, saveSecret, { telemetry = null, signal = null } = {}) {
    this.secret = secret
    this.saveSecret = saveSecret
    this.telemetry = telemetry
    this.signal = signal
    this.scheduleCache = new Map()
    this.api = new MeshAPI({
      token: secret.token,
      studentId: secret.studentId,
      profileId: secret.profileId,
      personId: secret.personId,
      fetch: (url, options) => meshFetch(url, options, this.telemetry, this.signal),
      onUnauthorized: async () => {
        const updated = await refreshToken(this.secret, this.telemetry, this.signal)
        if (!updated) return null
        this.secret = { ...this.secret, ...updated }
        this.saveSecret(this.secret)
        return updated.token
      },
    })
  }

  async verifyAccess() {
    return observeMesh(this.telemetry, 'mesh.verify-access', async () => {
    const actorPersonId = this.secret.actorPersonId || this.secret.personId
    const profiles = await this.api.getStudentProfiles(actorPersonId)
    const selected = Array.isArray(profiles)
      ? profiles.find((profile) => String(profile.id) === String(this.secret.profileId))
      : null
    if (!selected?.person_id) throw new Error('ACCESS_NOT_VERIFIED: ученический профиль не связан с аккаунтом')

    const response = await meshFetch('https://dnevnik.mos.ru/acl/api/users/profile_info', {
      headers: { 'auth-token': this.api.token, 'partner-source-id': 'MOBILE', Accept: '*/*' },
    }, this.telemetry, this.signal)
    if (!response.ok) throw new Error('ACCESS_NOT_VERIFIED: роль аккаунта не определена')
    const roles = await response.json()
    if (!Array.isArray(roles) || !roles.some((role) => role.type === 'ParentProfile')) {
      throw new Error('ACCESS_NOT_VERIFIED: нужен родительский профиль')
    }

    const family = await this.api.getProfile()
    if (family?.profile?.type !== 'parent' || !Array.isArray(family.children) ||
      !family.children.some((child) => String(child.id) === String(selected.id))) {
      throw new Error('ACCESS_NOT_VERIFIED: ученик не найден среди детей родителя')
    }

    const { profileName: _profileName, ...rest } = this.secret
    this.secret = {
      ...rest,
      actorPersonId: String(actorPersonId),
      personId: String(selected.person_id),
      profileId: String(selected.id),
      studentId: String(selected.id),
      parentProfileId: String(family.profile.id),
      accountRole: 'parent',
      verifiedAt: new Date().toISOString(),
    }
    this.api.personId = this.secret.personId
    this.api.profileId = this.secret.profileId
    this.api.studentId = this.secret.studentId
    this.saveSecret(this.secret)
    return { accountRole: 'parent', studentLinked: true, childrenCount: family.children.length }
    })
  }

  async getProfile() { return observeMesh(this.telemetry, 'mesh.get-profile', () => this.api.getProfile()) }
  /** @see ../../../docs/modules/school-diary/school-calendar.md#источник */
  async getSchoolCalendar(from, to) {
    if (!validMeshDate(from) || !validMeshDate(to) || from > to) throw new Error('invalid_calendar_range')
    return observeMesh(this.telemetry, 'mesh.get-school-calendar', async () => {
      // Live MESH requires `from`/`to`; the pinned SDK still sends from_date/to_date.
      const url = new URL('https://school.mos.ru/api/family/mobile/v1/periods_schedules')
      url.searchParams.set('student_id', this.secret.studentId)
      url.searchParams.set('profile_id', this.secret.profileId)
      url.searchParams.set('from', from)
      url.searchParams.set('to', to)
      const data = await this.api.apiFetch(url.toString(), { headers: { 'profile-id': this.secret.parentProfileId } })
      return data?.payload ?? data
    })
  }
  async getSchedule(date) {
    return observeMesh(this.telemetry, 'mesh.get-schedule', async () => {
      const events = await this.api.getSchedule(date, date, { expand: 'marks,homework', mesRole: 'parent' })
      this.scheduleCache.set(date, events)
      return events
    })
  }
  async getMarks() {
    return observeMesh(this.telemetry, 'mesh.get-marks', async () => {
      const url = new URL('https://school.mos.ru/api/family/mobile/v1/subject_marks')
      url.searchParams.set('student_id', this.secret.studentId)
      url.searchParams.set('profile_id', this.secret.profileId)
      const data = await this.api.apiFetch(url.toString())
      return normalizeSubjectPeriods(data.payload || data)
    })
  }
  async getLessonDetails(event) {
    return observeMesh(this.telemetry, 'mesh.get-lesson-details', async () => {
      const url = new URL(`https://school.mos.ru/api/family/mobile/v1/lesson_schedule_items/${encodeURIComponent(String(event.id))}`)
      url.searchParams.set('student_id', this.secret.studentId)
      url.searchParams.set('type', event.source || 'PLAN')
      return this.api.apiFetch(url.toString(), { headers: { 'profile-id': this.secret.parentProfileId } })
    })
  }
  async getAssignments(date, previous = []) {
    return observeMesh(this.telemetry, 'mesh.get-assignments', async () => {
    const events = this.scheduleCache.get(date) || await this.getSchedule(date)
    if (!Array.isArray(events)) throw new Error('Расписание МЭШ не является списком')
    const lessons = events.filter((event) => String(event.start_at).slice(0, 10) === date)
      .filter((event) => !event.cancelled)
    const output = []
    const incompleteDetails = []
    const detailed = await mapBounded(lessons.filter((event) => !isCalendarOnlyEvent(event, date)), 3, async (event) => {
      try {
        const detail = await this.getLessonDetails(event)
        if (!detail || typeof detail !== 'object') throw new Error('Пустая подробная карточка урока')
        return { event, detail, error: null }
      }
      catch (error) {
        // Summary and earlier metadata are useful diagnostics, but cannot prove that
        // homework was removed or that an apparently empty lesson has no homework.
        return { event, detail: null, error: String(error?.message || error) }
      }
    })
    for (const { event, detail, error } of detailed) {
      if (error) incompleteDetails.push({ lessonId: String(event.id), reason: error })
      const earlier = previous.find((item) => item.sourceItemId === String(event.id))
      const teacherFiles = detail ? lessonFiles(detail) : (earlier?.teacherFiles || [])
      const homeworkEntries = detail?.lesson_homeworks?.map((homework, index) => ({
        id: String(homework.homework_id ?? homework.homework_entry_id ?? `${event.id}-${index}`),
        description: homework.homework || '',
        updatedAt: homework.homework_updated_at || null,
      })) || earlier?.homeworkEntries || []
      if (!(event.homework?.total_count || 0) && !(event.homework?.descriptions?.length || 0)
        && !homeworkEntries.length && !teacherFiles.length) continue
      output.push({
        source: 'mesh-eventcalendar',
        sourceItemId: String(event.id),
        lessonDate: date,
        subjectId: event.subject_id ?? null,
        subjectName: event.subject_name ?? null,
        descriptions: event.homework?.descriptions || [],
        materialCounts: event.homework?.materials || null,
        homeworkEntries, teacherFiles,
        detailStatus: detail ? 'loaded' : earlier?.detailStatus === 'loaded' ? 'stale' : 'unavailable',
      })
    }
    if (incompleteDetails.length) {
      const failure = new Error(`Не загружены подробные карточки ${incompleteDetails.length} уроков МЭШ.`)
      failure.code = 'INCOMPLETE_DETAIL'
      failure.partialResult = output
      failure.incompleteDetails = incompleteDetails
      throw failure
    }
    return output
    })
  }
}

function observeMesh(telemetry, operation, work) {
  return telemetry?.span ? telemetry.span(operation, work, { source: 'mesh' }) : work()
}

export async function probeMesh() {
  const response = await meshFetch('https://school.mos.ru/', { method: 'HEAD' })
  return response.status
}
