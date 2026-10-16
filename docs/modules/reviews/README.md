---
id: module.reviews
status: accepted
implementation: partial
parent: product.education
uses:
  - module.assessments
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
  - "review operator"
  - "submission publisher"
code:
  - "scripts/submissions.mjs"
---

# Разбор учебных работ

Сверяет видимую попытку с доказуемыми критериями и источником, сохраняет покрытие снимка и выдаёт адресную обратную связь. Неизображённое на фото остаётся неизвестным.

## Код и данные

| Код | Вход → результат | Контракт |
|---|---|---|
| [`storage/review-projection.mjs`](../../../storage/review-projection.mjs) | закрытая проверка → безопасная проекция для семьи | [subject-aware-guidance.md](subject-aware-guidance.md) |
| [`src/components/QuizAttemptReview.tsx`](../../../src/components/QuizAttemptReview.tsx) | загруженная попытка → доступный разбор известных ошибок | [../assessments/quiz-chain-proposal.md](../assessments/quiz-chain-proposal.md) |

## Спецификации

- [adaptive-problem-card](adaptive-problem-card.md)
- [card-flow-certification](card-flow-certification.md)
- [card-generation-policy](card-generation-policy.md)
- [math-solution-route](math-solution-route.md)
- [review-criteria-provenance](review-criteria-provenance.md)
- [russian-language-route](russian-language-route.md)
- [special-course-card-overlay](special-course-card-overlay.md)
- [subject-aware-guidance](subject-aware-guidance.md)
- [subject-card-viewmodel](subject-card-viewmodel.md)
