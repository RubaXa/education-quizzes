import { cdzResultLabel, isCdzTask, uploadMatchesTask } from './dayStore'
import type { DayTask, DayUpload, DayWorkReview } from './dayStore'
import { activeProcessing, workCoverageComplete } from './reviewPresentation'
import { parentAccepted, requiredFamilyActions, stageCompletion } from './parentCompletion'
import type { ParentCompletionEvent } from './parentCompletion'
import { lessonSubjectKey } from '../../day/subject-identity.mjs'

/** @see ../../docs/product/dashboard.md#homework-progress
 *  @see ../../docs/architecture/family-data-model.md#parent-home */
export type QuizScore = { points: number; maxPoints: number }
export type LessonWorkItem = { id: string; title: string; state: 'done' | 'todo' | 'checking' | 'unclear'; detail: string; qualityOpen?: boolean }
export type QuizWorkState = { status: string; testId?: string; linkedToTestId?: string | null; title?: string }

/** Every linked test is another required part of the same teacher assignment.
 * @see ../../docs/product/dashboard.md#homework-progress */
export function linkedQuizWorkItems(rootToken: string, tests: Record<string, QuizWorkState>, scores: Record<string, QuizScore>): LessonWorkItem[] {
  const root = tests[rootToken]
  if (!root?.testId) return []
  const items: LessonWorkItem[] = []
  const seen = new Set([root.testId])
  let previous = root.testId
  while (true) {
    const next = Object.entries(tests).find(([, test]) => test.linkedToTestId === previous && test.testId && !seen.has(test.testId))
    if (!next) break
    const [token, test] = next
    seen.add(test.testId!)
    previous = test.testId!
    const score = scores[token]
    const state: LessonWorkItem['state'] = test.status !== 'submitted' ? 'todo' : score ? 'done' : 'checking'
    items.push({ id: `quiz:${token}`, title: test.title ?? 'Повторная самопроверка', state,
      detail: state === 'done' ? `Тест: ${score.points} из ${score.maxPoints} баллов` : state === 'checking' ? 'Ответы отправлены, ждём проверки' : 'Тест ещё не завершён' })
  }
  return items
}

/** @see ../../docs/product/dashboard.md#schedule-homework-status */
export function lessonSubjectId(name: string) {
  return lessonSubjectKey(name)
}
export function lessonWorkItems(tasks: DayTask[], uploads: DayUpload[], reviews: DayWorkReview[], decisions: ParentCompletionEvent[], tests: Record<string, QuizWorkState>, scores: Record<string, QuizScore>): LessonWorkItem[] {
  return tasks.flatMap((task) => {
    // A MESH pointer to an earlier lesson is information, not a second task.
    // @see ../../docs/product/dashboard.md#reference-only-homework
    if (task.referenceDate) return []
    if (task.problems?.length) return task.problems.map((problem) => {
      const review = reviews.find((item) => item.taskId === problem.id)
      const pending = uploads.some((upload) => uploadMatchesTask(upload, problem.id) && ['requested', 'awaiting-upload', 'uploaded', 'pending'].includes(upload.status))
      const criterionPending = review?.assessmentBasis?.outcome === 'unresolved'
      const accepted = parentAccepted(review, decisions)
      const familyStageComplete = stageCompletion(review, decisions)?.complete ?? false
      const familyActions = requiredFamilyActions(review, decisions)
      const covered = workCoverageComplete(review) && !pending && !familyActions.length
      const state: LessonWorkItem['state'] = pending ? 'checking' : familyActions.length ? 'todo' : familyStageComplete || review?.status === 'verified' || accepted || covered ? 'done' : criterionPending ? 'unclear' : 'todo'
      return { id: problem.id, title: `№ ${problem.number}. ${problem.title}`, state, qualityOpen: covered, detail: familyActions.length ? `По решению родителя: ${familyActions.join('; ')}` : state === 'unclear' ? `${review?.summary ?? 'Работа разобрана; критерий не подтверждён.'} Новое фото не требуется.` : state === 'checking' ? 'Фото получено, ждём проверки' : state === 'done' ? covered ? 'Работа сдана; критерий оценки пока не установлен. Новых действий не требуется.' : accepted ? 'Засчитано родителем · ответ верен, ход неполон' : 'Решение проверено' : review?.status === 'needs-fix' ? 'Нужно исправить решение' : review?.status === 'partial' ? 'Нужно дополнить решение' : 'Нужно выполнить и загрузить решение' }
    })
    const review = reviews.find((item) => item.taskId === task.id)
    const pending = uploads.some((upload) => uploadMatchesTask(upload, task.id) && ['requested', 'awaiting-upload', 'uploaded', 'pending'].includes(upload.status))
    const score = task.testToken ? scores[task.testToken] : undefined
    const test = task.testToken ? tests[task.testToken] : undefined
    const readPassed = task.kind === 'read' && score && score.points >= (task.requiredPoints ?? score.maxPoints)
    const cdzPassed = isCdzTask(task) && task.platformResult?.state === 'completed'
      const accepted = parentAccepted(review, decisions)
      const familyStageComplete = stageCompletion(review, decisions)?.complete ?? false
    const familyActions = requiredFamilyActions(review, decisions)
    const covered = workCoverageComplete(review) && !pending && !familyActions.length
    const done = !familyActions.length && Boolean(readPassed || cdzPassed || familyStageComplete || review?.status === 'verified' || accepted || covered || !review && task.status === 'verified')
    const processing = activeProcessing(review, uploads.filter((upload) => uploadMatchesTask(upload, task.id)))
    const criterionPending = review?.assessmentBasis?.outcome === 'unresolved'
    const checking = !done && (pending || Boolean(processing && processing.phase !== 'paused') || task.kind === 'read' && test?.status === 'submitted' && !score)
    const state: LessonWorkItem['state'] = pending ? 'checking' : familyActions.length ? 'todo' : done ? 'done' : checking ? 'checking' : criterionPending ? 'unclear' : 'todo'
    const detail = state === 'checking' ? 'Работа получена, ждём результата проверки' : familyActions.length ? `По решению родителя: ${familyActions.join('; ')}` : state === 'done' ? familyStageComplete ? 'Все обязательные пункты подтверждены по семейному плану' : covered ? 'Работа сдана; критерий оценки пока не установлен. Новых действий не требуется.' : accepted ? 'Засчитано родителем · ответ верен, ход неполон' : task.kind === 'read' && score ? `Тест: ${score.points} из ${score.maxPoints} верно` : cdzPassed ? cdzResultLabel(task.platformResult) : 'Работа проверена'
      : state === 'unclear' ? `${review?.summary ?? 'Работа разобрана; критерий учителя не подтверждён.'} Новое фото не требуется.`
        : review?.status === 'needs-fix' ? 'Нужно исправить работу' : review?.status === 'partial' ? 'Нужно дополнить работу' : review?.status === 'cannot-assess' ? 'Фото нужно переснять'
          : task.kind === 'read' ? test?.status === 'submitted' ? 'Нужен разбор и повторная проверка' : 'Нужно пройти тест'
            : isCdzTask(task) ? 'Ожидается результат ЦДЗ' : task.kind === 'check' ? 'Нужно выполнить задание МЭШ' : 'Нужно выполнить и загрузить работу'
    return [{ id: task.id, title: task.title, state, detail, qualityOpen: covered },
      ...(task.testToken ? linkedQuizWorkItems(task.testToken, tests, scores) : [])]
  })
}
