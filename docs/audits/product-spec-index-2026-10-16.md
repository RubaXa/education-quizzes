---
id: audits.product-spec-index-2026-10-16
status: reference
implementation: not-applicable
created: 2026-10-16
updated: 2026-10-16
consumers:
  - "Education operator"
  - "developer"
  - "release reviewer"
code:
  []
parent: product.education
uses:
  - audits.protocol-audit-2026-10-11
  - audits.release-inventory-2026-10-12
sections:
  - сверка-реализации-исходный-аудит-11102026-дополнено-12102026
  - уточнение-материала-ученика
---
# Карта спецификаций Education

Полная ревизия связей PETR/Education и предложение единого типизированного графа: [аудит графа спецификаций 16.10.2026](specification-graph-audit-2026-10-16.md).

[Компактная таблица тестов](../modules/assessments/quiz-chain-proposal.md) и [общая палитра результатов](../modules/assessments/result-presentation-proposal.md) приняты 16.10.2026. Первый [UI Kit](../shared/design/ui-kit.md) показывает рабочие компоненты и значения токенов. История закрыта по умолчанию; универсальный родительский запрос, включая100%, проходит единый план всей цепочки.

[Глобальная синхронизация](../modules/synchronization/global-sync.md) задаёт охват всех семей и детей, граф работ, ограниченный параллелизм, адресный статус и условия полного отчёта.
[Операторское ядро CLI](../services/operator-cli/README.md) фиксирует типизированные команды, модель входа и результата, границу агентского решения, квитанции и метрики.
[Аудит времени Education Sync 15 октября](education-sync-latency-audit-2026-10-15.md) отделяет измеренное время команд от ручной сверки и задаёт проверяемые цели 10, 5 и около 1 минуты.
[Матрица ревизий и local-first чтения](../shared/data/revisions.md) определяет, какие данные неизменяемы, кто владеет каждым каналом, когда повышается ревизия и что читает стартовый экран.
[Повторный аудит чтений Firestore 14 октября](firestore-read-audit-2026-10-14.md) сверяет фактические серии Monitoring с реестром вызовов и фиксирует неподтверждённые расходы каждого регулярного маршрута.
[Общие артефакты и семейные связи](../modules/synchronization/shared-artifact-pipeline.md) задают неизменяемые стадии, дедубликацию, границу личных данных и проекцию общего разбора на конкретное задание.
[Корневая архитектура Telegram-сервиса уведомлений](../services/telegram-bot/README.md) фиксирует порты, адаптеры, инварианты и план расширения; спецификации идентичности, outbox, доставки и источников вынесены в дочерние документы. Сервис пока не реализован.

[Семейная библиотека учебников и общий архив](../modules/materials/family-library.md) описывает загрузку PDF каждой семьёй, дедубликацию, покрытие расписания и граф источников.

[Система компонентов](../shared/design/components.md) определяет конечные роли действующих React-компонентов, границы переиспользования и проверки перед добавлением нового элемента. Её читают вместе с [моделью Firestore](../shared/data/firestore.md) и [ролевым ViewModel](../modules/reviews/subject-card-viewmodel.md), чтобы новый источник данных не породил ещё одну карточку с тем же смыслом.

[Граф выбора карточки](../modules/reviews/card-generation-policy.md) задаёт общую оболочку и выбор предметного адаптера по ожидаемому результату; [математический маршрут](../modules/reviews/math-solution-route.md) задаёт его адаптивную глубину для обычной математики и спецкурса.
[Матрица дизайн-решений задачи](../modules/reviews/problem-card-design-decisions.md) фиксирует слои и визуальные инварианты каждого компонента нумерованной карточки перед изменением интерфейса.
[Управление изменениями интерфейса](../product/ui-change-control.md) связывает действующий сценарий, компонент, CSS, тест и согласование; запечатанный реестр останавливает незаявленные правки UI в `check:spec`.
[Свежая версия переключателя](../decisions/stage-switch-fresh-version-2026-10-14.md) фиксирует проверку серверной ревизии перед семейным выбором и пределы доступной проверки.
[Прочитать все обновления](../decisions/notification-read-all-2026-10-14.md) фиксирует массовую квитанцию личного inbox и расположение действия в шапке колокольчика.
[Сертификация пути карточки](../modules/reviews/card-flow-certification.md) связывает запись МЭШ, оригинал, варианты, номера, действия, ролевую публикацию и регрессионные проверки.

