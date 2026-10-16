/** @see ../docs/modules/materials/material-clarification.md */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { writeJson } from '../diary/local-store.mjs'
import { lessonVisibility } from '../diary/application/lesson-visibility.mjs'
import { isExplicitCdzTask, rawMeshKind } from './homework-kind.mjs'
import { subjectPresentation } from './subject-identity.mjs'
import { referencedHomeworkDate } from './homework-reference.mjs'
import { teacherFilesForEntry } from './assignment-structure.mjs'
export { rawMeshKind } from './homework-kind.mjs'

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
  return subjectPresentation(assignment.subjectName, assignment.subjectId)
}
/** Keep the lesson owner and the submission deadline separate. @see ../docs/modules/school-diary/dashboard.md#lesson-and-deadline */
function deadlineFromMesh(assignment, lessonDate) {
  const weekday = { понедельник: 1, вторник: 2, среду: 3, четверг: 4, пятницу: 5, субботу: 6, воскресенье: 0 }
  for (const entry of assignment.homeworkEntries || []) {
    const excerpt = /сдать[^.]{0,100}?\sв\s+(понедельник|вторник|среду|четверг|пятницу|субботу|воскресенье)/i.exec(entry.description || '')
    if (!excerpt) continue
    const day = new Date(`${lessonDate}T12:00:00Z`)
    const distance = (day.getUTCDay() - weekday[excerpt[1].toLowerCase()] + 7) % 7
    day.setUTCDate(day.getUTCDate() - distance)
    return { dueDate: day.toISOString().slice(0, 10), dueDateEvidence: { kind: 'mesh', excerpt: excerpt[0] } }
  }
  return { dueDate: lessonDate }
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

/** @see ../docs/modules/synchronization/plan-generation.md#raw-mesh-stage */
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
  const materialLinkReplacements = new Set(current?.materialLinkReplacements ?? [])
  const sourceOnlyEntries = [...(current?.sourceOnlyEntries || [])]
  let added = 0
  const assignments = lessonVisibility(target.assignments || []).conducted
    .map((assignment) => ({ assignment, lessonDate: targetDate }))
  for (const { assignment, lessonDate } of assignments) {
    let [id, name, icon] = subjectInfo(assignment)
    const descriptions = assignment.homeworkEntries?.length
      ? assignment.homeworkEntries
      : (assignment.descriptions || []).map((description, index) => ({ id: `${assignment.sourceItemId}-${index}`, description }))
    if (!descriptions.length) continue
    // An earlier release may have used a source-ID fallback. Preserve its ID and task links.
    let subject = subjects.find((item) => item.id === id || item.name === name)
    if (subject) id = subject.id
    if (!subject) {
      subject = { id, name, icon, materials: 'Материалы задания уточняются', mesh: '', summary: 'Точная запись МЭШ. Подробный разбор готовится.', tasks: [] }
      subjects.push(subject)
    }
    subject.mesh = descriptions.map((item) => item.description).join('; ')
    if (assignment.teacherFiles?.length) subject.materials = [...new Set(teacherLinks(local, lessonDate, assignment.teacherFiles).map((item) => item.title))].join('; ')
    for (const entry of descriptions) {
      const taskId = `mesh-${entry.id}`
      const description = entry.description.trim()
      const entryFiles = teacherFilesForEntry(assignment, entry, descriptions)
      const referenceDate = referencedHomeworkDate(description, lessonDate)
      // A bare attachment pointer names the same teacher file; it assigns no extra work.
      // @see ../docs/modules/synchronization/plan-generation.md#material-only-mesh-entries
      const mainEntry = descriptions.find((candidate) => candidate.id !== entry.id && !/^файл здесь\.?$/i.test(candidate.description.trim()))
      if (/^файл здесь\.?$/i.test(description) && assignment.teacherFiles?.length && mainEntry) {
        const targetTaskId = `mesh-${mainEntry.id}`
        if (!sourceOnlyEntries.some((item) => item.id === taskId)) sourceOnlyEntries.push({
          id: taskId, subjectId: id, targetTaskId, rawText: description,
          reason: 'Запись МЭШ указывает на приложенный к тому же уроку файл и не задаёт отдельного действия.',
        })
        subject.tasks = subject.tasks.filter((task) => task.id !== taskId)
        delete materialLinks[taskId]
        if (subject.summary === 'Новое задание МЭШ. Подробный разбор готовится.') {
          subject.summary = 'Запись МЭШ «Файл здесь» ведёт к уже указанному файлу учителя и не добавляет отдельного задания. Содержание основного задания ещё сверяется.'
        }
        continue
      }
      const old = subject.tasks.find((task) => task.id === taskId)
      if (old) {
        if (old.meshText !== description) {
          // A changed teacher instruction invalidates the previous agent interpretation.
          // Keep uploads separately, but show only the new raw MESH text until review.
          old.title = description.length > 105 ? `${description.slice(0, 102)}…` : description
          old.detail = description
          old.kind = rawMeshKind(description)
          old.status = 'unknown'
          old.steps = []
          old.submission = null
          delete old.platformResult
          delete old.parentGuide
          delete old.cardPattern
          delete old.outputKind
          delete old.materialRequest // A changed teacher instruction invalidates the old source question.
          delete old.assessmentIntent // A changed teacher entry invalidates the prior quiz decision.
          delete old.problems // Old teacher sheet and personalized hints do not apply to a revised condition.
          delete old.practiceVariants
          delete old.sourceInventory
          old.instructionStatus = { state: 'needs-review', message: 'Учитель изменил условие. Сейчас показан точный текст МЭШ; прежний разбор не действует.' }
          if (!['math', 'special'].includes(id) && old.kind === 'written') old.cardPolicyVersion = 1
          subject.summary = 'Условие МЭШ изменилось. Подробный разбор готовится.'
          if (!assignment.teacherFiles?.length) subject.materials = 'Материалы изменённого задания уточняются'
          old.materialStatus = { state: 'textbook-page-needed', message: 'Учитель изменил условие. Страницы и действия нужно сверить заново перед публикацией.' }
          delete materialLinks[taskId]
          materialLinkReplacements.add(taskId)
        }
        old.meshText = description
        if (referenceDate) old.referenceDate = referenceDate
        else delete old.referenceDate
        if (referenceDate && old.materialStatus?.state === 'textbook-page-needed') old.materialStatus = {
          state: 'no-textbook', message: `Это указатель на ДЗ к ${referenceDate}, а не новое упражнение из учебника.`,
        }
        if (old.instructionStatus?.state === 'needs-review') old.kind = rawMeshKind(description)
        if (!isExplicitCdzTask(old)) delete old.platformResult
        old.lessonDate = lessonDate
        const deadline = deadlineFromMesh(assignment, lessonDate)
        old.dueDate = deadline.dueDate
        if (deadline.dueDateEvidence) old.dueDateEvidence = deadline.dueDateEvidence
        else delete old.dueDateEvidence
        if (entryFiles.length) materialLinks[taskId] = teacherLinks(local, lessonDate, entryFiles)
        continue
      }
      subject.tasks.push({
        id: taskId, title: description.length > 105 ? `${description.slice(0, 102)}…` : description,
        detail: description,
        status: 'unknown', kind: rawMeshKind(description),
        // New numbered math tasks cannot be published after review without the private route.
        // @see ../docs/modules/reviews/math-solution-route.md#pipeline
        ...(['math', 'special'].includes(id) ? { mathRoutePolicyVersion: 2 } : {}),
        // A reviewed new written Russian task must receive one of the stable routes.
        // @see ../docs/modules/reviews/card-generation-policy.md#russian-adapter
        ...(!['math', 'special'].includes(id) && rawMeshKind(description) === 'written' ? { cardPolicyVersion: 1 } : {}),
        instructionStatus: { state: 'needs-review', message: '' },
        source: `МЭШ, подробная карточка урока ${lessonDate}; запись ${entry.id}.`,
        meshText: description, originDate: targetDate, lessonDate, ...deadlineFromMesh(assignment, lessonDate),
        ...(referenceDate ? { referenceDate, materialStatus: { state: 'no-textbook', message: `Это указатель на ДЗ к ${referenceDate}, а не новое упражнение из учебника.` } }
          : assignment.teacherFiles?.length && !entryFiles.length ? { materialStatus: { state: 'teacher-attachment-needed', message: 'Файлы урока ещё не сопоставлены с конкретным заданием МЭШ.' } }
            : !entryFiles.length ? { materialStatus: { state: 'textbook-page-needed', message: 'Страницу учебника к этому заданию ещё не сверили. Пока ориентируйся на точную запись МЭШ.' } } : {}),
      })
      subject.summary = ''
      if (!assignment.teacherFiles?.length) subject.materials = 'Материалы нового задания уточняются'
      added += 1
      if (entryFiles.length) materialLinks[taskId] = teacherLinks(local, lessonDate, entryFiles)
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
  const activeTaskIds = new Set(subjects.flatMap((subject) => subject.tasks.map((task) => task.id)))
  const retiredTaskIds = (current?.retiredTaskIds || []).filter((taskId) => !activeTaskIds.has(taskId))
  const source = { ...current, targetDate, notices, parentNotes, subjects, testPlacements: placements, materialLinks, materialLinkReplacements: [...materialLinkReplacements], sourceOnlyEntries, evidenceDayTokens, retiredTaskIds }
  writeJson(local, `day-source-${date}.json`, source)
  return { date, targetDate, assigned, subjects: subjects.length, tasks: subjects.reduce((sum, subject) => sum + subject.tasks.length, 0), added }
}
