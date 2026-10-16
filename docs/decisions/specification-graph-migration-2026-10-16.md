---
id: decision.specification-graph-migration
status: accepted
implementation: not-applicable
created: 2026-10-16
updated: 2026-10-16
consumers:
  - "product implementer"
  - "service implementer"
code:
  []
parent: product.education
uses:
  - shared.specification-system
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
  - затронутые-исходники
  - итог-интеграции
---

# Перенос спецификаций в единый граф

## Основание

Прямой запрос пользователя 16.10.2026: внедрить согласованную структуру, перенести существующие спецификации, связать их друг с другом и кодом, сохранить принятые требования, проверить ссылки и проверки. Работа делегирована Worker Luna крупными блоками с независимым ревью root.

## Было → стало

Локальные product/architecture документы перенесены в product/services/modules/shared/operations/decisions/research/audits/plans. Существующая карта файлов остаётся единственным реестром привязок к коду. Новые валидатор и генератор выводят JSON/Mermaid из YAML и file-map. Ссылки в комментариях исходников актуализированы; поведение пользовательских экранов, чтения/записи учебных данных и принятого UI этим переносом не меняется.

Предыдущие записи решений и их authorization/tests сохранены. Для файлов, которые уже имели решение, обновлён только source hash и добавлена documentationMigration с прежним hash. Запечатанный ui-contract-baseline.json побайтно сохранён. [Квитанция сохранности](../audits/specification-migration-preservation-2026-10-16.json) фиксирует исходные и итоговые хэши 111 тел документов и проверку source references-only для предметного кода.

## Действия и роли

Родитель и ребёнок сохраняют все прежние пользовательские сценарии. Оператор и агент получают короткие entrypoints и подграф по задаче. Telegram runtime остаётся planned; документация не объявляет его развёрнутым.

## Проверки

`npm run check:spec`, отдельные отрицательные тесты scripts/spec-graph.test.mjs и scripts/check-ui-contract.test.mjs, штатные tests/typecheck/read-index/lint/build, проверка из самостоятельного checkout без приватных PETR-документов. Конкретные результаты фиксируются по завершении интеграции. Смысловая полнота кода не выводится из наличия ребра графа.

## Согласование

Прямой запрос пользователя: «Да, давай внедрять эту структуру. Перенеси существующие спецификации, свяжи их между собой и с кодом, сохрани все принятые требования и проверь, что ссылки и проверки работают». Он является основанием переноса и инфраструктурных проверок; новые пользовательские блоки этим решением не вводятся.

## Затронутые исходники

