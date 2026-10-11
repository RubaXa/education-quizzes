# Карта файлов, контрактов и потребителей

Это индекс **каждого файла исходного репозитория**. В первом столбце — сам файл, во втором — ближайшая действующая спецификация, затем причина существования и потребитель. Перед изменением файла открой его строку и контракт; при добавлении, удалении или смене назначения обнови строку. `npm run check:spec` проверяет полноту и существование ссылок; он не заменяет смысловую сверку требований с кодом.

Статус архитектурных решений проверяй по разделам «Состояние реализации» самих контрактов. В частности, [семейная модель](../architecture/family-data-model.md#implementation), [экраны из данных](../architecture/backend-driven-ui.md#implementation), [журнал действий](../architecture/activity-and-inbox.md#implementation) и [масштабируемый архив](../architecture/family-artifact-access.md) содержат целевые части, ещё не подключённые к текущим маршрутам. Сам факт наличия типа или компонента не означает, что пользовательский путь работает.

| Файл | Спецификация | Зачем существует | Потребитель |
|---|---|---|---|
| [.env.example](../../.env.example) | [Порт дневника](../architecture/school-diary-port-adapter.md) | Шаблон локальной конфигурации интеграции | Оператор CLI |
| [.firebaserc](../../.firebaserc) | [Семейная модель](../architecture/family-data-model.md) | Идентификатор проекта Firebase для команд | Firebase CLI |
| [.gitignore](../../.gitignore) | [Хранение и приватность](storage-privacy.md) | Исключение секретов и локальных оригиналов | Git; проверка приватности |
| [.oxlintrc.json](../../.oxlintrc.json) | [Карта спецификаций](README.md) | Правила статического анализа кода | oxlint |
| [AGENTS.md](../../AGENTS.md) | [Карта спецификаций](README.md) | Рабочие ограничения для следующих сессий | Агент Codex |
| [README.md](../../README.md) | [Карта спецификаций](README.md) | Вход в репозиторий и команды | Разработчик; агент |
| [commitlint.config.cjs](../../commitlint.config.cjs) | [Карта файлов](file-map.md) | Формат истории изменений | commitlint |
| [components.json](../../components.json) | [Экраны из данных](../architecture/backend-driven-ui.md) | Настройки базовых UI-компонентов | Генератор компонентов |
| [day/build.mjs](../../day/build.mjs) | [Формирование плана](plan-generation.md) | Точная запись МЭШ и отделение ссылки на файл от действия | `scripts/day.mjs` |
| [day/dashboard-index.mjs](../../day/dashboard-index.mjs) | [Dashboard](dashboard.md) | Индекс дат и ближайших заданий | `scripts/day.mjs` |
| [day/merge.mjs](../../day/merge.mjs) | [Формирование плана](plan-generation.md) | Слияние без потери работы и удаление доказанной ссылки из списка действий | `scripts/day.mjs` |
| [day/merge.test.mjs](../../day/merge.test.mjs) | [Доступ и состояние](access-and-state.md) | Проверка сохранности при слиянии дня | Vitest; разработчик |
| [diary/adapters/mesh.mjs](../../diary/adapters/mesh.mjs) | [Порт дневника](../architecture/school-diary-port-adapter.md) | Получение данных МЭШ | Синхронизатор дневника |
| [diary/application/diff.mjs](../../diary/application/diff.mjs) | [Порт дневника](../architecture/school-diary-port-adapter.md) | Различия двух снимков дневника | `diary/cli.mjs` |
| [diary/application/lesson-visibility.mjs](../../diary/application/lesson-visibility.mjs) | [Порт дневника](../architecture/school-diary-port-adapter.md) | Семейные исключения из расписания | Синхронизатор дневника |
| [diary/application/sync.mjs](../../diary/application/sync.mjs) | [Порт дневника](../architecture/school-diary-port-adapter.md) | Сбор и сохранение снимка МЭШ | `diary/cli.mjs` |
| [diary/attachments.mjs](../../diary/attachments.mjs) | [Материалы](materials.md) | Извлечение вложений учителя | `diary/cli.mjs`; план дня |
| [diary/cli.mjs](../../diary/cli.mjs) | [Порт дневника](../architecture/school-diary-port-adapter.md) | Командный вход синхронизации МЭШ | Оператор; `scripts/day.mjs` |
| [diary/config.mjs](../../diary/config.mjs) | [Порт дневника](../architecture/school-diary-port-adapter.md) | Конфигурация и выбор ученика | Модули дневника |
| [diary/local-store.mjs](../../diary/local-store.mjs) | [Порт дневника](../architecture/school-diary-port-adapter.md) | Закрытые снимки дневника | Синхронизатор; план дня |
| [docs/architecture/activity-and-inbox.md](../architecture/activity-and-inbox.md) | [Действия и новое](../architecture/activity-and-inbox.md) | Контракт событий и уведомлений | Агент; разработчик |
| [docs/architecture/backend-driven-ui.md](../architecture/backend-driven-ui.md) | [Экраны из данных](../architecture/backend-driven-ui.md) | Контракт манифеста интерфейса | Агент; разработчик |
| [docs/architecture/change-detection-and-reconciliation.md](../architecture/change-detection-and-reconciliation.md) | [Обнаружение и сверка изменений](../architecture/change-detection-and-reconciliation.md) | Ручная сверка и будущий наблюдатель изменений | Агент; разработчик |
| [docs/architecture/family-artifact-access.md](../architecture/family-artifact-access.md) | [Архив семей](../architecture/family-artifact-access.md) | Будущий доступ к общим оригиналам | Агент; разработчик |
| [docs/architecture/family-data-model.md](../architecture/family-data-model.md) | [Семейная модель](../architecture/family-data-model.md) | Роли, документы и этапы миграции | Агент; разработчик |
| [docs/architecture/school-diary-port-adapter.md](../architecture/school-diary-port-adapter.md) | [Порт дневника](../architecture/school-diary-port-adapter.md) | Граница получения данных МЭШ | Агент; разработчик |
| [docs/product/README.md](README.md) | [Карта спецификаций](README.md) | Навигация между контрактами | Агент; разработчик |
| [docs/product/access-and-state.md](access-and-state.md) | [Доступ и состояние](access-and-state.md) | Текущие маршруты и владение состоянием | Агент; разработчик |
| [docs/product/adaptive-problem-card.md](adaptive-problem-card.md) | [Адаптивная карточка](adaptive-problem-card.md) | Оригинал, помощь и попытки по номеру | Агент; разработчик |
| [docs/product/review-criteria-provenance.md](review-criteria-provenance.md) | [Основания проверки](review-criteria-provenance.md) | Проверяемое требование, источник, запись и предел вердикта | Агент; `scripts/submissions.mjs`; `WorkReview` |
| [docs/product/dashboard.md](dashboard.md) | [Dashboard](dashboard.md) | Сводки дней, оценок и заданий | Агент; разработчик |
| [docs/product/day-page.md](day-page.md) | [Страница дня](day-page.md) | Показ и проверка ДЗ | Агент; разработчик |
| [docs/product/file-map.md](file-map.md) | [Карта файлов](file-map.md) | Индекс назначения каждого файла | Агент; проверка карты |
| [docs/product/grades.md](grades.md) | [Оценки](grades.md) | Показ оценок и границы расчёта | Агент; разработчик |
| [docs/product/materials.md](materials.md) | [Материалы](materials.md) | Источники, страницы и ридер | Агент; разработчик |
| [docs/product/plan-generation.md](plan-generation.md) | [Формирование плана](plan-generation.md) | Проверка происхождения пунктов ДЗ | Агент; разработчик |
| [docs/product/protocol-audit-2026-10-11.md](protocol-audit-2026-10-11.md) | [Карта спецификаций](README.md) | Сверка договорённостей с навыками, кодом и пробелами | Следующая сессия; разработчик |
| [docs/product/pwa.md](pwa.md) | [PWA](pwa.md) | Установка, кэш и выпуск приложения | Агент; разработчик |
| [docs/product/quizzes.md](quizzes.md) | [Тесты](quizzes.md) | Попытки, ключи и результаты | Агент; разработчик |
| [docs/product/storage-privacy.md](storage-privacy.md) | [Хранение и приватность](storage-privacy.md) | Фото, Диск и запрет бинарных данных в Firebase | Агент; разработчик |
| [docs/research/adaptive-problem-critical-review.md](../research/adaptive-problem-critical-review.md) | [Адаптивная карточка](adaptive-problem-card.md) | Критическая сверка педагогической модели | Агент при изменении помощи |
| [docs/research/adaptive-problem-scaffolding.md](../research/adaptive-problem-scaffolding.md) | [Адаптивная карточка](adaptive-problem-card.md) | Исследование ступенчатой помощи | Агент при изменении помощи |
| [docs/research/condition-transcript-and-scaffold.md](../research/condition-transcript-and-scaffold.md) | [Адаптивная карточка](adaptive-problem-card.md) | Основание показа точного условия | Агент при изменении карточки |
| [docs/research/feedback-after-errors.md](../research/feedback-after-errors.md) | [Тесты](quizzes.md) | Основание и границы обратной связи без готового ответа | Агент; результат теста и проверки фото |
| [docs/research/evidence-based-homework-review.md](../research/evidence-based-homework-review.md) | [Основания проверки](review-criteria-provenance.md) | Аудит источников и спорного порога для упр. 169 | Агент проверки; спецификация критериев |
| [docs/research/photo-math-solution-review.md](../research/photo-math-solution-review.md) | [Адаптивная карточка](adaptive-problem-card.md) | Основание проверки хода решения | Агент при изменении разбора |
| [docs/research/special-course-source-provenance.md](../research/special-course-source-provenance.md) | [Адаптивная карточка](adaptive-problem-card.md) | Поиск прототипов, вариантов, ключей и критериев спецкурса | Агент подготовки; проверяющий; родительский обзор |
| [firebase.json](../../firebase.json) | [Семейная модель](../architecture/family-data-model.md) | Настройки публикации правил Firestore | Firebase CLI |
| [firestore.rules](../../firestore.rules) | [Страница дня](day-page.md) | Права на семейные и переходные документы, на решение родителя | Firebase; клиент |
| [index.html](../../index.html) | [PWA](pwa.md) | HTML-точка входа приложения | Браузер; Vite |
| [lefthook.yml](../../lefthook.yml) | [Карта файлов](file-map.md) | Проверки перед коммитом и push | Git hooks |
| [package-lock.json](../../package-lock.json) | [Карта файлов](file-map.md) | Фиксированные версии зависимостей | npm |
| [package.json](../../package.json) | [Карта файлов](file-map.md) | Команды и зависимости сервиса | npm; агент |
| [public/icons/education-180.png](../../public/icons/education-180.png) | [PWA](pwa.md) | Иконка домашнего экрана iOS | iOS |
| [public/icons/education-192.png](../../public/icons/education-192.png) | [PWA](pwa.md) | Иконка приложения 192 px | Браузер |
| [public/icons/education-512.png](../../public/icons/education-512.png) | [PWA](pwa.md) | Иконка приложения 512 px | Браузер |
| [public/icons/education.svg](../../public/icons/education.svg) | [PWA](pwa.md) | Векторный знак Education | Браузер; PWA |
| [public/manifest.webmanifest](../../public/manifest.webmanifest) | [PWA](pwa.md) | Имя, иконки и режим установки | Браузер |
| [pwa/sw-template.js](../../pwa/sw-template.js) | [PWA](pwa.md) | Шаблон офлайн-кэша | Генератор service worker |
| [scripts/archive-local.mjs](../../scripts/archive-local.mjs) | [Хранение и приватность](storage-privacy.md) | Перенос локального архива на Диск | Оператор архива |
| [scripts/build-inputs.mjs](../../scripts/build-inputs.mjs) | [PWA](pwa.md) | Сбор списка входов для отпечатка выпуска | Сборка сайта |
| [scripts/build-site.mjs](../../scripts/build-site.mjs) | [PWA](pwa.md) | Сборка клиентского приложения | npm build |
| [scripts/check-privacy.mjs](../../scripts/check-privacy.mjs) | [Хранение и приватность](storage-privacy.md) | Запрет секретов и персональных файлов в Git | Git hooks; публикация |
| [scripts/check-spec-map.mjs](../../scripts/check-spec-map.mjs) | [Карта файлов](file-map.md) | Проверка покрытия файлов контрактами | npm check; агент |
| [scripts/day.mjs](../../scripts/day.mjs) | [Формирование плана](plan-generation.md) | Выпуск дня, перенос подтверждённого ЦДЗ между страницами одной даты и аудит ссылок | Оператор; Firestore; `src/DayDashboard.tsx`; `NotificationBell` |
| [scripts/direct-upload-worker.mjs](../../scripts/direct-upload-worker.mjs) | [Хранение и приватность](storage-privacy.md) | Выдача адреса и проверка фото на Диске | Клиент загрузки; очередь |
| [scripts/family.mjs](../../scripts/family.mjs) | [Семейная модель](../architecture/family-data-model.md) | Создание семей и личных ссылок | Оператор |
| [scripts/generate-sw.mjs](../../scripts/generate-sw.mjs) | [PWA](pwa.md) | Генерация service worker | Сборка сайта |
| [scripts/install-upload-worker.mjs](../../scripts/install-upload-worker.mjs) | [Хранение и приватность](storage-privacy.md) | Установка локального процесса загрузки | Оператор Mac |
| [scripts/publish-pages.mjs](../../scripts/publish-pages.mjs) | [PWA](pwa.md) | Публикация и сверка GitHub Pages | Оператор; браузер |
| [scripts/push-and-publish.mjs](../../scripts/push-and-publish.mjs) | [PWA](pwa.md) | Push исходников и выпуск сайта | Оператор |
| [scripts/quiz-access.mjs](../../scripts/quiz-access.mjs) | [Тесты](quizzes.md) | Проверка доступа к попытке и роли | Quiz CLI |
| [scripts/quiz-access.test.mjs](../../scripts/quiz-access.test.mjs) | [Тесты](quizzes.md) | Проверка ролевого доступа к тесту | Vitest; разработчик |
| [scripts/quiz.mjs](../../scripts/quiz.mjs) | [Тесты](quizzes.md) | Создание тестов и публикация ключей | Агент; Firestore |
| [scripts/storage.mjs](../../scripts/storage.mjs) | [Хранение и приватность](storage-privacy.md) | Перенос прежних фото и страниц | Оператор архива |
| [scripts/notifications.mjs](../../scripts/notifications.mjs) | [Центр обновлений](../architecture/activity-and-inbox.md) | Выпуск изменений продукта и сверенный backfill результата/родительского решения | Оператор; Firestore; `NotificationBell` |
| [scripts/submissions.mjs](../../scripts/submissions.mjs) | [Основания проверки](review-criteria-provenance.md) | Очередь, этапы, сверка критерия и запись разбора | Агент проверки; Firestore |
| [scripts/verify-upload-flow.mjs](../../scripts/verify-upload-flow.mjs) | [Хранение и приватность](storage-privacy.md) | Аудит ранее перенесённых фото | Оператор; агент |
| [src/App.css](../../src/App.css) | [Тесты](quizzes.md) | Оформление тестов и навигации | `src/App.tsx` |
| [src/App.tsx](../../src/App.tsx) | [Доступ и состояние](access-and-state.md) | Маршруты, тесты, личный вход и общий колокольчик | Браузер |
| [src/DayDashboard.css](../../src/DayDashboard.css) | [Dashboard](dashboard.md) | Оформление бейджей расписания и сгруппированного виджета ДЗ | `src/DayDashboard.tsx` |
| [src/DayDashboard.tsx](../../src/DayDashboard.tsx) | [Dashboard](dashboard.md) | Календарь, живые статусы ДЗ и адресные переходы | Ученик; родитель; `src/DayPage.tsx` |
| [src/DayPage.css](../../src/DayPage.css) | [Страница дня](day-page.md) | Оформление заданий и фокуса после перехода из расписания | `src/DayPage.tsx` |
| [src/DayPage.tsx](../../src/DayPage.tsx) | [Страница дня](day-page.md) | Компоновка дня из Firestore и фокус конкретного задания | Ученик; родитель; `ProblemGroup` |
| [src/WeekendMathSlot.css](../../src/WeekendMathSlot.css) | [Адаптивная карточка](adaptive-problem-card.md) | Оформление общего слота математики | `src/WeekendMathSlot.tsx` |
| [src/WeekendMathSlot.tsx](../../src/WeekendMathSlot.tsx) | [Экраны из данных](../architecture/backend-driven-ui.md) | Слот из данных ребёнка и общей карточки номера | Ученик; родитель; `ProblemGroup` |
| [src/components/ArtifactAvatar.css](../../src/components/ArtifactAvatar.css) | [Статусы фотографии](day-page.md) | Общая миниатюра и положение значка состояния | `src/components/ArtifactAvatar.tsx` |
| [src/components/ArtifactAvatar.tsx](../../src/components/ArtifactAvatar.tsx) | [Статусы фотографии](day-page.md) | Общий аватар загруженного фото с одним значком состояния | День; слот выходных |
| [src/components/CodeBlock.tsx](../../src/components/CodeBlock.tsx) | [Тесты](quizzes.md) | Показ исходного кода в вопросе | Страница теста |
| [src/components/EducationScreen.tsx](../../src/components/EducationScreen.tsx) | [Экраны из данных](../architecture/backend-driven-ui.md) | Ограниченный реестр блоков манифеста | Будущий маршрут v2 |
| [src/components/MaterialReader.tsx](../../src/components/MaterialReader.tsx) | [Материалы](materials.md) | Миниатюры и просмотр страниц | Страница дня |
| [src/components/PersonalEntry.tsx](../../src/components/PersonalEntry.tsx) | [Семейная модель](../architecture/family-data-model.md) | Вход по личной ссылке | Личная стартовая страница |
| [src/components/NotificationBell.tsx](../../src/components/NotificationBell.tsx) | [Центр обновлений](../architecture/activity-and-inbox.md) | Живая личная очередь и переход к учебному дню | `src/App.tsx`; ученик; родитель |
| [src/components/NotificationBell.css](../../src/components/NotificationBell.css) | [Центр обновлений](../architecture/activity-and-inbox.md) | Компактный колокольчик и список обновлений | `NotificationBell` |
| [src/components/ProblemCard.css](../../src/components/ProblemCard.css) | [Адаптивная карточка](adaptive-problem-card.md) | Оформление свёрнутого номера | `src/components/ProblemCard.tsx` |
| [src/components/ProblemCard.tsx](../../src/components/ProblemCard.tsx) | [Адаптивная карточка](adaptive-problem-card.md) | Номер, статус и кнопка фото | День; спецкурс |
| [src/components/ProblemGroup.css](../../src/components/ProblemGroup.css) | [Страница дня](day-page.md) | Оформление общей сводки нумерованного листа | `src/components/ProblemGroup.tsx` |
| [src/components/ProblemGroup.tsx](../../src/components/ProblemGroup.tsx) | [Страница дня](day-page.md) | Сворачивание листа и раскрытие адресного номера | `src/DayPage.tsx`; `src/WeekendMathSlot.tsx` |
| [src/components/ProblemStatement.css](../../src/components/ProblemStatement.css) | [Адаптивная карточка](adaptive-problem-card.md) | Типографика условия и ориентиров | `src/components/ProblemStatement.tsx` |
| [src/components/ProblemStatement.tsx](../../src/components/ProblemStatement.tsx) | [Адаптивная карточка](adaptive-problem-card.md) | Точное условие и помощь по запросу | Карточка номера |
| [src/components/ProblemTaskCard.tsx](../../src/components/ProblemTaskCard.tsx) | [Адаптивная карточка](adaptive-problem-card.md) | Общая композиция условия, разбора и загрузки для номера | `src/DayPage.tsx`; `src/WeekendMathSlot.tsx` |
| [src/components/PublicThumbnail.tsx](../../src/components/PublicThumbnail.tsx) | [Материалы](materials.md) | Повтор миниатюры при сетевом сбое | Фото и страницы |
| [src/components/PwaControls.css](../../src/components/PwaControls.css) | [PWA](pwa.md) | Оформление установки и обновления | `src/components/PwaControls.tsx` |
| [src/components/PwaControls.tsx](../../src/components/PwaControls.tsx) | [PWA](pwa.md) | Управление обновлением приложения | Пользователь PWA |
| [src/components/SourceFragment.css](../../src/components/SourceFragment.css) | [Адаптивная карточка](adaptive-problem-card.md) | Оформление фрагмента оригинала | `src/components/SourceFragment.tsx` |
| [src/components/SourceFragment.tsx](../../src/components/SourceFragment.tsx) | [Адаптивная карточка](adaptive-problem-card.md) | Кроп по координатам Firestore | Карточка номера |
| [src/components/SubjectTheme.tsx](../../src/components/SubjectTheme.tsx) | [Страница дня](day-page.md) | Переиспользуемые темы предметов | День; dashboard |
| [src/components/WorkReview.tsx](../../src/components/WorkReview.tsx) | [Основания проверки](review-criteria-provenance.md) | Общий источник и понятный результат проверки фото | День; спецкурс |
| [src/components/ui/badge.tsx](../../src/components/ui/badge.tsx) | [Экраны из данных](../architecture/backend-driven-ui.md) | Базовый badge | Компоненты интерфейса |
| [src/components/ui/button.tsx](../../src/components/ui/button.tsx) | [Экраны из данных](../architecture/backend-driven-ui.md) | Базовая кнопка | Компоненты интерфейса |
| [src/components/ui/card.tsx](../../src/components/ui/card.tsx) | [Экраны из данных](../architecture/backend-driven-ui.md) | Базовая карточка | Компоненты интерфейса |
| [src/components/ui/checkbox.tsx](../../src/components/ui/checkbox.tsx) | [Экраны из данных](../architecture/backend-driven-ui.md) | Базовый флажок | Компоненты интерфейса |
| [src/components/ui/input.tsx](../../src/components/ui/input.tsx) | [Экраны из данных](../architecture/backend-driven-ui.md) | Базовое поле ввода | Компоненты интерфейса |
| [src/components/ui/progress.tsx](../../src/components/ui/progress.tsx) | [Экраны из данных](../architecture/backend-driven-ui.md) | Базовая шкала прогресса | Компоненты интерфейса |
| [src/components/ui/radio-group.tsx](../../src/components/ui/radio-group.tsx) | [Экраны из данных](../architecture/backend-driven-ui.md) | Базовый выбор одного ответа | Компоненты интерфейса |
| [src/components/ui/textarea.tsx](../../src/components/ui/textarea.tsx) | [Экраны из данных](../architecture/backend-driven-ui.md) | Базовое многострочное поле | Компоненты интерфейса |
| [src/index.css](../../src/index.css) | [Экраны из данных](../architecture/backend-driven-ui.md) | Общие цвета, шрифты и сброс стилей | Всё приложение |
| [src/lib/dayDashboardStore.ts](../../src/lib/dayDashboardStore.ts) | [Dashboard](dashboard.md) | Подписка на даты, ДЗ и метку его изменения | `src/DayDashboard.tsx` |
| [src/lib/dayStore.ts](../../src/lib/dayStore.ts) | [Формирование плана](plan-generation.md) | Подписки и сопоставление результата ЦДЗ со связанными страницами дня | `src/DayPage.tsx`; `src/DayDashboard.tsx` |
| [src/lib/educationSchema.ts](../../src/lib/educationSchema.ts) | [Семейная модель](../architecture/family-data-model.md) | Типы семьи, манифеста и адресных событий | `educationStore`; `NotificationBell` |
| [src/lib/educationStore.ts](../../src/lib/educationStore.ts) | [Действия и новое](../architecture/activity-and-inbox.md) | Подписка на inbox и команды отметки прочитанного; заготовки журнала | `NotificationBell`; будущий маршрут v2 |
| [src/lib/firebase.ts](../../src/lib/firebase.ts) | [Доступ и состояние](access-and-state.md) | Подключение к Firestore | Клиентские хранилища |
| [src/lib/followup.test.ts](../../src/lib/followup.test.ts) | [Тесты](quizzes.md) | Проверка формирования продолжений | Vitest; разработчик |
| [src/lib/followup.ts](../../src/lib/followup.ts) | [Тесты](quizzes.md) | Связь повторных тестов | Страница дня; тесты |
| [src/lib/highlight.ts](../../src/lib/highlight.ts) | [Тесты](quizzes.md) | Подсветка программного кода | `CodeBlock` |
| [src/lib/personalAccess.ts](../../src/lib/personalAccess.ts) | [Семейная модель](../architecture/family-data-model.md) | Личная сессия и роли | Стартовая страница; день |
| [src/lib/photoOutbox.ts](../../src/lib/photoOutbox.ts) | [Хранение и приватность](storage-privacy.md) | Локальное хранение фото до передачи | `dayStore`; устройство |
| [src/lib/problemGroupSummary.ts](../../src/lib/problemGroupSummary.ts) | [Страница дня](day-page.md) | Проверяемая сводка номеров и уникальных фото | `src/components/ProblemGroup.tsx` |
| [src/lib/parentCompletion.ts](../../src/lib/parentCompletion.ts) | [Страница дня](day-page.md) | Отдельные события решения, проверка версии разбора и действующего статуса | День; слот выходных; dashboard; `WorkReview` |
| [src/lib/pwa.ts](../../src/lib/pwa.ts) | [PWA](pwa.md) | Регистрация service worker | `PwaControls` |
| [src/lib/quiz.test.ts](../../src/lib/quiz.test.ts) | [Тесты](quizzes.md) | Проверка оценивания вопросов | Vitest; разработчик |
| [src/lib/quiz.ts](../../src/lib/quiz.ts) | [Тесты](quizzes.md) | Модель вопросов и оценивание | Тест; Quiz CLI |
| [src/lib/quizWrite.test.ts](../../src/lib/quizWrite.test.ts) | [Тесты](quizzes.md) | Проверка записи попыток | Vitest; разработчик |
| [src/lib/quizWrite.ts](../../src/lib/quizWrite.ts) | [Тесты](quizzes.md) | Последовательная запись ответов | `src/lib/store.ts` |
| [src/lib/reviewPresentation.test.ts](../../src/lib/reviewPresentation.test.ts) | [Страница дня](day-page.md) | Проверка понятных статусов работ | Vitest; разработчик |
| [src/lib/reviewPresentation.ts](../../src/lib/reviewPresentation.ts) | [Страница дня](day-page.md) | Текст и цвет вердиктов | `WorkReview`; `ProblemCard` |
| [src/lib/useDayEvidence.ts](../../src/lib/useDayEvidence.ts) | [Формирование плана](plan-generation.md) | Подписки на фото, разборы и страницы результата той же даты сдачи | `src/DayPage.tsx`; `src/WeekendMathSlot.tsx` |
| [src/lib/useParentCompletions.ts](../../src/lib/useParentCompletions.ts) | [Страница дня](day-page.md) | Подписка на семейные решения по связанным дням | `src/DayPage.tsx`; `src/WeekendMathSlot.tsx`; `src/DayDashboard.tsx` |
| [src/lib/store.ts](../../src/lib/store.ts) | [Тесты](quizzes.md) | Подписки на попытки, ключи и списки | `src/App.tsx` |
| [src/lib/utils.ts](../../src/lib/utils.ts) | [Экраны из данных](../architecture/backend-driven-ui.md) | Слияние классов UI | Базовые компоненты |
| [src/lib/visual.test.ts](../../src/lib/visual.test.ts) | [Тесты](quizzes.md) | Проверка визуальных вопросов | Vitest; разработчик |
| [src/lib/visual.ts](../../src/lib/visual.ts) | [Тесты](quizzes.md) | Данные для визуальных вопросов | Экран теста |
| [src/lib/writeQueue.test.ts](../../src/lib/writeQueue.test.ts) | [Тесты](quizzes.md) | Проверка очереди быстрых ответов | Vitest; разработчик |
| [src/lib/writeQueue.ts](../../src/lib/writeQueue.ts) | [Тесты](quizzes.md) | Порядок записи ответов | `quizWrite` |
| [src/lib/yandexPublic.ts](../../src/lib/yandexPublic.ts) | [Материалы](materials.md) | Получение публичных превью Диска | `MaterialReader` |
| [src/main.tsx](../../src/main.tsx) | [PWA](pwa.md) | Монтирование React и стилей | Браузер |
| [storage/direct-upload.mjs](../../storage/direct-upload.mjs) | [Хранение и приватность](storage-privacy.md) | Валидация заявки и пути фото | Worker загрузки |
| [storage/direct-upload.test.mjs](../../storage/direct-upload.test.mjs) | [Хранение и приватность](storage-privacy.md) | Проверка прямой загрузки | Vitest; разработчик |
| [storage/material-pages.mjs](../../storage/material-pages.mjs) | [Материалы](materials.md) | Публикация страниц учебника на Диске | `scripts/storage.mjs` |
| [storage/storage-pause.mjs](../../storage/storage-pause.mjs) | [Хранение и приватность](storage-privacy.md) | Снятие технической паузы после сверки | `scripts/storage.mjs` |
| [storage/storage-pause.test.mjs](../../storage/storage-pause.test.mjs) | [Хранение и приватность](storage-privacy.md) | Проверка снятия паузы | Vitest; разработчик |
| [storage/inbox-notifications.mjs](../../storage/inbox-notifications.mjs) | [Центр обновлений](../architecture/activity-and-inbox.md) | Адресный выпуск и дедупликация событий | `scripts/submissions.mjs`; `scripts/notifications.mjs` |
| [storage/submission-inbox.mjs](../../storage/submission-inbox.mjs) | [Хранение и приватность](storage-privacy.md) | Группировка ожидающих работ | `scripts/submissions.mjs` |
| [storage/submission-inbox.test.mjs](../../storage/submission-inbox.test.mjs) | [Хранение и приватность](storage-privacy.md) | Проверка состава очереди | Vitest; разработчик |
| [storage/review-coverage.mjs](../../storage/review-coverage.mjs) | [Хранение и приватность](storage-privacy.md) | Сверка покрытия нескольких номеров одним оригиналом | `scripts/submissions.mjs` |
| [storage/review-coverage.test.mjs](../../storage/review-coverage.test.mjs) | [Хранение и приватность](storage-privacy.md) | Проверка явной привязки фото к номерам | Vitest; разработчик |
| [storage/submission-storage.mjs](../../storage/submission-storage.mjs) | [Хранение и приватность](storage-privacy.md) | Сверка старых файлов с Диском | `scripts/storage.mjs` |
| [storage/textbook-catalog.mjs](../../storage/textbook-catalog.mjs) | [Материалы](materials.md) | Индекс страниц и учебников | `material-pages`; день |
| [storage/yandex-disk.mjs](../../storage/yandex-disk.mjs) | [Хранение и приватность](storage-privacy.md) | Клиент API Яндекс.Диска | Worker; архив; страницы |
| [storage/yandex-disk.test.mjs](../../storage/yandex-disk.test.mjs) | [Хранение и приватность](storage-privacy.md) | Проверка запросов Диска | Vitest; разработчик |
| [tsconfig.app.json](../../tsconfig.app.json) | [PWA](pwa.md) | Типизация клиентского кода | TypeScript |
| [tsconfig.json](../../tsconfig.json) | [PWA](pwa.md) | Корневая конфигурация TypeScript | TypeScript |
| [tsconfig.node.json](../../tsconfig.node.json) | [PWA](pwa.md) | Типизация сборочных скриптов | TypeScript |
| [vite.config.ts](../../vite.config.ts) | [PWA](pwa.md) | Сборка, алиасы и ресурсы | Vite |

## Проверка после изменения

1. Обновить строку каждого добавленного, удалённого или переосмысленного файла.
2. Проверить в контракте, относится ли правило к работающему пути или к целевой архитектуре.
3. Запустить `npm run check:spec`, затем обычные проверки проекта. Если код и контракт расходятся, исправить один из них с доказательством, не объявляя запланированный модуль работающим.
