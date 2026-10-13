import { useEffect, useRef, useState } from 'react'
import { addDoc, collection, doc, onSnapshot, serverTimestamp } from 'firebase/firestore'
import { getAuth } from 'firebase/auth'
import { Copy, KeyRound, Link2, ShieldCheck, UsersRound } from 'lucide-react'
import { db } from '@/lib/firebase'
import type { PersonalChild, PersonalProfile } from '@/lib/personalAccess'
import { Button } from './ui/button'
import './ParentHome.css'
import { reportUiError } from '@/lib/uiErrors'

type Member = { id: string; role: 'parent' | 'student'; displayName?: string; childIds: string[]; active: boolean; meshConnectedAt?: unknown; inviteUnlimited?: boolean; inviteQuota?: number }
type Invite = { id: string; status: string; mode: string; delegateQuota: number; issuerPersonId?: string; originFamilyId?: string; createdAt?: { toDate(): Date }; expiresAt?: { toDate(): Date }; connectedAt?: { toDate(): Date }; connectedParentName?: string; connectedFamilyId?: string }
type InviteRequest = { id: string; status: string; mode: string; delegateQuota: number; familyId: string; reason?: string }
type Grant = { id: string; personId: string; linkUrl: string; active: boolean; createdAt?: { toDate(): Date }; revokedAt?: { toDate(): Date }; sessionCount?: number }
type AccessRequest = { id: string; action: string; status: string; grantId: string; reason?: string }

function date(value?: { toDate(): Date }) {
  if (!value?.toDate) return 'дата уточняется'
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/Moscow' }).format(value.toDate())
}
function readableError(cause: unknown) {
  const detail = reportUiError(cause, 'Семья и доступ')
  if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'permission-denied') return 'Недостаточно прав. Обновите страницу или проверьте личную ссылку.'
  return detail
}
function useRecords<T>(path: string[]) {
  const [snapshot, setSnapshot] = useState<{ key: string; records: T[] | null; error: string }>({ key: '', records: null, error: '' })
  const key = path.join('/')
  useEffect(() => {
    let active = true
    let stop: (() => void) | undefined
    void getAuth().authStateReady().then(() => {
      if (!active || !getAuth().currentUser) return
      stop = onSnapshot(collection(db, key), { includeMetadataChanges: true }, (value) => {
        if (!active || value.metadata?.fromCache) return
        setSnapshot({ key, records: value.docs.map((item) => ({ id: item.id, ...item.data() }) as T), error: '' })
      }, (cause) => { if (active) setSnapshot({ key, records: null, error: readableError(cause) }) })
    }).catch((cause: unknown) => { if (active) setSnapshot({ key, records: null, error: readableError(cause) }) })
    return () => { active = false; stop?.() }
  }, [key])
  return snapshot.key === key ? { records: snapshot.records, error: snapshot.error } : { records: null, error: '' }
}

function MembersCard({ familyId, familyChildren, profile }: { familyId: string; familyChildren: PersonalChild[]; profile: PersonalProfile }) {
  const { records, error } = useRecords<Member>(['families', familyId, 'members'])
  const adults = records?.filter((item) => item.role === 'parent' && item.active) ?? []
  return <article className="parent-manage-card">
    <div className="parent-manage-head"><UsersRound size={20} aria-hidden="true" /><h3>Члены семьи</h3></div>
    <p className="parent-manage-count">{records && adults.length ? `${adults.length} взрослых · ${familyChildren.length} детей с вашим доступом` : error || 'Состав семьи уточняется'}</p>
    <ul>{adults.map((item) => <li key={item.id}>{item.displayName || (item.id === profile.personId ? profile.displayName : 'Взрослый')}{item.id === profile.personId ? ' · вы' : ''}<span>{item.meshConnectedAt ? 'МЭШ подключён' : 'МЭШ ещё не связан с профилем'}</span></li>)}</ul>
    <p>Дети: {familyChildren.map((child) => child.displayName).join(', ')}.</p>
  </article>
}

