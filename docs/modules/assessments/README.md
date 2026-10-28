---
id: module.assessments
status: accepted
implementation: partial
parent: product.education
uses:
  - module.reviews
  - module.materials
  - shared.data.firestore
sections:
  - код-и-данные
  - спецификации

created: 2026-10-16
updated: 2026-10-16
consumers:
  - "student"
  - "parent"
  - "quiz author"
  - "assessment pipeline"
code:
  - "src/lib/quiz.ts"
---

# Оценивание и самопроверки

Создаёт связанные диагностические и предметные проверки по назначенным источникам, сохраняет происхождение ответа, попытки и результат. Самопроверка не подменяет проверку письменной работы.

## Код и данные

| Код | Вход → результат | Контракт |
|---|---|---|
| [`src/lib/quiz.ts`](../../../src/lib/quiz.ts) | опубликованная проверка и попытка → ученический quiz flow | [quizzes.md](quizzes.md) |
| [`src/lib/resultPresentation.ts`](../../../src/lib/resultPresentation.ts) | результат с исходной точностью → общий вид результата | [result-presentation-proposal.md](result-presentation-proposal.md) |

## Спецификации

- [assessment-decision-graph](assessment-decision-graph.md)
- [assessment-source-policy](assessment-source-policy.md)
- [quiz-chain-proposal](quiz-chain-proposal.md)
- [olympiad-preparation](olympiad-preparation.md) — проект подготовки, игровых уроков и родительского обзора; не реализован
- [quizzes](quizzes.md)
- [result-presentation-proposal](result-presentation-proposal.md)
