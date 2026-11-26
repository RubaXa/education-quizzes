---
id: decision.marked-work-sheet-2026-11-26
status: accepted
implementation: partial
created: 2026-11-26
updated: 2026-11-26
parent: module.reviews
uses:
  - module.reviews.marked-work-sheet
consumers:
  - Ребёнок и родитель
code: []
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---
# Письменная работа как лист с пометками

## Основание
Родитель26.11 одобрил интерактивный макет на вчерашнем английском и прямо попросил внедрение, обе роли и выпуск с проверкой iPhone.

## Было → стало
Проза о фрагменте без наглядной связи → оригинал, распознанный лист и адресные кнопки-пометки. На телефоне комментарий раскрывается после абзаца; боковой колонки нет. Старые observations честно обозначены фрагментами. Полный лист подготавливает проверяющий по оригиналу, клиент не изобретает OCR.

## Действия и роли
Обе роли читают безопасный лист; полный родительский путь и диалог остаются отдельно. История, результаты и фотографии сохраняются. Клик не оценивает работу. Адресная публикация листа допускает verified и не меняет часы текущего диалога; прежний лист архивируется как коррекция представления.

## Проверки
Схема и вложенные поля, чужой upload, CAS, две роли и неизменность оценки/истории; интерактив WorkReview в jsdom. Production CSS проверяется320/375/390/430px; клавиатура и живой семейный английский — отдельно. Полный npm run check обязателен до прямого main и выпуска Pages.

## Согласование
Прямое решение пользователя26.11.2026: «Да, такой разбор понятнее. Внедри его для письменных работ… проверь у ребёнка и родителя и выпусти», с отдельным требованием iPhone. Макет одобрен в этом чате; дополнительного ревью не требуется.

Файлы реализации:
- `day/decision-registry.mjs`
- `packages/education-presentation/review-content.mjs`
- `scripts/check-review-brief-viewport.mjs`
- `scripts/review-presentation.mjs`
- `src/components/ReviewBriefShowcase.tsx`
- `src/components/WorkReview.tsx`
- `storage/review-presentation-edit.mjs`
- `storage/review-projection.mjs`
- `storage/tutoring-decision.mjs`
- `packages/education-presentation/marked-work-sheet.mjs`
- `src/components/WrittenReviewSheet.tsx`
- `src/components/WrittenReviewSheet.css`
- `src/ui-kit/WrittenReviewSheetExample.tsx`

- `src/DayPage.tsx` — тот же лист в родительском learning-route без дублирования вердикта.
