---
id: decision.scoped-learner-flow-2026-10-21
type: decision
status: accepted
implementation: implemented
created: 2026-10-21
updated: 2026-10-21
parent: module.reviews.subject-aware-guidance
uses: []
consumers:
  - Education learner
  - Education operator
code:
  - "day/learner-flow.mjs"
  - "day/source-only.mjs"
  - "day/data-contract.mjs"
  - "scripts/day.mjs"
  - "src/lib/dayStore.ts"
  - "src/DayPage.tsx"
  - "src/components/LearnerFlow.tsx"
  - "src/components/LearnerFlow.css"
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---
# Публичная поддержка подтверждённой части задания

## Основание

Родитель прямо попросил исследовать методики и опубликовать ребёнку пошаговую учебную помощь внутри английской карточки. Подтверждённый SB31 упр.5 оставался без помощи из-за общего sourceOnly-блока недоступных WB15–16. British Council Role-play и EEF Metacognition обосновывают подготовку речевых опор, планирование и самопроверку; конкретный маршрут — адаптация оператора к оригиналу.

## Было → стало

Было: только исходная запись и страница. Стало: отдельный явно публичный learnerFlow с областью, дословной выдержкой МЭШ, привязанной страницей и границей. Родительский ключ не используется. sourceOnly, needs-review и исходное задание остаются. Один этап и два добровольных уровня опоры, без автоматического вердикта. Документированный контракт: [subject-aware-guidance](../modules/reviews/subject-aware-guidance.md#learner-flow).

Затронуты day/learner-flow.mjs, day/source-only.mjs, day/data-contract.mjs, scripts/day.mjs, src/lib/dayStore.ts, src/DayPage.tsx, src/components/LearnerFlow.tsx и src/components/LearnerFlow.css. При смене содержимого flow компонент получает новую содержательную identity и сбрасывает локальный этап.

## Действия и роли

Обе роли читают только публичный процесс. Прежние приватные guides исключаются штатной проекцией. «Следующий шаг» не записывает выполнение/оценку. sourceOnly по-прежнему запрещает steps, submission, parentGuide и тесты; единственное дополнение — строгий scoped learnerFlow, не утверждающий готовность недоступной части. Publication validator проверяет pageId по taskPages; семантику цитаты сверяет оператор по изображению.

## Проверки

day/learner-flow.test.mjs: mixed-source блок сохраняется, приватный guide исключён, чужая страница/выдуманный scope/закрытые поля отвергаются. src/components/LearnerFlow.test.tsx: один видимый этап, закрытые уровни, сброс раскрытия и отсутствие оценки. Дополнительно source-only/data-contract, общий check:spec, typecheck, lint, полный test и build; публикация и UI readback выполняются отдельно.

## Согласование

Прямой запрос родителя 21.10.2026: исследовать методики, подготовить пошаговую учебную помощь и опубликовать её внутри карточки ребёнка. Дополнительное подтверждение для стандартной публикации этой помощи не требуется. Изменение не объявляется выпущенным до Pages/data readback.