- `assessment/decision-graph.mjs`
- `assessment/decision-graph.test.mjs`
- `assessment/followup-contract.mjs`
- `assessment/question-copy.mjs`
- `assessment/question-copy.test.mjs`
- `assessment/quiz-lineage.mjs`
- `assessment/quiz-lineage.test.mjs`
- `day/assignment-structure.mjs`
- `day/build.mjs`
- `day/card-policy.mjs`
- `day/dashboard-index.mjs`
- `day/data-contract.mjs`
- `day/family-source-graph.mjs`
- `day/grade-publication.mjs`
- `day/grade-reconciliation.mjs`
- `day/grade-snapshot.mjs`
- `day/homework-kind.mjs`
- `day/homework-reference.mjs`
- `day/material-access.mjs`
- `day/merge.mjs`
- `day/owner-repair.mjs`
- `day/pipeline-contract.mjs`
- `day/placement-integrity.mjs`
- `day/placement-repair.mjs`
- `day/public-projection.mjs`
- `day/subject-identity.mjs`
- `diary/adapters/mesh.mjs`
- `diary/application/lesson-visibility.mjs`
- `diary/application/school-alerts.mjs`
- `diary/application/sync.mjs`
- `operator/operation-contract.mjs`
- `operator/recipes.mjs`
- `operator/run-operation.mjs`
- `packages/education-connect/bin/education-connect.mjs`
- `packages/education-connect/lib/envelope.mjs`
- `packages/education-connect/lib/envelope.test.mjs`
- `packages/education-connect/lib/handoff-store.mjs`
- `packages/education-connect/lib/mesh.mjs`
- `packages/education-connect/lib/network-retry.mjs`
- `packages/education-connect/lib/prompts.mjs`
- `scripts/access-management.mjs`
- `scripts/archive-local.mjs`
- `scripts/audit-family-links.mjs`
- `scripts/backfill-book-manifests.mjs`
- `scripts/check-material-preview-viewport.mjs`
- `scripts/check-notification-viewport.mjs`
- `scripts/check-privacy.mjs`
- `scripts/check-problem-variant-viewport.mjs`
- `scripts/check-quiz-switch-viewport.mjs`
- `scripts/check-schedule-viewport.mjs`
- `scripts/check-source-fragment-viewport.mjs`
- `scripts/check-spec-map.mjs`
- `scripts/check-ui-contract.mjs`
- `scripts/check-ui-contract.test.mjs`
- `scripts/connect.mjs`
- `scripts/day.mjs`
- `scripts/direct-upload-worker.mjs`
- `scripts/education.mjs`
- `scripts/ensure-book-upload-index.mjs`
- `scripts/family-library.mjs`
- `scripts/family.mjs`
- `scripts/firestore-read-index.mjs`
- `scripts/firestore-rules-followup.test.mjs`
- `scripts/firestore-rules-optional-quiz.test.mjs`
- `scripts/firestore-rules-stage-choice.test.mjs`
- `scripts/firestore-usage-window.mjs`
- `scripts/firestore-usage.mjs`
- `scripts/grade-snapshot.mjs`
- `scripts/install-upload-worker.mjs`
- `scripts/lib/access-projection.mjs`
- `scripts/lib/admin-firebase.mjs`
- `scripts/notifications.mjs`
- `scripts/quiz.mjs`
- `scripts/release-note.mjs`
- `scripts/storage.mjs`
- `scripts/submissions.mjs`
- `scripts/sync-books.mjs`
- `scripts/sync-inbox.mjs`
- `scripts/sync-project.mjs`
- `scripts/sync-queue.mjs`
- `scripts/verify-upload-flow.mjs`
- `src/App.css`
- `src/App.tsx`
- `src/DayDashboard.css`
- `src/DayDashboard.tsx`
- `src/DayDashboard.warmStart.test.tsx`
- `src/DayPage.assignmentQuiz.integration.test.tsx`
- `src/DayPage.css`
- `src/DayPage.gradeBadge.test.tsx`
- `src/DayPage.tsx`
- `src/UiKit.css`
- `src/UiKit.test.tsx`
- `src/UiKit.tsx`
- `src/WeekendMathSlot.css`
- `src/WeekendMathSlot.tsx`
- `src/components/ArtifactAvatar.css`
- `src/components/ArtifactAvatar.tsx`
- `src/components/AssignmentBrief.css`
- `src/components/AssignmentBrief.test.tsx`
- `src/components/AssignmentBrief.tsx`
- `src/components/CodeBlock.tsx`
- `src/components/ConnectionInvite.tsx`
- `src/components/DataCompatibilityNotice.css`
- `src/components/DataCompatibilityNotice.tsx`
- `src/components/EducationImage.css`
- `src/components/EducationImage.test.tsx`
- `src/components/EducationImage.tsx`
- `src/components/EducationScreen.tsx`
- `src/components/FamilyAccessCards.tsx`
- `src/components/FamilyLibrary.css`
- `src/components/FamilyLibrary.tsx`
- `src/components/HomeworkOverview.test.tsx`
- `src/components/HomeworkOverview.tsx`
- `src/components/MaterialReader.test.tsx`
- `src/components/MaterialReader.tsx`
- `src/components/MaterialRequest.tsx`
- `src/components/NotificationBell.css`
- `src/components/NotificationBell.layout.test.mjs`
- `src/components/NotificationBell.tsx`
- `src/components/ParentHome.css`
- `src/components/ParentHome.readBudget.test.tsx`
- `src/components/ParentHome.tsx`
- `src/components/ParentTaskGuide.css`
- `src/components/ParentTaskGuide.tsx`
- `src/components/PersonalEntry.localFirst.test.tsx`
- `src/components/PersonalEntry.tsx`
- `src/components/PhotoUploadControl.tsx`
- `src/components/ProblemCard.css`
- `src/components/ProblemCard.test.tsx`
- `src/components/ProblemCard.tsx`
- `src/components/ProblemGroup.css`
- `src/components/ProblemGroup.layout.test.tsx`
- `src/components/ProblemGroup.tsx`
- `src/components/ProblemStatement.css`
- `src/components/ProblemStatement.provenance.test.tsx`
- `src/components/ProblemStatement.tsx`
- `src/components/ProblemTaskCard.contract.test.tsx`
- `src/components/ProblemTaskCard.tsx`
- `src/components/QuizAttemptReview.tsx`
- `src/components/QuizCard.css`
- `src/components/QuizCard.history.test.tsx`
- `src/components/QuizCard.test.tsx`
- `src/components/QuizCard.time.test.tsx`
- `src/components/QuizCard.tsx`
- `src/components/QuizResultCard.tsx`
- `src/components/QuizTextAnswer.tsx`
- `src/components/RequirementSwitch.css`
- `src/components/RequirementSwitch.tsx`
- `src/components/SourceFragment.css`
- `src/components/SourceFragment.tsx`
- `src/components/StatusIcon.css`
- `src/components/StatusIcon.test.tsx`
- `src/components/StatusIcon.tsx`
- `src/components/SubjectTheme.tsx`
- `src/components/TaskGuidance.css`
- `src/components/TaskGuidance.tsx`
- `src/components/UnifiedTaskCard.test.tsx`
- `src/components/WorkReview.tsx`
- `src/components/ui/badge.tsx`
- `src/components/ui/button.tsx`
- `src/components/ui/card.tsx`
- `src/components/ui/result.css`
- `src/components/ui/result.test.tsx`
- `src/components/ui/result.tsx`
- `src/education-design-tokens.css`
- `src/lib/assignmentPresentation.ts`
- `src/lib/bookPageSource.ts`
- `src/lib/dayCompatibility.ts`
- `src/lib/dayDashboardLessonCache.ts`
- `src/lib/dayDashboardStore.ts`
- `src/lib/dayDashboardStore.warmStart.test.ts`
- `src/lib/dayDashboardViewCache.ts`
- `src/lib/dayGuidance.ts`
- `src/lib/dayMaterialRefs.ts`
- `src/lib/dayStore.guideRead.test.ts`
- `src/lib/dayStore.ts`
- `src/lib/educationSchema.ts`
- `src/lib/educationStore.ts`
- `src/lib/familyBookUpload.ts`
- `src/lib/familyLibrary.ts`
- `src/lib/guideReadPolicy.test.ts`
- `src/lib/guideReadPolicy.ts`
- `src/lib/homeworkStatus.test.ts`
- `src/lib/homeworkStatus.ts`
- `src/lib/homeworkUpdateReceipt.ts`
- `src/lib/inboxCache.test.ts`
- `src/lib/inboxCache.ts`
- `src/lib/localFirstPilot.ts`
- `src/lib/materialPageCache.ts`
- `src/lib/materialRequest.test.ts`
- `src/lib/materialRequest.ts`
- `src/lib/networkRetry.ts`
- `src/lib/notificationThreads.ts`
- `src/lib/parentCompletion.ts`
- `src/lib/parentFocusDay.test.ts`
- `src/lib/parentFocusDay.ts`
- `src/lib/personalAccess.readBudget.test.ts`
- `src/lib/personalAccess.ts`
- `src/lib/photoUploadPolicy.ts`
- `src/lib/problemGroupSummary.ts`
- `src/lib/questionTopicPresentation.test.ts`
- `src/lib/questionTopicPresentation.ts`
- `src/lib/quizCardViewModel.test.ts`
- `src/lib/quizCardViewModel.ts`
- `src/lib/quizCompletion.ts`
- `src/lib/quizDraft.ts`
- `src/lib/quizLocalStore.ts`
- `src/lib/requestSingleFlight.ts`
- `src/lib/resultPresentation.test.ts`
- `src/lib/resultPresentation.ts`
- `src/lib/reviewPresentation.ts`
- `src/lib/spellingFeedback.ts`
- `src/lib/store.optionalQuiz.test.ts`
- `src/lib/store.ts`
- `src/lib/uiErrors.ts`
- `src/lib/uiKitExamples.ts`
- `src/lib/useDashboardDayWork.ts`
- `src/lib/useDayEvidence.ts`
- `src/lib/useDayQuizOutcomes.ts`
- `src/lib/useDelayedRefresh.test.tsx`
- `src/lib/useDelayedRefresh.ts`
- `src/lib/useParentChildOverview.ts`
- `src/lib/useParentCompletions.ts`
- `src/lib/watchQuizOutcome.test.ts`
- `src/lib/watchQuizOutcome.ts`
- `src/lib/yandexPublic.test.ts`
- `src/lib/yandexPublic.ts`
- `storage/family-book-projection.mjs`
- `storage/family-book-upload.mjs`
- `storage/inbox-notifications.mjs`
- `storage/material-pages.mjs`
- `storage/page-publication.mjs`
- `storage/review-challenge.mjs`
- `storage/review-coverage.mjs`
- `storage/review-projection.mjs`
- `storage/review-readback.mjs`
- `storage/review-requirements.mjs`
- `storage/submission-inbox.mjs`
- `storage/textbook-catalog.mjs`
- `storage/yandex-disk.mjs`
- `sync/artifact-capture.mjs`
- `sync/day-source-revision.mjs`
- `sync/help-request-cache.mjs`
- `sync/job-queue.mjs`
- `sync/project-plan.mjs`
- `sync/publication-audit.mjs`
- `sync/run-context.mjs`
- `scripts/spec-graph.mjs`

## Итог интеграции

Штатный `npm run check` прошёл: 121 файлов тестов, 490 тестов, read-index (359 мест, новых вызовов нет), lint и build gate. Typecheck и Vite build прошли в первом полном запуске; заключительный запуск подтвердил неизменность входов и актуальную сборку. Graph/map/UI проверки прошли также в отдельном checkout из 530 файлов без приватного PETR и без node_modules. Граф: 140 спецификаций, 530 узлов, 722 связей. PETR bootstrap/self_review прошли; полное содержимое прежней политики сохранено отдельно, короткий root AGENTS содержит 59 строк. Существующие предупреждения линтера и размера Vite-чанков не блокируют проверки. Выпуск сайта и Telegram runtime этим изменением не выполнялись.
