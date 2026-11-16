---
id: decision.task-presentation-contracts-2026-11-16
status: accepted
implementation: implemented
created: 2026-11-16
updated: 2026-11-16
parent: shared.design.task-presentation
uses:
  - module.reviews.adaptive-problem-card
  - module.materials.material-clarification
  - shared.design.ui-kit
consumers:
  - parent
  - student
  - Education operator
code: []
sections:
  - reason
  - change
  - roles
  - verification
  - authorization
---
# Контракт представления от графа до настоящей карточки

## Основание {#reason}

Родитель16.11 показал повторённое условие вместо модели задачи и длинный технический запрос страниц. Потребовал единый граф со спецификацией каждого перехода, настоящими макетами UI Kit и обязательной проверкой данных. Последнее уточнение: сначала искать в загруженных книгах и архиве, затем объяснять, что найдено, чего нет и почему имеющегося недостаточно. Прежнее структурное покрытие каталога проверяло IDs, но не реальное тело с support.

## Было → стало {#change}

Полное условие остаётся один раз в оригинале; отдельные факты и искомое каждого подпункта показываются общим ProblemStatement. Закрытый ParentTaskGuide содержит конкретный метод и структурированные переходы, rows либо blocks без дубля. Родитель не получает универсальную стену текста. Недостающий источник использует MaterialRequest: известное, недостающее, причина и одно действие; детали поиска раскрываются. Ожидающая проверки загрузка не вызывает повторной просьбы. Старый формат остаётся читаемым, новая публикация требует полного контракта.

Граф получает явный presentation contract и адресный реальный сценарий; неизвестный продукт или общий node/edge отклоняется. UI Kit вызывает ProblemTaskCard с настоящими данными, а не похожую оболочку, и отдельный missing-source MaterialRequest. LearnerFlow не повторяет краткое условие, уже показанное AssignmentBrief, и не заканчивает географию требованием сверить диалог.

Штатная адресная коррекция обновляет только представление support/закрытого guide/запроса, с владельцем, CAS, историей и обеими ролевыми перечитками. Условие, ответ, критерии, planRevision, оценки, checkedAt, фото и попытки не меняются.

Затронутые файлы:
- `day/decision-registry.mjs`
- `packages/education-presentation/task-presentation.mjs`
- `scripts/day.mjs`
- `scripts/task-presentation.mjs`
- `src/DayPage.tsx`
- `src/components/LearnerFlow.tsx`
- `src/components/MaterialRequest.css`
- `src/components/MaterialRequest.tsx`
- `src/components/ProblemStatement.css`
- `src/components/ProblemStatement.tsx`
- `src/lib/dayStore.ts`
- `src/lib/materialRequest.ts`
- `src/lib/reviewProse.ts`
- `src/ui-kit/DecisionScenarioCatalog.css`
- `src/ui-kit/DecisionScenarioCatalog.tsx`
- `src/ui-kit/decisionScenarioFixtures.ts`
- `storage/parent-guide-edit.mjs`
- `storage/task-presentation-edit.mjs`

## Действия и роли {#roles}

Порядок оригиналов, фото, проверки и сдачи сохраняется. Общая карточка закрыта при входе. Родительский полный путь закрыт от ученика; новые факты не вычисляют неизвестный ответ. Загрузчик остаётся только у ребёнка. Точная ссылка на прежнюю карточку сохраняет владельца и роль. Технический trace находится в UI Kit, не в учебной инструкции.

## Проверки {#verification}

Регрессии воспроизводят полный текст в Дано и шаблонное Найти; publication gate их отклоняет. Проверяются multipart, неизвестные продукты и scopes, закрытый ключ в публичном запросе, пересечение имеющихся и недостающих страниц. Реальные UI Kit композиции проверяются обеим ролям, включая missing-source и отсутствие выдуманной темы. Native fake-DB тесты проверяют owner/CAS, неизменность источников, критериев, попыток и readback. Отдельно проверяется полученный материал без повторного запроса и недублирование краткого условия. Полный check и живой мобильный readback являются обязательным условием выпуска; сам документ не утверждает deployment.

## Согласование {#authorization}

Прямой запрос родителя16.11: «единая система», «ГРАФ, К РЕБРАМ … К УЗЛАМ подвязаны макеты», «любой предмет», «просить загрузить только … если … нету», объяснить что есть и почему не хватает. Это исправление показанного дефекта в согласованных ролях и действиях, не новый поток или расписание.
