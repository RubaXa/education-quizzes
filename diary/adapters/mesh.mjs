import { authenticate } from 'mesh-diary/lib/auth.js'
import { MeshAPI } from 'mesh-diary/lib/api.js'

const allowedHosts = new Set(['login.mos.ru', 'school.mos.ru', 'dnevnik.mos.ru'])

function meshFetch(url, options = {}) {
  const address = new URL(url)
  if (address.protocol !== 'https:' || !allowedHosts.has(address.hostname)) {
    throw new Error('МЭШ запросил неизвестный адрес')
  }
  return fetch(address, { ...options, redirect: 'manual', signal: options.signal ?? AbortSignal.timeout(30000) })
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

/** @see ../../docs/architecture/school-diary-port-adapter.md#diary-adapter */
export async function loginToMesh({ username, password, askSmsCode, chooseProfile }) {
  const auth = await authenticate({ fetch: meshFetch, username, password, askSmsCode, onProgress: () => {} })
  if (!auth.token || !auth.personId) throw new Error('Вход прошёл, но профиль МЭШ не найден')
  const api = new MeshAPI({ token: auth.token, profileId: '0', fetch: meshFetch })
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
}

async function refreshToken(secret) {
  if (!secret.clientId || !secret.clientSecret) return null
  const authorization = `Basic ${Buffer.from(`${secret.clientId}:${secret.clientSecret}`).toString('base64')}`
  const request = async (body) => {
    const response = await meshFetch('https://login.mos.ru/sps/oauth/te', {
      method: 'POST',
      headers: { Authorization: authorization, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    })
    return response.ok ? response.json() : null
  }
  let mos = await request({ grant_type: 'client_credentials', scope: 'openid profile' })
  if (!mos?.access_token && secret.refreshToken) {
    mos = await request({ grant_type: 'refresh_token', refresh_token: secret.refreshToken })
  }
  if (!mos?.access_token) return null
  const response = await meshFetch('https://school.mos.ru/v3/auth/sudir/auth', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_authentication_for_mobile_request: { mos_access_token: mos.access_token } }),
  })
  if (!response.ok) return null
  const data = await response.json()
  const token = data.user_authentication_for_mobile_response?.mesh_access_token
  if (!token) return null
  const activation = await meshFetch('https://dnevnik.mos.ru/acl/api/users/profile_info', {
    headers: { 'auth-token': token, 'partner-source-id': 'MOBILE', Accept: '*/*' },
  })
  if (!activation.ok) return null
  return { token, refreshToken: mos.refresh_token || secret.refreshToken }
}

/** @see ../../docs/architecture/school-diary-port-adapter.md#diary-adapter */
export class MeshDiaryAdapter {
  constructor(secret, saveSecret) {
    this.secret = secret
    this.saveSecret = saveSecret
    this.scheduleCache = new Map()
    this.api = new MeshAPI({
      token: secret.token,
      studentId: secret.studentId,
      profileId: secret.profileId,
      personId: secret.personId,
      fetch: meshFetch,
      onUnauthorized: async () => {
        const updated = await refreshToken(this.secret)
        if (!updated) return null
        this.secret = { ...this.secret, ...updated }
        this.saveSecret(this.secret)
        return updated.token
      },
    })
  }

  async verifyAccess() {
    const actorPersonId = this.secret.actorPersonId || this.secret.personId
    const profiles = await this.api.getStudentProfiles(actorPersonId)
    const selected = Array.isArray(profiles)
      ? profiles.find((profile) => String(profile.id) === String(this.secret.profileId))
      : null
    if (!selected?.person_id) throw new Error('ACCESS_NOT_VERIFIED: ученический профиль не связан с аккаунтом')

    const response = await meshFetch('https://dnevnik.mos.ru/acl/api/users/profile_info', {
      headers: { 'auth-token': this.api.token, 'partner-source-id': 'MOBILE', Accept: '*/*' },
    })
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
  }

  async getProfile() { return this.api.getProfile() }
  async getSchedule(date) {
    const events = await this.api.getSchedule(date, date, { expand: 'marks,homework', mesRole: 'parent' })
    this.scheduleCache.set(date, events)
    return events
  }
  async getMarks() { return this.api.getSubjectMarks() }
  async getLessonDetails(event) {
    const url = new URL(`https://school.mos.ru/api/family/mobile/v1/lesson_schedule_items/${encodeURIComponent(String(event.id))}`)
    url.searchParams.set('student_id', this.secret.studentId)
    url.searchParams.set('type', event.source || 'PLAN')
    return this.api.apiFetch(url.toString(), { headers: { 'profile-id': this.secret.parentProfileId } })
  }
  async getAssignments(date, previous = []) {
    const events = this.scheduleCache.get(date) || await this.getSchedule(date)
    if (!Array.isArray(events)) throw new Error('Расписание МЭШ не является списком')
    const lessons = events.filter((event) => String(event.start_at).slice(0, 10) === date)
      .filter((event) => !event.cancelled)
    const output = []
    for (const event of lessons) {
      let detail = null
      try { detail = await this.getLessonDetails(event) } catch { /* Keep summary and earlier file metadata. */ }
      const earlier = previous.find((item) => item.sourceItemId === String(event.id))
      const teacherFiles = detail ? lessonFiles(detail) : (earlier?.teacherFiles || [])
      const homeworkEntries = detail?.lesson_homeworks?.map((homework, index) => ({
        id: String(homework.homework_id ?? homework.homework_entry_id ?? `${event.id}-${index}`),
        description: homework.homework || '',
        updatedAt: homework.homework_updated_at || null,
      })) || earlier?.homeworkEntries || []
      if (!(event.homework?.total_count || 0) && !(event.homework?.descriptions?.length || 0) && !teacherFiles.length) continue
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
    return output
  }
}

export async function probeMesh() {
  const response = await meshFetch('https://school.mos.ru/', { method: 'HEAD' })
  return response.status
}
