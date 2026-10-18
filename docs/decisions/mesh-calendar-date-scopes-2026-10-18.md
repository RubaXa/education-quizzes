---
id: decision.mesh-calendar-date-scopes-2026-10-18
status: accepted
implementation: not-applicable
created: 2026-10-18
updated: 2026-10-18
parent: service.telegram-bot.mesh
uses:
  - module.school-diary
  - service.telegram-bot.operations
consumers:
  - МЭШ adapter maintainer
  - Telegram operator
  - UI gate
code: []
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---

# Многодневное календарное событие в дневных областях МЭШ

## Основание

Пользователь18.10.2026 поручил исправить три области с несовпадающими датами через Luna Worker, проверить результат, добавить тесты, обновить спецификации, выполнить проверки и commit/push. Свежий read-only source-check подтвердил три `schedule_date_mismatch`: один календарный `OLYMPIAD`, начавшийся12.10 и завершившийся15.10, возвращается для13–15.10. Предмет, ДЗ и тип урока отсутствуют. Приватный receipt содержит безопасный digest для доказательства одинаковой идентичности; личные поля в публичный репозиторий не переносятся.

## Было → стало

Normalizer трактовал любую календарную запись как урок и требовал равенства даты её начала запрошенному дню. Общий classifier подтверждает известный calendar-only тип и реальное пересечение дня; уроки продолжают проходить строгую проверку даты. Raw schedule сохраняется в общем коннекторе и sync. Lesson projection исключает календарную запись со счётчиком, не создавая безымянного урока. Новый вид календарных уведомлений не объявляется реализованным. Scope keys и baseline policy не меняются; отсутствие записи не становится отменой.

## Действия и роли

Luna реализует общий classifier, диагностический CLI и регрессии. Техлид независимо сверяет код, негативные сценарии и реальные чтения через общий resolver/session. Диагностический выбор дат применяется ко всем найденным семьям и явно не является проверкой полного охвата. Runtime продолжает динамически обнаруживать все семьи без allowlist.

Затронутые runtime-файлы:

- `packages/education-connect/lib/mesh.mjs`
- `packages/telegram-notifications/adapters/source-mesh.mjs`
- `packages/telegram-notifications/operations/source-check.mjs`
- `scripts/telegram-runtime.mjs`

## Проверки

Регрессии используют synthetic данные: три перекрывающихся дня, первый день без фиктивного урока, неизменность уроков при перестановке/повторе, UTC и Moscow boundary, повреждённый интервал, неизвестный source и OLYMPIAD с признаками урока/ДЗ. Отдельно проверяются сохранность raw calendar в connector и отсутствие лишнего detail запроса, адресная изоляция, отсутствие записей/отправок в source-check, ограниченный безопасный diagnostic payload и честный partial coverage. Перед commit выполняются полный `npm run check`, staged docs/privacy hooks и реальный source-check без фильтра. Итог18.10:737 tests/149files,151спецификация,451read site; полный `npm run check` прошёл (сайт не изменён, build tool подтвердил отсутствие необходимости пересборки). Старый normalizer на synthetic fixture воспроизводит fake «Урок»12.10 и partial13–15.10. Окончательный реальный проход:93/93 complete,0partial,151lesson/homework/grade records,4исключённых календарных вхождения одного события в12–15.10,0uncovered children, writes0/sends0, blockedReasons пуст. Это одна подключённая семья/ребёнок/account, не доказательство сетевой ёмкости для большого числа семей. Длительность199,4с,500HTTP attempts,1791полученный Firestore document (не billed reads),37,8с ожидания общего account lock при одновременной работе daemon; exporterErrors0. Постоянный Mac release94a5f463ca87291bb5ab5e57 установлен; его shared connector и normalizer побайтно совпали с reviewed code. Readiness из рабочего корня подтвердила running/readyForDelivery и оба outbox query ready. Результат не означает реализации отдельных календарных уведомлений.

## Согласование

Прямая инструкция пользователя включает исправление через Luna, тесты, проверку, спецификации и commit/push. Постоянный процесс на этом Mac ранее явно согласован; обновление использует штатный installer и прежний общий vault. Проверка причины не требует отправки сообщений или фиктивных учебных событий. UI baseline остаётся запечатанным; корректировка runtime учитывается отдельными SHA в gate.
