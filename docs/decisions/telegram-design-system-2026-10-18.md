---
id: decision.telegram-design-system-2026-10-18
status: accepted
implementation: not-applicable
created: 2026-10-18
updated: 2026-10-18
parent: shared.design.telegram
uses:
  - service.telegram-bot.delivery
  - service.telegram-bot.event-ledger-outbox
  - shared.design.ui-kit
consumers:
  - Education parent
  - Telegram implementer
  - UI gate
code: []
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---
# Единый дизайн Telegram и приложения Education

## Основание

Родитель18.10 сообщил, что обычный текст тяжело читать, в Telegram нет визуальной иерархии и связи с приложением. После исследования официального Bot API пользователь прямо поручил внедрить через Luna, проверить техлидом, добавить UI Kit, отправить настоящие примеры, обновить specs/tests, commit/push main.

## Было → стало

Plaintext заголовок повторял бренд, статус/предмет/задание сливались. Новая общая чистая модель задаёт смысл и иерархию, StatusIcon и Telegram используют один словарь. В Telegram — Rich Messages с безопасным HTML fallback; на сайте — preview с существующими edu tokens, без обещания точного пиксельного совпадения. Состояние получения фото остаётся ожиданием проверки. Кнопка ведёт только в доказанный канонический учебный день, либо в UI Kit для явно демонстрационного сообщения. Правила выполнения, критерии, исходники и семейная авторизация сохраняются.

## Действия и роли

Luna backend реализует shared presentation, renderer/schema/transport/outbox compatibility и безопасный navigation context. Luna UI реализует каталог и повторяемую браузерную проверку. Отдельная Luna независимо собирает факты; root проверяет код, источники требований, реальную доставку и выпуск. Root добавляет официальный operator preview через technical.probe и тот же outbox, без выдуманных школьных событий.

Затронутые runtime-файлы:

- `packages/telegram-notifications/adapters/runtime.mjs`
- `packages/telegram-notifications/adapters/source-firestore.mjs`
- `packages/telegram-notifications/adapters/telegram.mjs`
- `packages/telegram-notifications/application/notifications.mjs`
- `packages/telegram-notifications/application/probe-notifications.mjs`
- `packages/telegram-notifications/application/source-pipeline.mjs`
- `packages/telegram-notifications/domain/diff.mjs`
- `packages/telegram-notifications/domain/events.mjs`
- `packages/telegram-notifications/domain/renderer.mjs`
- `src/UiKit.tsx`
- `src/components/StatusIcon.tsx`
- `packages/education-presentation/notification.mjs`
- `scripts/check-telegram-preview-viewport.mjs`
- `scripts/telegram-design-preview.mjs`
- `src/components/TelegramNotificationPreview.css`
- `src/components/TelegramNotificationPreview.tsx`

## Проверки

Targeted tests: все шаблоны/общая модель, escaping, Unicode, даты, версии1/2, durable parts/receipts/retry, отказ схемы и неподтверждённых URL, fallback только по однозначному unsupported-method. UI Kit показывает условные данные и не выполняет семейных сетевых чтений. Браузер проверяет320/390/540px и short/long/no-context, отсутствие overflow/внешних запросов. Изолированный полный check814tests/161files, typecheck/build, spec/link/read registry/lint прошёл. Браузер проверил все9сочетаний320/390/540px × short/long/no-context; root просмотрел снимок390px, двойной значок убран. Независимая Luna проверила strict schema, safe navigation, v1/v2, fallback и повторно сериализацию.

Первая реальная попытка остановилась до отправки; read-only receipt-only подтвердил отсутствие job/receipts. Обнаружена неподходящая для durable DTO матрица клавиатуры; введён плоский DTO, нативная матрица собирается только на границе transport. Локальный SDK batch.create без commit принимает полный новый DTO; проверка исключает прямые вложенные массивы. Это не подмена live приёмки тестом arrayUnion.

Повторный тот же run-id design-20261018-v1:4условных примера upload/grade/homework/review,4parts/4receipts, job sent, format=rich_message. Реальная отправка прошла sendRichMessage, HTML fallback не использовался. В ledger создан лишь technical.probe с пустыми учебными полями; в начале каждого примера явный demo prefix. Установлен постоянный release ca21b1df8428ce4ab9ed73e4. После включения auth исправлений из main полный check817tests/161files и production build прошли. UI Kit опубликован штатной командой в gh-pages1058179; HTTP200 и побайтное совпадение действующего JS с проверенной сборкой подтверждены.35файлов установленного worker closure/package manifests совпадают с checkout; readiness running/readyForDelivery, outbox queries готовы. Последующее параллельное обновление среднего балла включается в окончательный общий выпуск; предварительная публикация не является основанием откатывать его интерфейс. Дополнительно проверен контракт LearningRoute: без точных familyId/childId и distinct viewTokens обеих ролей source не создаёт кнопку; legacy upload сохраняет событие без ссылки. Это не блокирует приём файла.

При объединении сохранены GradeAverage, GradeAverageSlider, общая групповая навигация UI Kit и их существующие проверки.

## Согласование

Прямое разрешение пользователя распространяется на изменение оформления, шаблоны UI Kit, реальные примеры в его уже подтверждённом Telegram чате, тесты, спецификации и выпуск main. Согласование не разрешает отправку примеров другим семьям. Контекстные ссылки не дают новых прав доступа. Временный detached checkout изолирует параллельные UI правки; законченная итерация возвращается в main.

После объединения утверждённой навигации/среднего балла из main:822tests/162files, production build, spec/link/UI gate/read registry/lint прошли. Раздел Telegram добавлен внутрь topicGroups, подписи категорий остаются по одному разу. Один финальный релиз согласован с сессией UI Kit по прямому разрешению пользователя; публикация выполняется из чистого актуального main через source gate.
