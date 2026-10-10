# Карта спецификаций Education

Каждый контракт описывает одну границу продукта и остаётся короче 500 строк. Это **граф**, а не один документ, в который копируется всё. [Карта всех файлов](file-map.md) связывает каждый файл с ближайшим контрактом, причиной существования и потребителем; `npm run check:spec` не даёт оставить новый файл без этой связи. Точечные JSDoc `@see` дополнительно ведут от сложной логики к конкретному правилу. Контракт может описывать целевую часть, поэтому состояние реализации проверяется отдельно.

```mermaid
flowchart LR
  Access[Доступ и состояние] --> Day[Страница дня]
  Plan[Формирование плана] --> Day
  Diary[Порт дневника] --> Plan
  Access --> Dashboard[Dashboard]
  Dashboard --> Day
  Dashboard --> Grades[Оценки]
  Access --> Quiz[Тесты]
  Day --> Quiz
  Day --> Materials[Материалы]
  Day --> Grades[Оценки]
  Materials --> Storage[Хранение и приватность]
  Day --> Storage
  Adaptive[Адаптивная карточка задачи] --> Day
  Adaptive --> Materials
  Diary[Порт дневника] --> Day
  Diary --> Dashboard
  Family[Семья и доступ] --> Access
  Family --> UI[Экраны из данных]
  Family --> Activity[Действия и новое]
  UI --> Dashboard
  UI --> Day
  Activity --> Dashboard
  PWA[Приложение на телефоне] --> Access
  PWA --> Activity
```

| Контракт | Что определяет | Основные модули |
|---|---|---|
| [Доступ и состояние](access-and-state.md) | Маршруты, роли, документы Firestore, повторный выпуск | `src/App.tsx`, `src/lib/store.ts`, `src/lib/dayStore.ts`, `day/merge.mjs` |
| [Страница дня](day-page.md) | Дата ДЗ, карточки, фото, связь теста с предметом и свёрнутый завершённый лист | `src/DayPage.tsx`, `src/WeekendMathSlot.tsx`, `src/components/ProblemGroup.tsx`, `day/build.mjs`, `scripts/day.mjs` |
| [Адаптивная карточка задачи](adaptive-problem-card.md) | Точный оригинал, отдельные ориентиры, свидетельства навыка и запрос помощи | `src/components/ProblemStatement.tsx`, `src/lib/dayStore.ts`, `src/WeekendMathSlot.tsx`, `src/DayPage.tsx`, `scripts/day.mjs` |
| [Формирование плана](plan-generation.md) | Граница точной записи МЭШ, проверенного разбора и неопределённости | `day/build.mjs`, `scripts/day.mjs`, `src/DayPage.tsx` |
| [Многодневный dashboard](dashboard.md) | Полоса дат, сводки и контракт будущей многодневной синхронизации | `src/DayDashboard.tsx`, `src/lib/dayDashboardStore.ts`, `day/dashboard-index.mjs`; многодневная синхронизация и полная история версий ДЗ ещё не реализованы |
| [Тесты](quizzes.md) | Попытка, сохранение, результат, списки | `src/App.tsx`, `src/components/SubjectTheme.tsx`, `src/lib/quiz.ts` |
| [Материалы](materials.md) | Точный источник, страницы, ридер | `src/components/MaterialReader.tsx`, `src/lib/yandexPublic.ts`, `storage/material-pages.mjs` |
| [Средний балл](grades.md) | Метка, условный сценарий и границы точности | `src/DayPage.tsx` |
| [Хранение и приватность](storage-privacy.md) | Прямая загрузка на Диск, метаданные в Firebase, миграция старых копий | `scripts/direct-upload-worker.mjs`, `src/lib/photoOutbox.ts`, `scripts/storage.mjs` |
| [Доступ к архиву семей](../architecture/family-artifact-access.md) | Общие оригиналы, ссылки и будущий журнал всех открытий | `storage/yandex-disk.mjs`; постоянно доступный шлюз ещё не реализован |
| [Порт дневника](../architecture/school-diary-port-adapter.md) | Изоляция МЭШ, семейные правила видимости | `diary/`, `scripts/day.mjs` |
| [Семья и доступ](../architecture/family-data-model.md) | Семьи, роли, дети, источник истины и перенос ссылочной модели | `src/lib/educationSchema.ts`, `firestore.rules` |
| [Экраны из данных](../architecture/backend-driven-ui.md) | Безопасный манифест и реестр блоков вместо статичного макета | `src/lib/educationSchema.ts`, `src/components/EducationScreen.tsx` |
| [Действия и новое](../architecture/activity-and-inbox.md) | Журнал посещений, ревизии просмотра и адресные уведомления | `src/lib/educationStore.ts`, `firestore.rules` |
| [Приложение на телефоне](pwa.md) | Установка на iPhone, обновление кода, кеш и граница push | `src/lib/pwa.ts`, `pwa/sw-template.js`, `scripts/generate-sw.mjs` |
| [Карта файлов](file-map.md) | Назначение, потребитель и контракт каждого файла | `scripts/check-spec-map.mjs` |

## Сверка реализации на 10.10.2026

| Контракт | Действующий путь | Открытая часть |
|---|---|---|
| [День и тесты](day-page.md), [тесты](quizzes.md) | `dayPages`, фото, разбор и попытки читаются через `onSnapshot`; новое содержание приходит без выпуска PWA | Новые виды компонентов требуют выпуска движка |
| [Фото и Диск](storage-privacy.md) | Новое фото идёт из IndexedDB прямо на Диск; Firestore хранит метаданные; локальный worker подтверждает файл | Реальная съёмка на iPhone ещё не проверена; без Mac передача ждёт его запуска и повторного открытия страницы |
| [Нумерованные листы](adaptive-problem-card.md) | Исходный лист один, фрагменты по координатам и фото каждого номера работают в `DayPage` и `WeekendMathSlot` | Разметка следующего листа выполняется оператором как данные |
| [Семья](../architecture/family-data-model.md) | Личные ссылки, роли, начальный dashboard и переходные документы работают | Перенос дней, тестов и оценок в документы v2 ещё не завершён |
| [Манифест экрана](../architecture/backend-driven-ui.md) | Типы, подписка и компонент подготовлены | Текущие маршруты дня и dashboard к нему не подключены |
| [Действия и новое](../architecture/activity-and-inbox.md) | Типы и методы записи подготовлены | Страницы их не вызывают; уведомления и журнал навигации не работают |
| [Многодневный МЭШ](dashboard.md) | Ролевой индекс сохранённых дней и живые статусы работают | Полный будущий горизонт и автоматическое снятие отменённого ДЗ не реализованы |
| [Архив семей](../architecture/family-artifact-access.md) | Новые оригиналы лежат на Диске | Постоянный медиа-шлюз, отзыв пересланных файловых ссылок и полный журнал открытий ещё не реализованы |

Семейные планы, токены, снимки дневника, фото работ и привязки конкретных учебников лежат в закрытом локальном проекте или на Яндекс.Диске; эта карта не содержит их. Публичный исходный репозиторий и ветка сайта не должны содержать сами изображения. Перед выпуском проверяются и текущие файлы, и история Git: удаление файла новым коммитом не удаляет его из старых коммитов.
