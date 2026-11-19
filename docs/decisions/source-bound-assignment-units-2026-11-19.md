---
id: decision.source-bound-assignment-units-2026-11-19
status: accepted
implementation: partial
created: 2026-11-19
updated: 2026-11-19
parent: module.assignments.source-units
uses:
  - shared.design.task-presentation
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
# Общая композиция упражнения из оригинала

## Основание
Родитель19.11 указал, что в английском несколько упражнений выглядят одним непонятным текстом, тогда как математика разбита по номерам. В действующем контракте разбиение уже обещано всем предметам, но не реализовано для обычных упражнений.

## Было → стало
Одна общая расшифровка, страницы отдельно и тест до контекста → точная запись МЭШ и свёрнутые единицы с собственными оригиналами, расшифровкой и существующими этапами/тестом. Математические номера сохраняют свой адаптер.

## Действия и роли
Родитель сохраняет закрытый путь и тумблеры этапов, ребёнок — безопасную помощь и загрузку. taskId, фото, тесты, ответы и семейные решения не заменяются. Общая старая проверка не выдаётся за доказательство каждой новой единицы.

## Проверки
RED на реальном DayPage для английского, русского и литературы; сохранение математической ветки. Оригинал раньше расшифровки, адресная принадлежность страниц и этапов, роли, CLI owner/CAS/readback, повторная публикация и изменённый источник, production CSS320px. Полный check и живое обратное чтение после выпуска. Проверка собранной литературы выявила дубль действия общего теста и лишний загрузчик чтения: отдельная RED-регрессия требует один тест и отсутствие загрузки у чистого чтения. Диапазон страниц в свёрнутом пункте показывается компактно. Интеграционный `day/mixed-assignment.test.mjs` запускает несколько настоящих CLI-процессов; воспроизведённые6–8с превышали стандартный unit timeout5с. Для этого сценария задан бюджет20с, все утверждения и публикационный барьер сохранены.

## Согласование
Прямой запрос пользователя19.11.2026: единая логика структуры карточек всех предметов с раздельными упражнениями и привязанными оригиналами. Используются действующие компоненты, новый предметный дизайн не создаётся.

Затронутые реализации:

- `day/assignment-units.mjs`
- `day/build.mjs`
- `day/data-contract.mjs`
- `day/decision-registry.mjs`
- `day/merge.mjs`
- `day/source-only.mjs`
- `packages/education-presentation/task-presentation.mjs`
- `scripts/day.mjs`
- `src/DayPage.tsx`
- `src/components/AssignmentUnits.tsx`
- `src/components/DecisionTaskDisclosure.tsx`
- `src/components/MaterialReader.tsx`
- `src/components/ProblemTaskCard.tsx`
- `src/components/TaskDisclosure.tsx`
- `src/lib/assignmentUnitView.ts`
- `src/lib/dayStore.ts`
- `src/ui-kit/AssignmentUnitsExample.tsx`
- `src/ui-kit/DecisionScenarioCatalog.tsx`
- `storage/task-presentation-edit.mjs`