function InviteRow({ item, nowMs, busy, revokePending, copy, revoke }: { item: Invite; nowMs: number; busy: boolean; revokePending: boolean; copy: (code: string) => void; revoke: (code: string) => void }) {
  const [submitted, setSubmitted] = useState(false)
  useEffect(() => {
    if (item.status !== 'open') return
    return onSnapshot(doc(db, 'connectionInvites', item.id, 'handoff', 'current'), (snapshot) => setSubmitted(snapshot.exists()), (cause) => { reportUiError(cause, 'Статус приглашения'); setSubmitted(false) })
  }, [item.id, item.status])
  const expired = item.status === 'open' && (item.expiresAt?.toDate().getTime() ?? 0) <= nowMs
  const label = expired ? 'Истёк срок' : item.status === 'open' && submitted ? 'Заявка получена' : item.status === 'open' ? 'Открыто'
    : item.status === 'connected' ? 'Использовано' : item.status === 'revoked' ? 'Отозвано' : item.status
  return <li>
    <strong>{label}</strong>
    <span>Создано {date(item.createdAt)} · действует до {date(item.expiresAt)} · адресату {item.delegateQuota} приглашений</span>
    {item.connectedFamilyId && <span>Подключилась семья {item.connectedParentName || item.connectedFamilyId}</span>}
    {item.status === 'open' && !expired && <div className="parent-manage-actions"><Button type="button" variant="outline" size="sm" onClick={() => copy(item.id)}><Copy size={16} /> Скопировать ссылку</Button><Button type="button" variant="outline" size="sm" disabled={busy || revokePending} onClick={() => revoke(item.id)}>Отозвать</Button></div>}
  </li>
}

/** Browser requests are queued; the local operator owns the receiver key.
 * @see ../../docs/architecture/family-data-model.md#invitations
 * @see ../../docs/product/design-system.md#cards-and-status */
