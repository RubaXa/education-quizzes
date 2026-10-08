import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { writeJson } from '../diary/local-store.mjs'
import { lessonVisibility } from '../diary/application/lesson-visibility.mjs'

const subjectNames = [
  [/^Иностранный \(английский\)/, ['english', 'Английский язык', '🇬🇧']],
  [/^Математика$/, ['math', 'Математика', '∑']],
  [/^Русский язык$/, ['russian', 'Русский язык', '✍']],
  [/^Литература$/, ['literature', 'Литература', '📚']],
  [/Специальный курс по математике/, ['special', 'Спецкурс по математике', '♟']],
  [/^История$/, ['history', 'История', '🏛']],
  [/^Биология$/, ['biology', 'Биология', '🌿']],
]

function json(file) { return JSON.parse(readFileSync(file, 'utf8')) }
function subjectInfo(assignment) {
  const found = subjectNames.find(([pattern]) => pattern.test(assignment.subjectName || ''))?.[1]
  return found || [`subject-${assignment.subjectId ?? 'other'}`, assignment.subjectName || 'Предмет', '📘']
}
function taskKind(description) {
  if (/запис|письм|реши|выполн|тетрад|напис|упр\.|определить и записать/i.test(description)) return 'written'
  if (/чита|устно|выуч|повтор/i.test(description)) return 'read'
  return 'check'
}
function nextDate(local, date) {
  const dates = readdirSync(resolve(local, 'diary')).map((name) => /^snapshot-(\d{4}-\d{2}-\d{2})\.json$/.exec(name)?.[1]).filter((value) => value && value > date).sort()
  for (const candidate of dates) {
    const snapshot = json(resolve(local, 'diary', `snapshot-${candidate}.json`))
    if (snapshot.complete && lessonVisibility(snapshot.schedule)?.conducted?.some((lesson) => !lesson.cancelled)) return candidate
  }
  throw new Error('Сначала загрузите МЭШ на ближайший учебный день.')
}
function previousDate(local, date) {
  return readdirSync(local).map((name) => /^day-source-(\d{4}-\d{2}-\d{2})\.json$/.exec(name)?.[1]).filter((value) => value && value < date).sort().at(-1)
}

