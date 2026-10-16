---
id: decision.specification-lifecycle
status: accepted
implementation: not-applicable
created: 2026-10-16
updated: 2026-10-16
parent: product.education
uses:
  - shared.specification-system
consumers:
  - Worker
  - Технический лидер
code: []
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---

# Жизненный цикл спецификаций и связь с кодом

## Основание

Прямой запрос пользователя требует дат создания и обновления, честного статуса исполнения, связи спецификаций с кодом, обратных ссылок и списка потребителей. Решение оформляет только аудит metadata и работу валидаторов документации.

## Было → стало

Frontmatter теперь фиксирует `created` и `updated` как реальные даты `YYYY-MM-DD`, `consumers` как непустой список уникальных строк, а `code` как список относительных runtime-путей. Нормативный документ product/services/modules/shared/operations со статусом исполнения `partial` или `implemented` должен объявлять пути; каждый путь проверяется на наличие в snapshot, строку file-map с назначением и потребителем, а также прямую локальную `@see` ссылку из комментария кода на контракт. Связь допускает many-to-many. `scripts/spec-graph.mjs` реализует правила и производные граф/сводку; `scripts/check-docs.mjs` запускает единый checker для рабочего дерева и Git index.

`created` означает первый известный день Git-истории документа; `updated` — последнее содержательное или metadata-изменение. `implementation: implemented` описывает состояние исходников. Эти метаданные и статическая проверка не доказывают rollout/deployment, смысловую полноту требования или корректность поведения.

Извлечение обратных ссылок намеренно ограничено `//`, `/* ... */` и CSS-комментариями и пропускает строковые литералы; это простой лексический проход без AST и не полная грамматика JavaScript. Проверка остаётся локальной и детерминированной.


Исходники с подтверждением `root tokenproof26` (26 comment-only proof-paths) и два изменённых валидатора, включённые в metadata-stage: `assessment/decision-graph.mjs`, `assessment/followup-contract.mjs`, `assessment/quiz-lineage.mjs`, `day/build.mjs`, `day/data-contract.mjs`, `day/pipeline-contract.mjs`, `operator/run-operation.mjs`, `scripts/access-management.mjs`, `scripts/build-site.mjs`, `scripts/day.mjs`, `scripts/direct-upload-worker.mjs`, `scripts/education.mjs`, `scripts/family.mjs`, `scripts/install-upload-worker.mjs`, `scripts/submissions.mjs`, `scripts/sync-project.mjs`, `src/App.tsx`, `src/DayDashboard.tsx`, `src/components/FamilyLibrary.tsx`, `src/components/NotificationBell.tsx`, `src/lib/personalAccess.ts`, `src/lib/quiz.ts`, `storage/direct-upload.mjs`, `storage/inbox-notifications.mjs`, `sync/publication-audit.mjs`, `vite.config.ts`, `scripts/spec-graph.mjs`, `scripts/check-docs.mjs`.

## Действия и роли

Автор указывает подтверждённые даты и реальные потребители, перечисляет исполняемые пути, добавляет прямой `@see` в комментарии и поддерживает строку file-map. Worker выполняет изменение в пределах задачи; технический лидер сверяет diff и результаты проверок. Другие значения не выводятся из даты файла или одной статической ссылки.

## Проверки

`spec-graph.test.mjs` и `check-docs.test.mjs` покрывают обязательные metadata, календарные даты, consumers/code, отсутствующие пути и ссылки, строковый `@see`, комментарии, many-to-many и расхождение Git index с рабочим деревом. Граф и сводка состояния формируются из metadata; проверка их актуальности выполняется `npm run check:spec`. Ни эти тесты, ни generated artifacts не являются runtime или deployment evidence.

## Согласование

Основание — прямой запрос пользователя от 16.10.2026 на даты, статус исполнения, связь спецификации с кодом и consumers. Уточнение Worker и технического лидера ограничивает это решение metadata-аудитом и валидаторами; будущая поведенческая работа Telegram в него не входит.
