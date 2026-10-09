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
function teacherLinks(local, date, files) {
  const archiveFile = resolve(local, 'diary', 'files', date, 'yandex-links.json')
  const archive = existsSync(archiveFile) ? json(archiveFile) : {}
  return files.flatMap((item) => {
    const archived = archive[item.id]
    if (archived?.pages?.length) return archived.pages.map((page) => ({
      title: archived.displayTitle || item.title,
      url: page.publicUrl,
      sourceType: 'teacher-attachment',
      sourceRef: `mesh-attachment:${item.id}#${page.number}`,
      sourceSha256: page.sha256,
    }))
    return [{
      title: archived?.displayTitle || item.title,
      url: archived?.publicUrl || item.url,
      sourceType: 'teacher-attachment',
      ...(archived?.publicUrl ? { sourceRef: `mesh-attachment:${item.id}`, sourceSha256: archived.sha256 } : {}),
    }]
  })
}
function subjectInfo(assignment) {
  const found = subjectNames.find(([pattern]) => pattern.test(assignment.subjectName || ''))?.[1]
  return found || [`subject-${assignment.subjectId ?? 'other'}`, assignment.subjectName || 'Предмет', '📘']
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

/** @see ../docs/product/plan-generation.md#raw-mesh-stage */
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
  const dueOnWednesday = (assignment) => subjectInfo(assignment)[0] === 'special' && (assignment.homeworkEntries || []).some((item) => /сдать[^.]*в среду/i.test(item.description || ''))
  const assignments = lessonVisibility(target.assignments || []).conducted
    .filter((assignment) => !(new Date(`${targetDate}T12:00:00Z`).getUTCDay() === 4 && dueOnWednesday(assignment)))
    .map((assignment) => ({ assignment, lessonDate: targetDate }))
  if (new Date(`${targetDate}T12:00:00Z`).getUTCDay() === 3) {
    const following = new Date(`${targetDate}T12:00:00Z`)
    following.setUTCDate(following.getUTCDate() + 1)
    const followingDate = following.toISOString().slice(0, 10)
    const followingFile = resolve(local, 'diary', `snapshot-${followingDate}.json`)
    if (existsSync(followingFile)) {
      const nextSnapshot = json(followingFile)
      if (nextSnapshot.complete) assignments.push(...lessonVisibility(nextSnapshot.assignments || []).conducted.filter(dueOnWednesday).map((assignment) => ({ assignment, lessonDate: followingDate })))
    }
  }
  for (const { assignment, lessonDate } of assignments) {
    const [id, name, icon] = subjectInfo(assignment)
    const descriptions = assignment.homeworkEntries?.length
      ? assignment.homeworkEntries
      : (assignment.descriptions || []).map((description, index) => ({ id: `${assignment.sourceItemId}-${index}`, description }))
    if (!descriptions.length) continue
    let subject = subjects.find((item) => item.id === id)
    if (!subject) {
      subject = { id, name, icon, materials: 'Материалы задания уточняются', mesh: '', summary: 'Точная запись МЭШ. Подробный разбор готовится.', tasks: [] }
      subjects.push(subject)
    }
    subject.mesh = descriptions.map((item) => item.description).join('; ')
    if (assignment.teacherFiles?.length) subject.materials = [...new Set(teacherLinks(local, lessonDate, assignment.teacherFiles).map((item) => item.title))].join('; ')
    for (const entry of descriptions) {
      const taskId = `mesh-${entry.id}`
      const old = subject.tasks.find((task) => task.id === taskId)
      const description = entry.description.trim()
      if (old) {
        if (old.meshText !== description) {
          // A changed teacher instruction invalidates the previous agent interpretation.
          // Keep uploads separately, but show only the new raw MESH text until review.
          old.title = description.length > 105 ? `${description.slice(0, 102)}…` : description
          old.detail = description
          old.kind = 'check'
          old.status = 'unknown'
          old.steps = []
          old.submission = null
          old.instructionStatus = { state: 'needs-review', message: 'Учитель изменил условие. Сейчас показан точный текст МЭШ; прежний разбор не действует.' }
          subject.summary = 'Условие МЭШ изменилось. Подробный разбор готовится.'
          if (!assignment.teacherFiles?.length) subject.materials = 'Материалы изменённого задания уточняются'
          old.materialStatus = { state: 'textbook-page-needed', message: 'Учитель изменил условие. Страницы и действия нужно сверить заново перед публикацией.' }
        }
        old.meshText = description
        if (assignment.teacherFiles?.length) materialLinks[taskId] = teacherLinks(local, lessonDate, assignment.teacherFiles)
        continue
      }
      subject.tasks.push({
        id: taskId, title: description.length > 105 ? `${description.slice(0, 102)}…` : description,
        detail: description,
        status: 'unknown', kind: 'check',
        instructionStatus: { state: 'needs-review', message: 'Пока известна только запись МЭШ. Подробные шаги и способ сдачи ещё не сверены.' },
        source: `МЭШ, подробная карточка урока ${lessonDate}; запись ${entry.id}.`,
        meshText: description, originDate: targetDate,
        ...(!assignment.teacherFiles?.length ? { materialStatus: { state: 'textbook-page-needed', message: 'Страницу учебника к этому заданию ещё не сверили. Пока ориентируйся на точную запись МЭШ.' } } : {}),
      })
      subject.summary = 'Новое задание МЭШ. Подробный разбор готовится.'
      if (!assignment.teacherFiles?.length) subject.materials = 'Материалы нового задания уточняются'
      added += 1
      if (assignment.teacherFiles?.length) materialLinks[taskId] = teacherLinks(local, lessonDate, assignment.teacherFiles)
    }
  }
  const assigned = assignments.filter(({ assignment }) => (assignment.homeworkEntries?.length || assignment.descriptions?.length) > 0).length
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