function InvitesCard({ familyId, personId }: { familyId: string; personId: string }) {
  const [right, setRight] = useState<Member | null>(null)
  const { records: allInvites, error: inviteError } = useRecords<Invite>(right?.inviteUnlimited ? ['families', familyId, 'invites'] : ['users', personId, 'invites'])
  const { records: requests, error: requestError } = useRecords<InviteRequest>(['users', personId, 'inviteRequests'])
  const { records: revocations } = useRecords<{ id: string; inviteCode: string; status: string }>(['users', personId, 'inviteRevocations'])
  const invites = allInvites?.filter((item) => !item.originFamilyId || item.originFamilyId === familyId)
  const ownRequests = requests?.filter((item) => item.familyId === familyId)
  const [mode, setMode] = useState<'same-family' | 'new-family'>('same-family')
  const [quota, setQuota] = useState(0)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [nowMs, setNowMs] = useState(() => Date.now())
  useEffect(() => onSnapshot(doc(db, 'families', familyId, 'members', personId), (snapshot) => setRight(snapshot.exists() ? snapshot.data() as Member : null), (cause) => setMessage(readableError(cause))), [familyId, personId])
  useEffect(() => { const timer = window.setInterval(() => setNowMs(Date.now()), 60_000); return () => window.clearInterval(timer) }, [])
  const allowed = right?.inviteUnlimited === true || Number(right?.inviteQuota) > 0
  const copy = async (code: string) => {
    try { await navigator.clipboard.writeText(`${location.origin}${import.meta.env.BASE_URL}#/connect/${code}`); setMessage('Ссылка приглашения скопирована.') }
    catch { setMessage('Не удалось скопировать ссылку. Откройте сайт в браузере с доступом к буферу обмена.') }
  }
  const requestInvite = async () => {
    setBusy(true); setMessage('')
    try {
      await addDoc(collection(db, 'users', personId, 'inviteRequests'), {
        familyId, mode, delegateQuota: quota, status: 'requested', createdAt: serverTimestamp(),
      })
      setMessage('Заявка создана. Ссылка появится здесь после обработки локальным оператором.')
    } catch (cause) { setMessage(readableError(cause)) }
    finally { setBusy(false) }
  }
  const requestRevoke = async (code: string) => {
    setBusy(true); setMessage('')
    try {
      await addDoc(collection(db, 'users', personId, 'inviteRevocations'), { inviteCode: code, status: 'requested', createdAt: serverTimestamp() })
      setMessage('Запрос на отзыв отправлен. До обработки ссылка остаётся действующей.')
    } catch (cause) { setMessage(readableError(cause)) }
    finally { setBusy(false) }
  }
  const pending = ownRequests?.some((item) => item.status === 'requested')
  return <article className="parent-manage-card">
    <div className="parent-manage-head"><ShieldCheck size={20} aria-hidden="true" /><h3>Приглашения</h3></div>
    <p className="parent-manage-count">{!right ? 'Проверяем право приглашать' : right.inviteUnlimited ? 'Можно приглашать без лимита' : `Осталось приглашений: ${right.inviteQuota ?? 0}`}</p>
    {right && allowed && <div className="parent-manage-form">
      <label>Кого приглашаете?<select value={mode} onChange={(event) => setMode(event.target.value as 'same-family' | 'new-family')}><option value="same-family">Взрослого в нашу семью</option><option value="new-family">Новую семью</option></select></label>
      <label>Сколько приглашений сможет выдать адресат?<input type="number" min={0} max={1000} value={quota} onChange={(event) => setQuota(Math.max(0, Math.min(1000, Number(event.target.value) || 0)))} /></label>
      <Button type="button" disabled={busy || pending} onClick={() => void requestInvite()}>Создать приглашение</Button>
      <small>Заявка проходит через локальный процесс. Пароль МЭШ и ключ расшифрования здесь не хранятся.</small>
    </div>}
    {right && !allowed && <p>Право создавать новые приглашения не выдано.</p>}
    {(inviteError || requestError) && <p role="alert">{inviteError || requestError}</p>}
    {ownRequests?.filter((item) => item.status === 'requested').map((item) => <p className="parent-manage-pending" key={item.id}>◷ Приглашение готовится · {item.mode === 'new-family' ? 'новая семья' : 'наша семья'} · право выдать ещё {item.delegateQuota}</p>)}
    {ownRequests?.filter((item) => item.status === 'rejected').map((item) => <p key={item.id} role="status">Запрос приглашения отклонён: {item.reason || 'право или данные заявки не подтверждены'}.</p>)}
    {right && invites?.length ? <ul>{[...invites].sort((a, b) => (b.createdAt?.toDate().getTime() ?? 0) - (a.createdAt?.toDate().getTime() ?? 0)).map((item) => <InviteRow key={item.id} item={item} nowMs={nowMs} busy={busy} revokePending={Boolean(revocations?.some((revocation) => revocation.inviteCode === item.id && revocation.status === 'requested'))} copy={(code) => { void copy(code) }} revoke={(code) => { void requestRevoke(code) }} />)}</ul> : right && allInvites && !pending && <p>Выданных приглашений пока нет.</p>}
    {message && <p role="status">{message}</p>}
  </article>
}

