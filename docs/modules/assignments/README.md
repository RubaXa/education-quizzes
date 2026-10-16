---
id: module.assignments
status: accepted
implementation: partial
parent: product.education
uses:
  - shared.data.firestore
  - module.school-diary.day-page
  - module.assessments.quizzes
  - module.reviews.review-criteria-provenance
sections:
  - проверки-и-ограничения

---

# Задание и подтверждённое состояние

Модуль связывает назначение МЭШ, карточку дня, фото, проверку и назначенный тест через устойчивые `familyId`, `childId`, `taskId` и ревизию. Владелец полного графа полей и кратностей — [Firestore](../../shared/data/firestore.md); состав пользовательской карточки — [страница дня](../school-diary/day-page.md).

| Вход | Код/выход | Инвариант |
|---|---|---|
| Подтверждённый снимок МЭШ | `day/build.mjs`, `day/merge.mjs` → `dayPages` | Переиздание сохраняет ID, фото и попытки; источник определяет обязательный объём |
| `taskId` и тест | `day/placement-integrity.mjs` → проверенная связь | `testToken`, placement и реальное назначение согласованы |
| Фото и критерий | `storage/review-projection.mjs` → `dayProgress` | Загрузка не подтверждает освоение или выполнение всех номеров |
| Ролевой документ | `src/lib/homeworkStatus.ts` → видимый статус | Назначено, сообщено выполненным, передано, проверено и неизвестно различаются |

Словесное подтверждение допускает только reported-complete; доказательства определяют verified. Один uploadId может поддерживать несколько taskId после просмотра полного оригинала. Отмена требует полного источника и отдельной семантики: исчезновение из неполного ответа не отменяет работу.

## Проверки и ограничения

`day/data-contract.mjs`, тесты placement/merge и status projection проверяют форму и сохранение связей; содержательный критерий принадлежит [Reviews](../reviews/README.md). Полная история канонических версий задания и автоматических отмен пока не реализована; текущий ручной путь описан в [Synchronization](../synchronization/README.md).
