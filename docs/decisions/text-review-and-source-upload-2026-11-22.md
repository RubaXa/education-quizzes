---
id: decision.text-review-and-source-upload-2026-11-22
status: accepted
implementation: partial
created: 2026-11-22
updated: 2026-11-22
parent: module.assessments
uses:
  - module.assessments.quizzes
  - module.materials.material-clarification
  - module.assignments.source-units
consumers:
  - student
  - parent
  - Education operator
code: []
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---
# Смысловая проверка текста и сохранение источника задания

## Основание

Родитель22.11 показал отвергнутый из-за окончания короткий ответ, подготовку
без листа учителя и повторение конспекта без кнопки загрузки. Прямо потребовал
проверять словесные ответы через ИИ, принимать несколько страниц недостающего
источника и показывать реальную работу вместе с тестом.

## Было → стало

`short` немедленно сравнивался со строкой. Новая версия политики переводит
short/long в pending до проверки содержания по источнику. Точное совпадение
не является исключением. Числа и выбор по-прежнему проверяются автоматически.
Отправленные исторические попытки сохраняются; открытые получают только флаг
политики и закрытые рубрики без замены вопросов/ответов.

Подготовка с testToken показывала только QuizCard. Она использует существующие
AssignmentUnits, MaterialReader, PhotoUploadControl и TaskWorkEvidence.
Открытый materialRequest сохраняет общий загрузчик даже при reading-единицах.
Ни нового макета, ни новой подписки, ни нового требования учителя нет.

Изменённые файлы:

- `src/lib/quiz.ts`, `assessment/decision-graph.mjs`, `scripts/sync-inbox.mjs`.
- `assessment/manual-review-contract.mjs`, `scripts/quiz.mjs`, `day/data-contract.mjs`.
- `assessment/question-guidance.mjs`, `src/components/QuizResultCard.tsx`.
- `src/DayPage.tsx`, `src/WeekendMathSlot.tsx`, `src/components/AssignmentUnits.tsx`.
- `scripts/education-sync-dispatch.mjs`: сохраняет четыре конечных безопасных кода
  изменившегося источника вместо обезличенного dispatch_failed; содержимое/ключи
  в ошибку не попадают. Проверка `scripts/education-sync-dispatch.test.mjs`.
- `sync/event-task-artifact.mjs`: микроответ привязан к точному текущему разбору
  и вопросу; обновление соседней карточки не отбрасывает его из-за общей ревизии.
  `sync/help-response.test.mjs` воспроизводит все пять переходов на обеих ревизиях.
- `sync/event-task-export.mjs` сохраняет точный blocker старого источника и
  экспортирует независимые действия того же frozen-пакета без автоматического
  закрытия; регрессия `sync/event-task-export.test.mjs`.

## Действия и роли

Ребёнок видит свой текст и ожидание, затем проверенный отклик; ключ не подставляется
в подсказку. Родитель сохраняет полный закрытый путь. Миграция проверяет владельца,
полные снимки CAS и readback; submitted/семейные решения не меняет.
Фото конспекта — источник теста, а не доказательство прочтения. Уже полученные
снимки сохраняются, повторно не запрашиваются. Без содержания тест не генерируется.
Граф: artifact.units → view.role (prepare:units/units:role); запрос источника →
source-material → assessment; pending text → review → knowledge.

## Проверки

До правки воспроизведены: exact/typo/paraphrase short получают немедленный балл;
mixed-назначение в подготовке теряет оригинал/фото; reading assignmentUnits скрывает
многофайловый загрузчик materialRequest. Регрессии:
`src/lib/quiz.test.ts`, `assessment/manual-review-contract.test.mjs`,
`src/WeekendMathSlot.test.tsx`, `src/DayPage.assignmentQuiz.integration.test.tsx`.
Сохранены сценарии чистой самопроверки без фото и прежних исторических баллов.
Полный npm check, ролевой readback и мобильная геометрия проверяются до выпуска;
эта запись сама по себе не подтверждает deployment.

## Согласование

Прямые запросы пользователя22.11: текстовые ответы ожидают ИИ; найти лист
комбинаторики и загрузку решений; отсутствующий конспект запрашивается несколькими
фото через уже существующую механику. Новое расписание или массовая замена тестов
не разрешены и не выполняются.
