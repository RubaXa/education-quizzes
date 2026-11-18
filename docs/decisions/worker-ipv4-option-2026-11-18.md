---
id: decision.worker-ipv4-option-2026-11-18
status: accepted
implementation: implemented
created: 2026-11-18
updated: 2026-11-18
parent: service.telegram-bot.operations
uses:
  - service.telegram-bot.operations
consumers:
  - operator
code:
  - packages/telegram-notifications/operations/launch-agent.mjs
  - scripts/telegram-runtime.mjs
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---
# Ограниченная настройка IPv4 для host

## Основание

При проверке источников18.11 автоматический transport получил ETIMEDOUT на
публичном OAuth endpoint, тогда как HTTPS с family4 отвечал. Native полный begin
с IPv4-порядком прошёл inventory/inbox/42дня; background worker остановился на
startup после сетевого сбоя. Причина маршрутизации вне приложения не объявляется
доказанной. Настройка восстанавливает стандартный transport без изменения ключей.

## Было → стало

Опциональный TELEGRAM_IPV4_FIRST=1 включает только два фиксированных Node-флага.
Неподдерживаемое значение отклоняется; default остаётся прежним. Credentials,
проверка TLS и endpoints не меняются. Восстановление того же content hash не
стирает существующий сертификат проверенного резерва из-за waiting процесса.

## Действия и роли

packages/telegram-notifications/operations/launch-agent.mjs проверяет настройку,
строит plist и сохраняет резерв; scripts/telegram-runtime.mjs показывает безопасную
ошибку настройки. Worker import closure не меняется. Новых Firestore reads нет.

## Проверки

Фиксированная опция в plist, отказ неизвестному значению, отсутствие произвольных
NODE_OPTIONS, повтор same-hash после waiting с сохранением проверенного резерва;
все прежние тесты ротации/rollback и npm run check. Выпуск подтверждается readiness.

## Согласование

Продолжение поручения18.11 о рабочей синхронизации реальных материалов и безопасной
очистке неиспользуемого worker. Перед удалением старой установки восстанавливаем
заменяющий runtime, не обходя его защитную проверку. Локальные проверки и прямой
push main по текущему решению пользователя; дополнительных расписаний нет.
