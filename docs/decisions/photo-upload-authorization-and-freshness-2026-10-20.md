---
id: decision.photo-upload-authorization-and-freshness-2026-10-20
status: accepted
implementation: partial
created: 2026-10-20
updated: 2026-10-20
parent: module.materials.storage-privacy
uses:
  - module.synchronization.event-queue
consumers:
  - student photo upload
  - Firestore Rules operator
  - web app maintainer
code:
  - src/DayPage.tsx
  - src/WeekendMathSlot.tsx
  - src/lib/dayStore.ts
  - packages/education-runtime/upload-broker.mjs
  - firestore.rules
  - rules-test-fixtures/photo-upload-suite.mjs
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---

# Авторизация и свежесть загрузки ученического фото

## Основание

Повторная ошибка ученика «Missing or insufficient permissions» оставляла фото в локальном предпросмотре, не создавая события загрузки. Анализ подтвердил два независимых дефекта: клиент мог отправить устаревшую `planRevision` из Firestore cache, а разрешение event-create превышало лимит Rules из-за повторного чтения сессии и членства. Cloud `Rules :test` также выявил неверную сборку пути источника: интерполяция `sourceRef.documentPath` превращала путь документа в один сегмент.

## Было → стало

День отображается из живой подписки, которая может сначала отдать cache. Загрузка передавала её ревизию напрямую в source документ; при несовпадении Rules отклоняли batch, в котором должны атомарно появиться source и `educationEvents` event. Теперь загрузчик получает серверную страницу, сравнивает видимую карточку и условие с актуальным заданием, затем пишет актуальную ревизию. Условие, источник или вложенный оригинал изменились — отправка ждёт обновления страницы. Повтор той же заявки с тем же `uploadId` и SHA-256 подтверждает существующий receipt без второй записи. Для уже переданного фото проверяются receipts `upload.bytes_uploaded` и `upload.confirmed`; worker записывает обе части `eventOperationId`/`eventReceiptId` для `upload.confirmed`. Для исторических `pending`/`reviewed` допустима только запись с верным receipt подтверждения и старым `eventOperationId` `upload-transfer:<id>:uploaded`, если storage имеет состояние `stored` и SHA-256 совпадает; проверка сохраняет task/device/version guards. Конфликт или состояние `upload-error` не выдаются за успех.

Rules теперь разрешают session/link/member один раз для queue event и передают подтверждённые member/person ID в source validator. У каждой роли остаётся свой guard. Для `getAfter` используются типизированные сегменты пути; строка `documentPath` только сверяется с ожидаемой формой и не интерпретируется как wildcard разрешение.

## Действия и роли

Ученик отправляет фото только в собственную страницу дня и задание, опубликованное в текущей server-confirmed ревизии. Родитель не получает права на ученическую загрузку из ссылки или знания token. В одной Firestore операции остаются связанные source document и event receipt. Закрытая очередь, device UID, child/member scope, task, operation ID, event ID, статус, хэш и envelope guards сохраняются.

Затронутые файлы: `src/DayPage.tsx`, `src/WeekendMathSlot.tsx`, `src/lib/dayStore.ts`, `packages/education-runtime/upload-broker.mjs`, `firestore.rules`, `rules-test-fixtures/photo-upload-suite.mjs`, `scripts/firestore-rules-photo-upload-suite.test.mjs`, `scripts/firestore-rules-education-events.test.mjs` и связанные контракты хранения и event queue.

## Проверки

Vitest покрывает атомарный request event, bytes-uploaded, delete, подтверждение `upload.confirmed`, повтор неоднозначного commit, свежую ревизию неизменной карточки, блокировку изменившегося условия, retry для worker-confirmed receipt и структуру synthetic REST `:test` матрицы. Cloud `Rules :test` подтверждает source-create и event-create, а также denial для чужих family/device/task/role и plan revision; расширенная матрица включает malformed path, child mismatch, actor/receipt spoofing и uploaded/delete event cases. Публичный fixture использует только вымышленные ID. Обычный `npm test` не вызывает сеть.

## Согласование

Прямое поручение 20.10.2026 — исправить повторную регрессию ученической фотозагрузки. Scope сохраняет членство, роль, источник и атомарность event queue; публикация и деплой не входят в это изменение.