[Уточнение порога 85%](../decisions/quiz-threshold-85-2026-10-14.md) заменяет прежний числовой порог самопроверки.
[Необязательная самопроверка](../modules/assessments/quizzes.md#optional-quiz) фиксирует единый родительский переключатель активного теста, сохранение выбора у исходной попытки и исключение только теста из счётчиков дня, расписания и кабинета.
[Время каждой попытки](../modules/assessments/quizzes.md#attempt-time) фиксирует значок часов в действующем общем блоке тестов, значения четырёх отметок и правило для старых записей без времени.
[Граф учебных самопроверок](../modules/assessments/assessment-decision-graph.md#decision-graph) связывает подтверждённый вид задания, обычный или контрольный тест, предметную матрицу, источники, закрытый план каждого вопроса, ручную проверку и очереди `education-sync`.

[Словарный диктант](../modules/assessments/assessment-decision-graph.md#vocabulary-dictation) задаёт открытое написание, повтор полного списка, работу над ошибками и отложенную проверку; [исследование](../research/vocabulary-dictation-practice.md) хранит первичные источники и пределы переноса.
[Сверенное чистое чтение](../modules/assessments/assessment-decision-graph.md#reading-only) автоматически попадает в очередь короткого теста; [исследование](../research/reading-only-self-checks.md) объясняет его объём и ограничения.
[Родительский вид русского языка](../modules/reviews/card-generation-policy.md#russian-adapter) работает в том же графе: устная часть переиспользует карточку теста, четыре письменных вида проходят через общую схему и компонент. [Протокол наполнения](../modules/reviews/russian-language-route.md#pipeline) задаёт источник и проверку; LLM/оператор наполняет конкретный JSON, а не меняет React. Семантическая проверка нового фото пока остаётся ручной.
[Слой листа спецкурса](../modules/reviews/special-course-card-overlay.md) добавляет правила оригинала учителя и нумерации поверх общего математического маршрута.

Каждый контракт описывает одну границу продукта и остаётся короче 500 строк. Это **граф**, а не один документ, в который копируется всё. [Карта всех файлов](../file-map.md) связывает каждый файл с ближайшим контрактом, причиной существования и потребителем; `npm run check:spec` не даёт оставить новый файл без этой связи. Точечные JSDoc `@see` дополнительно ведут от сложной логики к конкретному правилу. Контракт может описывать целевую часть, поэтому состояние реализации проверяется отдельно.

Итог сквозной проверки договорённостей и открытые расхождения — в [аудите от 11 октября](protocol-audit-2026-10-11.md).
[Инвентаризация выпуска 12 октября](release-inventory-2026-10-12.md) отделяет опубликованный сайт, живые правила и данные Firestore от накопленных исходных изменений и задаёт порядок следующих небольших выпусков.
Порядок стадий, барьеры выпуска и точки возобновления — в [сквозном протоколе Education](../modules/synchronization/education-pipeline.md).

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
| [Дизайн-система](../shared/design/README.md) | Действующая шапка, общие токены, карточки, состояния и правила для новых экранов | `src/education-design-tokens.css`, `src/App.tsx`, `src/App.css`, `src/components/ui/` |
| [Матрица статусов](../shared/design/statuses.md) | Единые значки, цветовые роли, компактный вид, полный текст и квитанция просмотра нового ДЗ | `src/components/StatusIcon.tsx`, `src/DayDashboard.tsx`, карточки и библиотека |
| [Система компонентов](../shared/design/components.md) | Почему компонент существует, кто его использует и когда вариант становится данными | `src/components/`, `src/DayPage.tsx`, `src/WeekendMathSlot.tsx` |
| [Доступ и состояние](../modules/families/access-and-state.md) | Маршруты, роли, документы Firestore, повторный выпуск | `src/App.tsx`, `src/lib/store.ts`, `src/lib/dayStore.ts`, `day/merge.mjs` |
| [Модель Firestore](../shared/data/firestore.md) | Строгие поля и владельцы v1, связи, совместимость, аудит и миграции | `day/data-contract.mjs`, `day/placement-integrity.mjs`, `scripts/day.mjs` |
| [Основания проверки](../modules/reviews/review-criteria-provenance.md) | Порядок источников, подтверждённый критерий, обязательный второй проход при сомнении, предел вердикта и спор; [методическое основание](../research/two-pass-written-work-review.md) | `scripts/submissions.mjs`, `storage/review-challenge.mjs`, `src/components/WorkReview.tsx` |
| [Страница дня](../modules/school-diary/day-page.md) | Дата ДЗ, карточки, фото, связь теста с предметом и свёрнутый завершённый лист | `src/DayPage.tsx`, `src/WeekendMathSlot.tsx`, `src/components/ProblemGroup.tsx`, `day/build.mjs`, `scripts/day.mjs` |
| [Адаптивная карточка задачи](../modules/reviews/adaptive-problem-card.md) | Точный оригинал, отдельные ориентиры, свидетельства навыка и запрос помощи | `src/components/ProblemStatement.tsx`, `src/lib/dayStore.ts`, `src/WeekendMathSlot.tsx`, `src/DayPage.tsx`, `scripts/day.mjs` |
| [Математический маршрут](../modules/reviews/math-solution-route.md) | Четыре этапа родительского решения, источник каждого перехода, выборочная помощь ребёнку и барьер следующего листа | `src/components/ParentTaskGuide.tsx`, `src/lib/dayGuidance.ts`, `day/build.mjs`, `scripts/day.mjs` |
| [Формирование плана](../modules/synchronization/plan-generation.md) | Граница точной записи МЭШ, проверенного разбора и неопределённости | `day/build.mjs`, `scripts/day.mjs`, `src/DayPage.tsx` |
| [Многодневный dashboard](../modules/school-diary/dashboard.md) | Полоса дат, сводки, [отсчёт ближайшего и текущего урока](../modules/school-diary/dashboard.md#lesson-countdowns) и контракт будущей многодневной синхронизации | `src/DayDashboard.tsx`, `src/lib/dayDashboardStore.ts`, `day/dashboard-index.mjs`; многодневная синхронизация и полная история версий ДЗ ещё не реализованы |
| [Тесты](../modules/assessments/quizzes.md) | Попытка, сохранение, результат, списки | `src/App.tsx`, `src/components/SubjectTheme.tsx`, `src/lib/quiz.ts` |
| [Материалы](../modules/materials/materials.md) | Точный источник, страницы, ридер | `src/components/MaterialReader.tsx`, `src/lib/yandexPublic.ts`, `storage/material-pages.mjs` |
| [Средний балл](../modules/school-diary/grades.md) | Метка, условный сценарий, комментарии МЭШ и единая проекция на связанных днях | `scripts/day.mjs`; `src/DayPage.tsx`; `src/DayDashboard.tsx` |
| [Хранение и приватность](../modules/materials/storage-privacy.md) | Прямая загрузка на Диск, метаданные в Firebase, миграция старых копий | `scripts/direct-upload-worker.mjs`, `src/lib/photoOutbox.ts`, `scripts/storage.mjs` |
| [Доступ к архиву семей](../modules/families/family-artifact-access.md) | Общие оригиналы, ссылки и будущий журнал всех открытий | `storage/yandex-disk.mjs`; постоянно доступный шлюз ещё не реализован |
| [Порт дневника](../modules/school-diary/README.md) | Изоляция МЭШ, локальное подключение через приглашение и семейные правила видимости | `diary/`, `packages/education-connect/`, `scripts/connect.mjs`, `src/components/ConnectionInvite.tsx`, `scripts/day.mjs` |
| [Семья и доступ](../modules/families/README.md) | Семьи, роли, дети, родительский кабинет, источник истины и перенос ссылочной модели | `src/components/ParentHome.tsx`, `src/lib/useParentChildOverview.ts`, `scripts/family.mjs`, `scripts/connect.mjs`, `firestore.rules` |
| [Экраны из данных](../modules/synchronization/backend-driven-ui.md) | Инвариант движка, общие подписки и будущий безопасный манифест | `src/lib/useDayEvidence.ts`, `src/components/ProblemTaskCard.tsx`, `src/lib/educationSchema.ts`, `src/components/EducationScreen.tsx` |
| [Local-first через горячие пути](../decisions/local-first-hot-path-decision-2026-10-12.md) | Сокращение реальных чтений, локальный показ, выбор кеша и библиотек по маршруту | Действующий порядок исследования; рабочие экраны ещё читают Firestore напрямую |
| [Поэтапный план local-first](../plans/local-first-release-plan-2026-10-12.md) | Порог 20% для маршрута, измерения до/после, условия выпуска и отката | Родительский кабинет; материалы; день; EducationSync |
| [Расширенный протокол синхронизации](../services/web-app/local-first-sync.md) | Возможные семейные каналы, ревизии, delta-пакеты и безопасный перенос попыток | Условный вариант для маршрутов, где будет доказана выгода |
| [Действия и новое](../modules/notifications/inbox.md) | Журнал посещений, ревизии просмотра и адресные уведомления | `src/lib/educationStore.ts`, `firestore.rules` |
| [Обнаружение и сверка изменений](../modules/synchronization/change-detection-and-reconciliation.md) | Сигнал Firebase, проверка МЭШ, очередь фото, восстановление процесса и граница пробуждения агента | `diary/application/sync.mjs`, `scripts/submissions.mjs`; автономный наблюдатель ещё не реализован |
| [Telegram-сервис уведомлений](../services/telegram-bot/README.md) | Порты, доменные события, адаптеры источников и Telegram, расширение по модулям и граница реализации | Будущий Node.js worker; сейчас только спецификация |
| [Приложение на телефоне](../product/pwa.md) | Установка на iPhone, обновление кода, кеш и граница push | `src/lib/pwa.ts`, `pwa/sw-template.js`, `scripts/generate-sw.mjs` |
| [Карта файлов](../file-map.md) | Назначение, потребитель и контракт каждого файла | `scripts/check-spec-map.mjs` |
| [Сквозной протокол](../modules/synchronization/education-pipeline.md) | Инварианты между МЭШ, Диском, Firestore, разбором и ролями | `diary/application/sync.mjs`, `scripts/day.mjs`, `scripts/submissions.mjs`, `skills/education-sync` |

## Сверка реализации (исходный аудит 11.10.2026, дополнено 12.10.2026)

| Контракт | Действующий путь | Открытая часть |
|---|---|---|
| [День и тесты](../modules/school-diary/day-page.md), [тесты](../modules/assessments/quizzes.md) | `dayPages`, фото, разбор и попытки читаются через `onSnapshot`; новое содержание приходит без выпуска PWA | Новые виды компонентов требуют выпуска движка |
| [Фото и Диск](../modules/materials/storage-privacy.md) | Новое фото идёт из IndexedDB прямо на Диск; Firestore хранит метаданные; локальный worker подтверждает файл | Реальная съёмка на iPhone ещё не проверена; без Mac передача ждёт его запуска и повторного открытия страницы |
| [Нумерованные листы](../modules/reviews/adaptive-problem-card.md) | Исходный лист один, фрагменты по координатам, общие фото, разбор и карточка номера работают в `DayPage` и `WeekendMathSlot`; текст листа берётся из Firestore | Разметка следующего листа выполняется оператором как данные |
| [Семья](../modules/families/README.md) | Личные ссылки, роли, кабинет взрослого, карточки детей и управление приглашениями и ссылками работают на опубликованном сайте; вход обеих ролей проверен на живом Firestore | Подробные дни, тесты и оценки ещё используют прежние документы первого ребёнка; генератор нового ребёнка требует изолированного контекста `(familyId, childId, sourceAccountId)` |
| [Семейная библиотека](../modules/materials/family-library.md) | Кабинет показывает только книги семьи, отличает подтверждённое издание от предварительного; страницы 10 связанных PDF опубликованы и доступны через семейную проекцию общего индекса | Постоянный приёмник PDF зависит от локального Mac; точные издания некоторых предметов ещё не подтверждены; проверка полноты семейной проекции остаётся обязательной при новых загрузках |
| [Манифест экрана](../modules/synchronization/backend-driven-ui.md) | Типы, подписка и компонент подготовлены | Текущие маршруты дня и dashboard к нему не подключены |
| [Действия и новое](../modules/notifications/inbox.md) | Личный inbox и колокольчик показывают изменение ДЗ, новую оценку, разбор и уточнение работы, родительский зачёт и выпуск продукта | Сбор посещений и системный Web Push пока не работают |
| [Обнаружение и сверка изменений](../modules/synchronization/change-detection-and-reconciliation.md) | Есть ручные `diary sync`, `submissions inbox`, публикация дня и живые подписки клиента | Автономный наблюдатель с курсором, атомарная аренда разбора и пробуждение сессии не реализованы |
| [Многодневный МЭШ](../modules/school-diary/dashboard.md) | Ролевой индекс сохранённых дней и живые статусы работают | Полный будущий горизонт и автоматическое снятие отменённого ДЗ не реализованы |
| [Архив семей](../modules/families/family-artifact-access.md) | Новые оригиналы лежат на Диске | Постоянный медиа-шлюз, отзыв пересланных файловых ссылок и полный журнал открытий ещё не реализованы |

Семейные планы, токены, снимки дневника, фото работ и привязки конкретных учебников лежат в закрытом локальном проекте или на Яндекс.Диске; эта карта не содержит их. Публичный исходный репозиторий и ветка сайта не должны содержать сами изображения. Перед выпуском проверяются и текущие файлы, и история Git: удаление файла новым коммитом не удаляет его из старых коммитов.


[UI Kit](../shared/design/ui-kit.md) — отдельная страница `#/ui-kit`, первый общий набор индикаторов и текущий каталог токенов; [исследование структуры](../research/ui-kit-structure.md). [Цветовой контракт](../modules/assessments/result-presentation-proposal.md) принят; [компактная таблица](../modules/assessments/quiz-chain-proposal.md) утверждена отдельно от ещё проектируемого итогового режима теста.

## Уточнение материала ученика

[Общий контракт](../modules/materials/material-clarification.md): адресный вопрос в карточке, стандартная загрузка ребёнка, анализ источника без оценки ДЗ и проверка следующей синхронизацией. UI Kit показывает реальный компонент с локальным выбором файлов.
