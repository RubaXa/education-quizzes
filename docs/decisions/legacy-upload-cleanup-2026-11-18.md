---
id: decision.legacy-upload-cleanup-2026-11-18
status: accepted
implementation: implemented
created: 2026-11-18
updated: 2026-11-18
parent: service.upload-worker
uses:
  - service.upload-worker
  - service.telegram-bot.operations
  - operations.deployment
consumers:
  - operator
  - repository maintainer
code:
  - packages/telegram-notifications/operations/legacy-upload-cleanup.mjs
  - packages/telegram-notifications/operations/launch-agent.mjs
  - scripts/telegram-runtime.mjs
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---
# Удаление неиспользуемой upload установки

## Основание

Пользователь18.11 поручил проверить старый upload-worker и удалить неиспользуемую
установку, сохранив ключи и учебные данные, с фактическим замером места. Тем же
решением заменил прежний процесс PR прямым push в основную main после локальных
проверок, без новых ветвей, ревью и ожидания CI.

## Было → стало

Миграция отключала старый LaunchAgent, но оставляла code/node_modules и credentials.
Явный CLI сначала доказывает отсутствие использования, сохраняет нужные файлы в
закрытом архиве и проверяет хэши, затем удаляет только старую установку. Неизвестные
данные и ошибки проверки запрещают удаление. Общий обработчик загрузок сохраняется.

## Действия и роли

packages/telegram-notifications/operations/legacy-upload-cleanup.mjs выполняет
проверки и архивирование; packages/telegram-notifications/operations/launch-agent.mjs
и scripts/telegram-runtime.mjs предоставляют штатную команду оператора.
Новые Firestore чтения/записи, изменение учебных заданий и интерфейса отсутствуют.
AGENTS.md и docs/operations/deployment.md сохраняют новый прямой порядок main;
чужой checkout и незавершённые правки не меняются.

## Проверки

Dry-run, отказ при живом процессе/открытых файлах/ссылках/плохом inventory,
побайтное сохранение ключей и учебного sentinel в `.local`, неприкосновенность
заменяющего active/backup, отказ неизвестному файлу, повтор и реальный замер.
Перед прямым push — npm run check и штатные hooks. После удаления — readiness
заменяющего worker и перечитывание архива.

## Согласование

Прямое поручение18.11 разрешает эту очистку после проверки отсутствия использования
и прямой push проверенной итерации в main. Удалять ключи или семейный архив,
обходить Git hooks, force-push или менять чужой checkout не разрешено.