function ChildAccess({ familyId, child, actorPersonId }: { familyId: string; child: PersonalChild; actorPersonId: string }) {
  const path = ['families', familyId, 'children', child.childId]
  const { records: grants, error } = useRecords<Grant>([...path, 'accessGrants'])
  const { records: requests } = useRecords<AccessRequest>([...path, 'accessRequests'])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const pending = requests?.some((item) => item.status === 'requested')
  const active = grants?.filter((item) => item.active) ?? []
  const latest = [...active].sort((a, b) => (b.createdAt?.toDate().getTime() ?? 0) - (a.createdAt?.toDate().getTime() ?? 0))[0]
  const request = async (action: 'rotate' | 'revoke', grantIdValue = '') => {
    setBusy(true); setMessage('')
    try {
      await addDoc(collection(db, [...path, 'accessRequests'].join('/')), {
        action, grantId: grantIdValue, actorPersonId, status: 'requested', createdAt: serverTimestamp(),
      })
      setMessage(action === 'rotate' ? 'Запрошена новая ссылка. Старая пока работает.' : 'Запрошена блокировка. Ссылка пока работает до обработки заявки.')
    } catch (cause) { setMessage(readableError(cause)) }
    finally { setBusy(false) }
  }
  const copy = async () => {
    if (!latest) return
    try { await navigator.clipboard.writeText(latest.linkUrl); setMessage('Личная ссылка ребёнка скопирована.') }
    catch { setMessage('Не удалось скопировать ссылку в этом браузере.') }
  }
  return <div className="parent-child-access"><strong>{child.displayName}</strong>
    <span>{grants === null ? error || 'Загружаем ссылки' : active.length ? `${active.length} действующих · ${grants.length} в истории` : 'Действующей ссылки нет'}</span>
    {latest && <span>Последняя выдана {date(latest.createdAt)} · входов по техническим сессиям: {latest.sessionCount ?? 'неизвестно'}</span>}
    <div className="parent-manage-actions">{latest && <Button type="button" variant="outline" size="sm" onClick={() => void copy()}><Copy size={16} /> Скопировать ссылку</Button>}
      <Button type="button" variant="outline" size="sm" disabled={busy || pending || grants === null} onClick={() => void request('rotate')}><KeyRound size={16} /> Новая ссылка</Button>
      {latest && <Button type="button" variant="outline" size="sm" disabled={busy || pending} onClick={() => void request('revoke', latest.id)}>Заблокировать</Button>}
    </div>
    {grants && grants.length > 1 && <details><summary>История ссылок · {grants.length}</summary><ul>{[...grants].sort((a, b) => (b.createdAt?.toDate().getTime() ?? 0) - (a.createdAt?.toDate().getTime() ?? 0)).map((grant) => <li key={grant.id}>{grant.active ? 'Действует' : 'Закрыта'} · {date(grant.createdAt)} · технических сессий: {grant.sessionCount ?? 'неизвестно'}</li>)}</ul></details>}
    {pending && <span className="parent-manage-pending">◷ Заявка ожидает локальной обработки</span>}
    {requests?.filter((item) => item.status === 'rejected').map((item) => <span key={item.id} role="status">Запрос {item.action === 'rotate' ? 'новой ссылки' : 'блокировки'} отклонён: {item.reason || 'условия не подтверждены'}.</span>)}
    {message && <span role="status">{message}</span>}
  </div>
}

/** @see ../../docs/architecture/family-data-model.md#parent-home
 *  @see ../../docs/product/design-system.md#cards-and-status
 *  @see ../../docs/architecture/local-first-release-plan-2026-10-12.md */
export function FamilyAccessCards({ profile, familyChildren }: { profile: PersonalProfile; familyChildren: PersonalChild[] }) {
  const familyId = familyChildren[0]?.familyId
  const sectionRef = useRef<HTMLElement>(null)
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    if (visible || !familyId) return
    const section = sectionRef.current
    if (!section || typeof IntersectionObserver === 'undefined') { setVisible(true); return }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setVisible(true); observer.disconnect() }
    }, { rootMargin: '160px' })
    observer.observe(section)
    return () => observer.disconnect()
  }, [visible, familyId])
  if (!familyId) return null
  return <section ref={sectionRef} className="parent-family-group" aria-label={`Семья: ${familyChildren.map((child) => child.displayName).join(', ')}`}>
    <h2>Семья и доступ</h2>
    {visible ? <div className="parent-family-grid">
      <MembersCard familyId={familyId} familyChildren={familyChildren} profile={profile} />
      <InvitesCard familyId={familyId} personId={profile.personId} />
      <article className="parent-manage-card"><div className="parent-manage-head"><Link2 size={20} aria-hidden="true" /><h3>Вход детей</h3></div>
        <p>Личная ссылка открывает только профиль ребёнка. Её можно заменить без удаления работ и результатов.</p>
        {familyChildren.map((child) => <ChildAccess key={child.childId} familyId={familyId} child={child} actorPersonId={profile.personId} />)}
      </article>
    </div> : <button type="button" className="parent-manage-card parent-family-open" onClick={() => setVisible(true)}>Открыть управление семьёй</button>}
  </section>
}
