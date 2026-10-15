import { cdzResultLabel, isCdzTask, uploadMatchesTask } from './dayStore'
import type { DayTask, DayUpload, DayWorkReview } from './dayStore'
import { activeProcessing, workCoverageComplete } from './reviewPresentation'
import { parentAccepted, requiredFamilyActions, stageCompletion, variantRequired } from './parentCompletion'
import type { ParentCompletionEvent } from './parentCompletion'
import { lessonSubjectKey } from '../../day/subject-identity.mjs'
import { quizPassed } from './quizCompletion'

/** @see ../../docs/product/dashboard.md#homework-progress
 *  @see ../../docs/architecture/family-data-model.md#parent-home */
export type QuizScore = { points: number; maxPoints: number }
export type LessonWorkItem = { id: string; title: string; state: 'done' | 'todo' | 'checking' | 'unclear'; detail: string; qualityOpen?: boolean; unresolvedReason?: 'missing-evidence' | 'criterion-unclear' }
export type QuizWorkState = { status: string; testId?: string; linkedToTestId?: string | null; title?: string; followupRequested?: boolean; followupRequestedAt?: unknown; familyOptional?: boolean }

export type QuizRequirement = Pick<LessonWorkItem, 'state' | 'detail'> | { state: 'optional'; detail: string }

/** A chain is one required self-check. Earlier attempts remain in history.
 * @see ../../docs/product/dashboard.md#homework-progress */
export function quizRequirement(rootToken: string, tests: Record<string, QuizWorkState>, scores: Record<string, QuizScore>): QuizRequirement {
  // The family choice is attached to the root, never to a retry. It removes
  // only this self-check from required work; the teacher sheet stays separate.
  // @see ../../docs/product/quizzes.md#optional-quiz
  if (tests[rootToken]?.familyOptional) return { state: 'optional', detail: 'По желанию · не входит в итог' }
  let token = rootToken
  const seen = new Set<string>()
  while (tests[token]?.testId && !seen.has(tests[token].testId!)) {
    seen.add(tests[token].testId!)
    const next = Object.entries(tests).find(([, test]) => test.linkedToTestId === tests[token].testId && test.testId && !seen.has(test.testId))
    if (!next) break
    token = next[0]
  }
  const test = tests[token]
  const score = scores[token]
  if (!test || test.status !== 'submitted') return { state: 'todo', detail: 'Нужно пройти самопроверку' }
  if (!score) return { state: 'checking', detail: 'Ответы отправлены, результат уточняется' }
  if (test.followupRequested || test.followupRequestedAt) return { state: 'todo', detail: 'Работа над ошибками запрошена · ждём новый тест' }
  if (quizPassed(score)) return { state: 'done', detail: `Тест: ${score.points} из ${score.maxPoints} верно` }
  return { state: 'todo', detail: `Нужна работа над ошибками · ${score.points} из ${score.maxPoints} верно` }
}

