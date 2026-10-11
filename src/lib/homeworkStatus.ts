import { uploadMatchesTask } from './dayStore'
import type { DayTask, DayUpload, DayWorkReview } from './dayStore'
import { activeProcessing, workCoverageComplete } from './reviewPresentation'
import { parentAccepted, requiredFamilyActions } from './parentCompletion'
import type { ParentCompletionEvent } from './parentCompletion'
import type { Assignment } from './quiz'

/** @see ../../docs/product/dashboard.md#homework-progress
 *  @see ../../docs/architecture/family-data-model.md#parent-home */
export type QuizScore = { points: number; maxPoints: number }
export type LessonWorkItem = { id: string; title: string; state: 'done' | 'todo' | 'checking' | 'unclear'; detail: string; qualityOpen?: boolean }

/** @see ../../docs/product/dashboard.md#schedule-homework-status */
export function lessonSubjectId(name: string) {
  const value = name.toLocaleLowerCase('ru-RU')
  if (/спецкурс|специальный курс/.test(value)) return 'special'
  if (/практикум/.test(value)) return 'practicum'
  if (/математ/.test(value)) return 'math'
  if (/русск/.test(value)) return 'russian'
  if (/литератур/.test(value)) return 'literature'
  if (/истори/.test(value)) return 'history'
  if (/англий|иностран/.test(value)) return 'english'
  if (/труд|технолог/.test(value)) return 'technology'
  if (/биологи/.test(value)) return 'biology'
  if (/географ/.test(value)) return 'geography'
  return null
}
export function lessonWorkItems(tasks: DayTask[], uploads: DayUpload[], reviews: DayWorkReview[], decisions: ParentCompletionEvent[], tests: Record<string, Assignment>, scores: Record<string, QuizScore>): LessonWorkItem[] {
  return tasks.flatMap((task) => {
    if (task.problems?.length) return task.problems.map((problem) => {
      const review = reviews.find((item) => item.taskId === problem.id)
      const pending = uploads.some((upload) => uploadMatchesTask(upload, problem.id) && ['requested', 'awaiting-upload', 'uploaded', 'pending'].includes(upload.status))
      const criterionPending = review?.assessmentBasis?.outcome === 'unresolved'
      const accepted = parentAccepted(review, decisions)
      const familyActions = requiredFamilyActions(review, decisions)
      const covered = workCoverageComplete(review) && !pending && !familyActions.length
      const state: LessonWorkItem['state'] = pending ? 'checking' : familyActions.length ? 'todo' : criterionPending && !covered ? 'unclear' : review?.status === 'verified' || accepted || covered ? 'done' : 'todo'
      return { id: problem.id, title: `№ ${problem.number}. ${problem.title}`, state, qualityOpen: covered, detail: familyActions.length ? `По решению родителя: ${familyActions.join('; ')}` : state === 'unclear' ? `${review?.summary ?? 'Работа разобрана; критерий не подтверждён.'} Новое фото не требуется.` : state === 'checking' ? 'Фото получено, ждём проверки' : state === 'done' ? covered ? 'Работа сдана; критерий оценки пока не установлен. Новых действий не требуется.' : accepted ? 'Засчитано родителем · ответ верен, ход неполон' : 'Решение проверено' : review?.status === 'needs-fix' ? 'Нужно исправить решение' : review?.status === 'partial' ? 'Нужно дополнить решение' : 'Нужно выполнить и загрузить решение' }
    })
    const review = reviews.find((item) => item.taskId === task.id)
    const pending = uploads.some((upload) => uploadMatchesTask(upload, task.id) && ['requested', 'awaiting-upload', 'uploaded', 'pending'].includes(upload.status))
    const score = task.testToken ? scores[task.testToken] : undefined
    const test = task.testToken ? tests[task.testToken] : undefined
    const readPassed = task.kind === 'read' && score && score.points >= (task.requiredPoints ?? score.maxPoints)
    const cdzPassed = task.platformResult?.state === 'completed'
    const accepted = parentAccepted(review, decisions)
    const familyActions = requiredFamilyActions(review, decisions)
    const covered = workCoverageComplete(review) && !pending && !familyActions.length
    const done = !familyActions.length && Boolean(readPassed || cdzPassed || review?.status === 'verified' || accepted || covered || !review && task.status === 'verified')
    const processing = activeProcessing(review, uploads.filter((upload) => uploadMatchesTask(upload, task.id)))
    const criterionPending = review?.assessmentBasis?.outcome === 'unresolved'
    const checking = !done && (pending || Boolean(processing && processing.phase !== 'paused') || task.kind === 'read' && test?.status === 'submitted' && !score)
    const state: LessonWorkItem['state'] = pending ? 'checking' : familyActions.length ? 'todo' : done ? 'done' : checking ? 'checking' : criterionPending ? 'unclear' : 'todo'
    const detail = state === 'checking' ? 'Работа получена, ждём результата проверки' : familyActions.length ? `По решению родителя: ${familyActions.join('; ')}` : state === 'done' ? covered ? 'Работа сдана; критерий оценки пока не установлен. Новых действий не требуется.' : accepted ? 'Засчитано родителем · ответ верен, ход неполон' : task.kind === 'read' && score ? `Тест: ${score.points} из ${score.maxPoints} верно` : cdzPassed ? `ЦДЗ пройдено: ${task.platformResult?.points} из ${task.platformResult?.maxPoints}` : 'Работа проверена'
      : state === 'unclear' ? `${review?.summary ?? 'Работа разобрана; критерий учителя не подтверждён.'} Новое фото не требуется.`
        : review?.status === 'needs-fix' ? 'Нужно исправить работу' : review?.status === 'partial' ? 'Нужно дополнить работу' : review?.status === 'cannot-assess' ? 'Фото нужно переснять'
          : task.kind === 'read' ? test?.status === 'submitted' ? 'Нужен разбор и повторная проверка' : 'Нужно пройти тест'
            : task.kind === 'check' ? 'Ожидается результат ЦДЗ' : 'Нужно выполнить и загрузить работу'
    return [{ id: task.id, title: task.title, state, detail, qualityOpen: covered }]
  })
}
