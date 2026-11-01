---
id: decision.quiz-runner-kit-audit-2026-11-01
status: accepted
implementation: implemented
created: 2026-11-01
updated: 2026-11-01
parent: module.assessments
uses:
  - shared.design.ui-kit
  - module.assessments.quizzes
consumers:
  - learner
  - parent
code:
  - src/App.tsx
  - src/UiKit.tsx
  - src/components/QuizCard.tsx
  - src/components/SubjectTheme.tsx
  - src/components/QuizQuestionCard.tsx
  - src/lib/wordForm.ts
  - src/ui-kit/QuizRunnerExample.tsx
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---
# Общий экран вопроса в UI Kit

## Основание

Родитель потребовал проверить эстетику настоящих тестов на телефоне по UI Kit.
История результатов уже была в каталоге; сам экран вопроса отсутствовал.

## Было → стало

`src/App.tsx` использует вынесенный без изменения логики `src/components/QuizQuestionCard.tsx`.
Общий `src/lib/wordForm.ts` сохраняет прежние склонения. `src/UiKit.tsx` показывает
`src/ui-kit/QuizRunnerExample.tsx`: настоящий компонент с пятью форматами ответа,
темой предмета, длинными подписями и режимом чтения. Пример хранит ответы локально.
`src/components/SubjectTheme.tsx` и `src/components/QuizCard.tsx` применяют существующее
форматирование только к авторскому описанию. Условия, чтение, код и ключи не меняются.

## Действия и роли

Пример не создаёт попытку и не обращается к Firebase. Роли и результаты сохраняются.
Новых обязательных учебных действий нет. Прежние зачёты не сбрасываются.

## Проверки

Компонентные проверки: форматы ответа, read-only, точный код и первоисточник,
пробелы в описании. Браузерные проверки 320, 390 и 540 пикселей: реальный вопрос,
перенос плашек, отсутствие пересечения и горизонтального выхода за экран.

## Согласование

Прямое поручение родителя01.11: проверить тесты по макетам и UI Kit, исправить
подтверждённые дефекты и влить готовое изменение в основную ветку.
