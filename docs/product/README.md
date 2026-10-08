# Карта спецификаций Education

Каждый контракт описывает одну границу продукта и остаётся короче 500 строк. Это **граф**, а не один документ, в который копируется всё: смежные документы ссылаются друг на друга, а код через JSDoc `@see` ведёт к ближайшему правилу.

```mermaid
flowchart LR
  Access[Доступ и состояние] --> Day[Страница дня]
  Access --> Quiz[Тесты]
  Day --> Quiz
  Day --> Materials[Материалы]
  Day --> Grades[Оценки]
  Materials --> Storage[Хранение и приватность]
  Day --> Storage
  Diary[Порт дневника] --> Day
```

| Контракт | Что определяет | Основные модули |
|---|---|---|
| [Доступ и состояние](access-and-state.md) | Маршруты, роли, документы Firestore, повторный выпуск | `src/App.tsx`, `src/lib/store.ts`, `src/lib/dayStore.ts`, `day/merge.mjs` |
| [Страница дня](day-page.md) | Дата ДЗ, карточки, фото, связь теста с предметом | `src/DayPage.tsx`, `day/build.mjs`, `scripts/day.mjs` |
| [Тесты](quizzes.md) | Попытка, сохранение, результат, списки | `src/App.tsx`, `src/components/SubjectTheme.tsx`, `src/lib/quiz.ts` |
| [Материалы](materials.md) | Точный источник, страницы, ридер | `src/components/MaterialReader.tsx`, `src/lib/yandexPublic.ts`, `storage/material-pages.mjs` |
| [Средний балл](grades.md) | Метка, условный сценарий и границы точности | `src/DayPage.tsx` |
| [Хранение и приватность](storage-privacy.md) | Яндекс.Диск, временная очередь, очистка копий | `scripts/storage.mjs`, `storage/yandex-disk.mjs`, `src/lib/dayStore.ts` |
| [Порт дневника](../architecture/school-diary-port-adapter.md) | Изоляция МЭШ, семейные правила видимости | `diary/`, `scripts/day.mjs` |

Семейные планы, токены, снимки дневника, фото работ и привязки конкретных учебников лежат в закрытом локальном проекте или на Яндекс.Диске; эта карта не содержит их. Публичный исходный репозиторий и ветка сайта не должны содержать сами изображения. Перед выпуском проверяются и текущие файлы, и история Git: удаление файла новым коммитом не удаляет его из старых коммитов.
