---
id: decision.released-stage-parity-2026-10-20
status: accepted
implementation: implemented
created: 2026-10-20
updated: 2026-10-20
parent: module.reviews.subject-aware-guidance
consumers:
  - "student"
  - "parent"
  - "Education operator"
uses:
  - module.reviews.subject-aware-guidance
  - shared.design
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
  - затронутые-файлы
code:
  - "src/components/ParentTaskGuide.tsx"
  - "src/components/ParentTaskGuide.css"
  - "src/components/TaskGuidance.tsx"
  - "src/components/TaskGuidance.css"
  - "src/components/GuidanceStageContent.tsx"
  - "src/lib/dayGuidance.ts"
  - "src/lib/dayStore.ts"
  - "src/UiKit.tsx"
  - "firestore.rules"
  - "day/guidance-release.mjs"
  - "day/guidance-repair.mjs"
  - "scripts/check-problem-variant-viewport.mjs"
  - "scripts/day.mjs"
---
# Полное раскрытие выбранного этапа

## Основание

20.10.2026 пользователь сравнил родительский экран с ученическим. В родительском гайде этап «Прямая и направления» содержит переходы ±1, ±2, ±4, ±8, ±16 дм, строку «Симметрия — Можно считать последний переход равным +16» и источник «Лист учителя №2». Ученик получал только поясняющую прозу «Шаг 1 / Показанный шаг». Запрос требует одинакового полного выбранного этапа в предпросмотре родителя и после отправки ученику.

## Было → стало

Раньше hint и reveal сохраняли одинаковую текстовую форму `text`; ученическая карточка не имела заголовка или структуры этапа. Теперь родительский предпросмотр и ученик используют общий renderer для безопасной проекции одного выбранного этапа: заголовок, ожидаемая запись, строки, роль, причина и короткая подпись источника. `revealPreview` также сохраняется как полезное пояснение. Подсказка остаётся выбранной прозой. Legacy события без проекции продолжают показывать исходный текст.

## Действия и роли

`projectGuidanceReveal` allowlist-копирует только поля выбранного stage. Внутренние `source.ref`, выдержка, review labels и соседние этапы не попадают в документ ученика. Answer и проверка включаются только для выбранного `role: answer`. Правила Firestore проверяют точное равенство проекции закрытому гайду и запрещают `revealContent` у hint. ID reveal учитывает весь allowlist-снимок вместе с уровнем и прозой, поэтому изменение строки при прежней ревизии не сталкивается с предыдущим событием; сравнение содержания не зависит от порядка ключей. Hint и reveal имеют разные детерминированные ID; прежние события не перезаписываются. Ученическая карточка показывает новое событие сразу, а предыдущую помощь сохраняет под закрытым disclosure.

Также добавлена команда адресного ремонта старого prose-only reveal. Она имеет dry-run по умолчанию, проверяет выбранный документ и выполняет обратное чтение после применения.

## Проверки

`day/guidance-release.test.mjs`, `src/lib/dayGuidance.writer.test.ts`, `src/components/TaskGuidance.test.tsx`, `src/components/ParentTaskGuide.test.tsx` и пример UI Kit фиксируют allowlist, полный reveal, прозу, прежние события, freshness и уровни помощи. Мобильные ширины 320/390 проверяются существующим viewport harness.

## Согласование

Прямой пользовательский запрос от 20.10.2026 на parity полного выбранного этапа, включая приведённые строки и подпись источника. Решение заменяет прежнее более узкое правило «ученику передаётся только выбранный текст» для `reveal`; прежнее правило по-прежнему относится к `hint` и означает, что чужие/соседние этапы не раскрываются.

## Затронутые файлы

- `src/components/ParentTaskGuide.tsx`
- `src/components/ParentTaskGuide.css`
- `src/components/TaskGuidance.tsx`
- `src/components/TaskGuidance.css`
- `src/components/GuidanceStageContent.tsx`
- `src/lib/dayGuidance.ts`
- `src/lib/dayStore.ts`
- `src/UiKit.tsx`
- `firestore.rules`
- `scripts/check-problem-variant-viewport.mjs`
- `day/guidance-release.mjs`
- `day/guidance-repair.mjs`
- `scripts/day.mjs`
