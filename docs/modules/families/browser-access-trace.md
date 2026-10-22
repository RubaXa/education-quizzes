---
id: module.families.browser-access-trace
status: accepted
implementation: partial
created: 2026-10-18
updated: 2026-10-22
consumers:
  - "web-app access flow"
  - "family access operator"
code:
  - "src/lib/browserAccessTrace.ts"
  - "scripts/browser-access-trace.mjs"
  - "public/access-snapshot.js"
  - "src/components/DiagnosticsCopyButton.tsx"
parent: module.families
uses:
  - module.families.access-and-state
  - shared.access-and-privacy
sections:
  - контракт
  - интерпретация
---

# Локальная LDD-трасса доступа

## Контракт

LDD (Log-Driven Development) связывает фактический запуск с выбором роли и наблюдаемой проекцией. Последовательность: app.loaded → identity.resolved → access.resolved → role.selected → route.selected → view.rendered. На ветвлениях записываются стабильные source/reason, состояние и безопасный код ошибки. Сам журнал не назначает полномочия и не доказывает корректность интерфейса без сверки с видимым результатом.

Прямое уточнение19.10: `[имяФункции] [предыдущее → новое состояние] Пояснение решения`, затем безопасные детали. Логировать вход, существенную ветку, внешнее обращение, выход и ошибку в реальном месте исполнения. Имена должны соответствовать коду. Новые scope API, декораторы и архитектура вызовов ради LDD не нужны. Пример: `[restorePersonalContext] [idle → restoring] Restore saved session for current device`; `[configureRoleDiagnostics] [checking → resolved] Use role from membership document` с `{previousRole: student, role: student, fromCache: false}`.

Кнопка 🐞 в общей шапке одним кликом копирует локальный JSON без Console. Экспорт ждёт hashes, содержит current DOM-флаги, `complete` и `droppedRecords`; для старого журнала неизвестной полноты — `coverageUnknown`. Ничего автоматически не отправляет. ClipboardItem начинает write непосредственно в user gesture (Safari/PWA), иначе используется writeText. Успех и ошибка доступны через tooltip/status, без нового экрана. Отпечатки person/device/grant позволяют различить входы без вывода credentials. Более поздний cache-hit не отменяет server member evidence; смена identity отменяет прежнее основание.

Один ограниченный журнал в sessionStorage этой вкладки, максимум200событий/24часа. Новый запуск имеет новый runId; порядок внутри запуска монотонный. Один локальный debug sink печатает только whitelist события с префиксом `[Education LDD]`; поздние hashes обогащают журнал с тем же runId/sequence без второго console-события. Экспорт явно вызывается через `await window.educationDiagnostics.export()`. Сбор не вызывает сеть, Firestore или новые подписки, не изменяет вход, не показывает новых экранов и не задерживает локальный первый кадр. Ошибка хранилища/хеширования/sink не влияет на приложение. Ни remote probe, ни её права этим контрактом не включаются.

Поля whitelist: имена событий, роли, источники решений, reasonCode, виды маршрута, числа/флаги, безопасные имена JS-файлов; идентичности коррелируются только SHA-256 fingerprints. Никаких имён, токенов, URL с ресурсом/секретом, raw exceptions, ответов, фото, cookies или полного localStorage. Сохранённый журнал повторно валидируется; посторонние поля и значения не экспортируются. Экспорт содержит наблюдаемые DOM-флаги родительского разбора/ученических действий, а не текст учебной работы.

Событие `photo.storage` использует тот же локальный журнал, sessionStorage, export/copy, 200-записный предел и срок24часа. Разрешены только операции `savePhotoForTransfer`, `localPhotoForTransfer`, `removePhotoFromOutbox`; состояния `checking`, `retrying`, `recovered`, `failed`; безопасный код IndexedDB/DOM ошибки, номер попытки и длительность. Detail этого события очищается отдельным узким whitelist, поэтому роли, identity hashes, путь, имя файла, URL, Blob и текст ошибки отбрасываются. `photo.storage` остаётся наблюдением хранения: оно не участвует в выводе о роли, правах или доступе.

Штатные команды: `npm run diagnostics:browser -- snippet` печатает read-only команду для Console именно проблемной вкладки; она умеет снять ограниченный baseline даже со старой сборки. `npm run diagnostics:browser -- inspect <private-file.json>` валидирует и объясняет trace без сетевых запросов и не печатает входной файл целиком. Пользовательские диагностические файлы остаются в `.local/` или другом закрытом evidence-каталоге.

## Интерпретация

Родительский профиль и ученическая проекция в одной scope/run — различимый конфликт; student membership и student view — согласованный выбор ученика, но не объяснение того, почему родитель вошёл этим человеком. Роль из локального профиля и подтверждённое сервером членство различаются source. События разных запусков/детей нельзя соединять в мнимую причинную цепочку. Ошибка/пропуск чтения остаётся unknown, не student fallback. Отсутствующая трасса старой сборки означает недостаточно evidence.

Исходный случай закрывается после подтверждения причины, RED→GREEN, доставки и повторения того же сценария в проблемной вкладке. Контрольный браузер подтверждает только свой сценарий. Перед baseline нельзя очищать storage, менять вход или обновлять вкладку: это может уничтожить исходное состояние. Сбор baseline старой сборки не восстанавливает прошлые события; эта граница явно выводится инструментом.
