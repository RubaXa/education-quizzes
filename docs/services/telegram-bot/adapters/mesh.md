---
id: service.telegram-bot.mesh
status: accepted
implementation: partial
created: 2026-10-16
updated: 2026-10-17
consumers:
  - "Telegram service implementer"
  - "bot operator"
  - "parents and guardians"
code:
  - packages/telegram-notifications/adapters/source-mesh.mjs
  - packages/telegram-notifications/adapters/mesh-credentials.mjs
parent: service.telegram-bot
uses:
  - shared.server-runtime
sections:
  - ответственность-и-режим
  - контракт-снимка
  - начальный-event-mapping
  - ошибки-и-восстановление
  - будущие-подмодули
---
# Адаптер источника МЭШ

**Родитель:** [корневая архитектура](../README.md); [порты и события](../ports-and-events.md); [порт дневника](../../../modules/school-diary/README.md).
**Статус:** adapter поверх существующего MeshDiaryAdapter реализован и подключается opt-in к динамическому inventory; круглосуточный deployment и реальные API limits не подтверждены.

## Ответственность и режим

Адаптер опрашивает МЭШ по сохранённым авторизованным источникам, собирает полный снимок, проверяет полноту, нормализует стабильные записи и передаёт observation core. Он не рассылает события, не пишет учебную проекцию и не переиспользует credentials между семьями.

Начальная продуктовая гипотеза — интервал 15 минут. Это не подтверждённый API limit и не обещание доставки за минуту. Интервал, concurrency и jitter настраиваются после проверки текущего коннектора, фактических ответов и кодов ограничения частоты.

## Контракт снимка

- Scope ключуется по семье, ребёнку и исходной учётной записи.
- Observation охватывает одну дату расписания, одну дату ДЗ либо один подтверждённый предмет/период оценок ребёнка/аккаунта; время скачивания не входит в content revision.
- Каждая полная observation обязана иметь устойчивый монотонный `observationSequence`, выделенный и сохранённый источником по scope до передачи в diff. `fetchedAt` и случайный UUID не заменяют sequence. Повторный или меньший sequence отвергается без продвижения baseline; provider реализован общим SourcePipeline/checkpoint store с lease heartbeat и fencing.
- Сравнивать только устойчивые source IDs и нормализованные значимые поля. Перестановка записей, время fetch и серверный шум не создают событие.
- Продвигать baseline только после полного валидного снимка всех обязательных частей. Частичный ответ, ошибка аутентификации и транспортный сбой сохраняют предыдущую baseline.
- Исчезновение записи становится событием только если контрактом доказана полнота области и источником подтверждён её статус; иначе открыть reconciliation signal.
- При первом успешном полном снимке записать baseline без исторической рассылки.

## Начальный event mapping

| Семейство данных | Возможные event types | Значимое изменение | Ограничение |
|---|---|---|---|
| `schedule` | `schedule.created`, `schedule.changed`, `schedule.cancelled` | Время, предмет, cancelled/replaced; ДЗ имеет отдельный scope | Не отправлять техническую перестановку/обновление fetch time |
| `assignments` | `homework.assigned`, `homework.changed`, `homework.cancelled` | Содержательный текст/дата/вложение/подтверждённый статус | Неполная карточка не означает отмену |
| `marks` | `grade.created`, `grade.changed` | Новая/изменённая отдельная отметка с source ID | Среднее и счётчики — сигнал сверки, не отдельная оценка |

Семантика полей и ID сверена с локальным adapter и fixtures; реальные ответы перед rollout должны быть сверены с `mesh-diary` и контрактом [обнаружения и сверки изменений](../../../modules/synchronization/change-detection-and-reconciliation.md). Не генерировать synthetic event из агрегата, если нельзя показать родителю конкретный факт.

### Автоматическая семейная адресация

Семьи, дети и источники обнаруживаются динамически из Education registry, без ручного allowlist. `sourceAccounts.personId` — внутренний ID взрослого Education, а `sourceAccounts.sourcePersonId` — actor ID МЭШ. Проверяются активный parent membership, точный childId, child.meshPersonId и `sourceIdentities` с той же парой. Локальные полномочия `.local/mesh-connections/{accountId}.json` должны соответствовать хэшу actor ID; отсутствующие credentials отображаются как блокировка источника этой семьи, а не исключение ребёнка из охвата. Legacy `.local/diary` допустим только через общий codec с точным подтверждением исторического owner/actor в текущем registry; произвольного fallback между семьями нет.

Для каждого ребёнка создаётся отдельный MeshDiaryAdapter, профиль выбирается по подтверждённому sourcePersonId и проходит verifyAccess. Один родительский account может обслуживать нескольких детей; обновление token/refreshToken сохраняется адресно/атомарно с правами0600, не перезаписывая child profile IDs в общей записи. Общий Mesh session service сериализует account между процессами sync и worker через kernel advisory lock Python3/fcntl на одном хосте; inode не удаляется по mtime/PID. Потеря lock запрещает сохранение refresh. Другие семьи могут обрабатываться параллельно. Контракт credentials/lock принадлежит [серверному ядру](../../../shared/server-runtime.md#авторизация-и-совместимость).

Grade discovery получает subject_id/start из полного getMarks, без предположений о датах четвертей. Безопасная проекция результатов разделяется между observers через60-секундный cache/in-flight dedup; raw marks в checkpoint не попадают. Новый date/period scope всегда начинает тихий baseline. Из нескольких подходящих взрослых аккаунтов выбирается один детерминированный source account на ребёнка, исключая дубли одной школьной записи.

Индивидуальные marks[].id доступны в текущем normalized adapter и его fixtures. Grade events строятся только по такому ID и допустимому значению; среднее/count не становятся оценкой. Отметка без устойчивого ID, неполный период, stale homework detail или ошибка API не продвигают соответствующую baseline. Позиционные ID подпунктов ДЗ не используются как идентичность: запись ключуется стабильным ID урока, её содержимое канонизируется без порядка массива. Значимые schedule/homework изменения могут храниться как safe semanticHash и короткие display fields, без URL, комментариев, payload и credentials.

## Ошибки и восстановление

Coordinator применяет bounded concurrency и retry backoff для неполных/ошибочных observation, poller — interval и jitter. Точная адаптация Retry-After/429 и общий распределённый rate limiter пока не реализованы; перед многопроцессным rollout необходим отдельный контракт ограничения API нагрузки. Не повторять неидемпотентные операции записи (adapter только читает). После длительного перерыва выполнить полный snapshot reconciliation; события периода между снимками могут быть недоступны, поэтому при этом нужен маркированный recovery digest или явная операторская неопределённость, а не выдуманная точная последовательность.

## Будущие подмодули

Когда появится несколько контрактов МЭШ с разным владельцем данных, вынести `mappings/marks.md`, `mappings/assignments.md`, `mappings/schedule.md` и отдельный документ polling policy. Пока эта спецификация держит общий snapshot contract и provisional mappings.