/** A voluntary test stays visible in QuizCard, but creates no work item. */
export function requiredQuizRequirement(rootToken: string, tests: Record<string, QuizWorkState>, scores: Record<string, QuizScore>): Pick<LessonWorkItem, 'state' | 'detail'> | null {
  const requirement = quizRequirement(rootToken, tests, scores)
  return requirement.state === 'optional' ? null : requirement
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
    if (task.problems?.length) return [
      ...task.problems.filter((problem) => !problem.variantId || variantRequired(task.id, problem.variantId, decisions)).map((problem) => {
      const review = reviews.find((item) => item.taskId === problem.id)
      const pending = uploads.some((upload) => uploadMatchesTask(upload, problem.id) && ['requested', 'awaiting-upload', 'uploaded', 'pending'].includes(upload.status))
      const criterionPending = review?.assessmentBasis?.outcome === 'unresolved'
      const accepted = parentAccepted(review, decisions)
      const familyStageComplete = stageCompletion(review, decisions)?.complete ?? false
      const familyActions = requiredFamilyActions(review, decisions)
      const covered = workCoverageComplete(review) && !pending && !familyActions.length
      const state: LessonWorkItem['state'] = pending ? 'checking' : familyActions.length ? 'todo' : familyStageComplete || review?.status === 'verified' || accepted || covered ? 'done' : criterionPending ? 'unclear' : 'todo'
      return { id: problem.id, title: `${problem.variantId ? `${task.practiceVariants?.find((variant) => variant.id === problem.variantId)?.title ?? 'Вариант'} · ` : ''}№ ${problem.number}. ${problem.title}`, state, qualityOpen: covered,
        unresolvedReason: state === 'unclear' ? review?.assessmentBasis?.unresolvedReason : undefined,
        detail: familyActions.length ? `По решению родителя: ${familyActions.join('; ')}` : state === 'unclear'
          ? review?.assessmentBasis?.unresolvedReason === 'missing-evidence' ? review.studentFeedback?.title ?? 'Часть работы не видна на фото; подробности в разборе.'
            : 'Работа разобрана; основание неопределённости — в карточке.'
          : state === 'checking' ? 'Фото получено, ждём проверки' : state === 'done' ? covered ? 'Работа сдана; критерий оценки пока не установлен. Новых действий не требуется.' : accepted ? 'Засчитано родителем · ответ верен, ход неполон' : 'Решение проверено' : review?.status === 'needs-fix' ? 'Нужно исправить решение' : review?.status === 'partial' ? 'Нужно дополнить решение' : 'Нужно выполнить и загрузить решение' }
    }),
      ...(task.testToken && requiredQuizRequirement(task.testToken, tests, scores) ? [{ id: `quiz:${task.testToken}`, title: 'Самопроверка по теме',
        ...requiredQuizRequirement(task.testToken, tests, scores)! }] : []),
    ]
    if ((task.kind === 'read' || task.kind === 'check') && task.testToken) {
      const requirement = requiredQuizRequirement(task.testToken, tests, scores)
      return requirement ? [{ id: task.id, title: task.title, ...requirement }] : []
    }
    const review = reviews.find((item) => item.taskId === task.id)
    const pending = uploads.some((upload) => uploadMatchesTask(upload, task.id) && ['requested', 'awaiting-upload', 'uploaded', 'pending'].includes(upload.status))
    const quiz = task.testToken ? quizRequirement(task.testToken, tests, scores) : undefined
    const readPassed = (task.kind === 'read' || task.kind === 'check') && quiz?.state === 'done'
    const cdzPassed = isCdzTask(task) && task.platformResult?.state === 'completed'
      const accepted = parentAccepted(review, decisions)
      const familyStageComplete = stageCompletion(review, decisions)?.complete ?? false
    const familyActions = requiredFamilyActions(review, decisions)
    const covered = workCoverageComplete(review) && !pending && !familyActions.length
    const done = !familyActions.length && Boolean(readPassed || cdzPassed || familyStageComplete || review?.status === 'verified' || accepted || covered || !review && task.status === 'verified')
    const processing = activeProcessing(review, uploads.filter((upload) => uploadMatchesTask(upload, task.id)))
    const criterionPending = review?.assessmentBasis?.outcome === 'unresolved'
    const checking = !done && (pending || Boolean(processing && processing.phase !== 'paused') || (task.kind === 'read' || task.kind === 'check') && quiz?.state === 'checking')
    const state: LessonWorkItem['state'] = pending ? 'checking' : familyActions.length ? 'todo' : done ? 'done' : checking ? 'checking' : criterionPending ? 'unclear' : 'todo'
    const detail = state === 'checking' ? quiz?.state === 'checking' ? quiz.detail : 'Работа получена, ждём результата проверки' : familyActions.length ? `По решению родителя: ${familyActions.join('; ')}` : state === 'done' ? familyStageComplete ? 'Все обязательные пункты подтверждены по семейному плану' : covered ? 'Работа сдана; критерий оценки пока не установлен. Новых действий не требуется.' : accepted ? 'Засчитано родителем · ответ верен, ход неполон' : readPassed ? quiz!.detail : cdzPassed ? cdzResultLabel(task.platformResult) : 'Работа проверена'
      : state === 'unclear' ? review?.assessmentBasis?.unresolvedReason === 'missing-evidence'
        ? review.studentFeedback?.title ?? 'Часть работы не видна на фото; подробности в разборе.'
        : 'Работа разобрана; основание неопределённости — в карточке.'
        : review?.status === 'needs-fix' ? 'Нужно исправить работу' : review?.status === 'partial' ? 'Нужно дополнить работу' : review?.status === 'cannot-assess' ? 'Фото нужно переснять'
          : (task.kind === 'read' || task.kind === 'check') && quiz ? quiz.detail
            : isCdzTask(task) ? 'Ожидается результат ЦДЗ' : task.kind === 'check' ? 'Нужно выполнить задание МЭШ' : 'Нужно выполнить и загрузить работу'
    return [{ id: task.id, title: task.title, state, detail, qualityOpen: covered,
      unresolvedReason: state === 'unclear' ? review?.assessmentBasis?.unresolvedReason : undefined }]
  })
}