/** @see ../docs/product/day-page.md#day-page */
export function buildDaySource(local, date) {
  const targetDate = nextDate(local, date)
  const today = json(resolve(local, 'diary', `snapshot-${date}.json`))
  const target = json(resolve(local, 'diary', `snapshot-${targetDate}.json`))
  if (!today.complete || !target.complete) throw new Error('Для обеих дат нужны полные снимки МЭШ.')
  const file = resolve(local, `day-source-${date}.json`)
  const current = existsSync(file) ? json(file) : null
  const earlierDate = current ? null : previousDate(local, date)
  const earlier = earlierDate ? json(resolve(local, `day-source-${earlierDate}.json`)) : null
  const links = existsSync(resolve(local, 'day-links.json')) ? json(resolve(local, 'day-links.json')) : {}
  const subjects = current ? structuredClone(current.subjects) : (earlier?.subjects || []).map((subject) => ({
    ...subject,
    tasks: subject.tasks.filter((task) => (task.originDate || earlier.targetDate) === targetDate)
      .map((task) => ({ ...task, originDate: task.originDate || earlier.targetDate })),
  })).filter((subject) => subject.tasks.length)
  const placements = (current?.testPlacements || (earlier?.testPlacements || []).filter((placement) => (placement.originDate || earlier.targetDate) === targetDate && subjects.some((subject) => subject.id === placement.subjectId)))
    .map((placement) => ({ ...placement, originDate: placement.originDate || (current ? targetDate : earlier.targetDate) }))
  const retainedTaskIds = new Set(subjects.flatMap((subject) => subject.tasks.map((task) => task.id)))
  const materialLinks = { ...(current?.materialLinks || Object.fromEntries(Object.entries(earlier?.materialLinks || {}).filter(([taskId]) => retainedTaskIds.has(taskId)))) }
  let added = 0
  for (const assignment of lessonVisibility(target.assignments || []).conducted) {
    const [id, name, icon] = subjectInfo(assignment)
    const descriptions = assignment.homeworkEntries?.length
      ? assignment.homeworkEntries
      : (assignment.descriptions || []).map((description, index) => ({ id: `${assignment.sourceItemId}-${index}`, description }))
    if (!descriptions.length) continue
    let subject = subjects.find((item) => item.id === id)
    if (!subject) {
      subject = { id, name, icon, materials: 'Материалы задания уточняются', mesh: '', summary: 'Назначено в МЭШ; выполняй по шагам.', tasks: [] }
      subjects.push(subject)
    }
    subject.mesh = descriptions.map((item) => item.description).join('; ')
    if (assignment.teacherFiles?.length) subject.materials = assignment.teacherFiles.map((item) => item.title).join('; ')
    for (const entry of descriptions) {
      const taskId = `mesh-${entry.id}`
      const old = subject.tasks.find((task) => task.id === taskId)
      const description = entry.description.trim()
      if (old) {
        if (old.meshText !== description) {
          if (old.source?.startsWith('МЭШ,')) {
            old.title = description.length > 105 ? `${description.slice(0, 102)}…` : description
            old.detail = old.kind === 'written' ? `${description} Выполни в тетради и сфотографируй запись.` : description
            if (old.kind === 'written' && !old.submission) old.submission = { lead: 'Выполни письменное задание по записи МЭШ выше.', photo: 'Страница тетради с номером задания и полным ответом.', buttonLabel: 'Сфотографировать ответ' }
          }
          old.materialStatus = { state: 'textbook-page-needed', message: 'Учитель изменил условие. Страницы и действия нужно сверить заново перед публикацией.' }
        }
        old.meshText = description
        if (assignment.teacherFiles?.length) materialLinks[taskId] = assignment.teacherFiles.map((item) => ({ title: item.title, url: item.url, sourceType: 'teacher-attachment' }))
        continue
      }
      const kind = taskKind(description)
      subject.tasks.push({
        id: taskId, title: description.length > 105 ? `${description.slice(0, 102)}…` : description,
        detail: kind === 'written' ? `${description} Выполни в тетради и сфотографируй запись.` : description,
        status: 'unknown', kind,
        ...(kind === 'written' ? { submission: { lead: 'Выполни письменное задание по записи МЭШ выше.', photo: 'Страница тетради с номером задания и полным ответом.', buttonLabel: 'Сфотографировать ответ' } } : {}),
        source: `МЭШ, подробная карточка урока ${targetDate}; запись ${entry.id}.`,
        meshText: description, originDate: targetDate,
        ...(!assignment.teacherFiles?.length ? { materialStatus: { state: 'textbook-page-needed', message: 'Страницу учебника к этому заданию ещё не сверили. Пока ориентируйся на точную запись МЭШ.' } } : {}),
      })
      added += 1
      if (assignment.teacherFiles?.length) materialLinks[taskId] = assignment.teacherFiles.map((item) => ({ title: item.title, url: item.url, sourceType: 'teacher-attachment' }))
    }
  }
  const assigned = (target.assignments || []).filter((item) => (item.homeworkEntries?.length || item.descriptions?.length) > 0).length
  const assignmentWord = assigned % 10 === 1 && assigned % 100 !== 11 ? 'назначение'
    : assigned % 10 >= 2 && assigned % 10 <= 4 && (assigned % 100 < 12 || assigned % 100 > 14) ? 'назначения' : 'назначений'
  const notices = [`МЭШ на ${targetDate}: сейчас ${assigned} ${assignmentWord} ДЗ. Учителя могут добавить задания позже; повторный запуск сохранит эту работу.`]
  notices.push(...(current?.manualNotices || []))
  const parentNotes = [
    `Снимок МЭШ на ${targetDate}: ${assigned} ${assignmentWord}; обновлён ${new Date(target.fetchedAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}. Отсутствие другого ДЗ сейчас не означает, что его не появится позже.`,
    'Повторный выпуск сохраняет прежние действия, фотографии и ответы тестов. Новый материал учителя добавляется по устойчивому ID.',
  ]
  parentNotes.push(...(current?.manualParentNotes || []))
  const evidenceDayTokens = [...new Set([...(current?.evidenceDayTokens || earlier?.evidenceDayTokens || []), ...(earlierDate && links[earlierDate] ? [links[earlierDate].student] : [])])]
  const source = { ...current, targetDate, notices, parentNotes, subjects, testPlacements: placements, materialLinks, evidenceDayTokens }
  writeJson(local, `day-source-${date}.json`, source)
  return { date, targetDate, assigned, subjects: subjects.length, tasks: subjects.reduce((sum, subject) => sum + subject.tasks.length, 0), added }
}
