---
id: decision.learner-work-first-hourly-mesh
status: accepted
implementation: implemented
created: 2026-11-21
updated: 2026-11-21
parent: module.synchronization.global-sync
uses:
  - module.synchronization.task-routing
consumers:
  - Education operator
  - Telegram worker
code: []
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---
# Полученные работы раньше МЭШ

## Основание

Прямой запрос родителя21.11: полученные решения учеников должны разбираться
первыми; МЭШ следует после них, не чаще раза в час. Прежний порядок полного
сбора перед каждым action заменён. Новый таймер или расписание не создаётся.

## Было → стало

`operator/recipes.mjs`, `scripts/education.mjs`: begin возвращает свежие
inbox/inventory без collect; reconcile запускается после адресной работы.
`scripts/sync-project.mjs`, `sync/mesh-refresh.mjs`: полный снимок42дней того же
владельца и аккаунта переиспользуется моложе часа; pending публикации снова
проверяются. Возраст и исходный run не маскируются новым временем скачивания.
Неполные, чужие, будущие и относящиеся к другой неделе снимки не подходят.

`diary/application/homework-content.mjs`, `diary/application/diff.mjs`,
`sync/day-source-revision.mjs`, `day/build.mjs`: сравнение игнорирует только
пробелы, updatedAt и точный повтор всей строки. Сырые источники сохранены;
номера, сроки, отдельные ID и файлы остаются значимыми. Смена файла требует
сверки байтов, одинаковое имя не является доказательством равенства.

`packages/telegram-notifications/adapters/source-mesh.mjs` применяет то же
сравнение. `packages/telegram-notifications/adapters/config.mjs` ограничивает
прежнюю настройку poll снизу часом без отказа запуска старой конфигурации.
`packages/telegram-notifications/application/education-sync-dispatcher.mjs`
передаёт новый порядок агенту; frozen generations и владение не изменены.

## Действия и роли

Ребёнок первым получает проверенный отклик на свою работу. Родитель сохраняет
полный закрытый путь. Условие, критерии, предыдущие зачёты, фото и разделение
ролей не ослабляются; техническая блокировка МЭШ не становится задержкой
независимой проверки. completed очереди по-прежнему не доказывает полноту цикла.

## Проверки

RED→GREEN: `operator/recipes.test.mjs`, `sync/mesh-refresh.test.mjs`,
`diary/application/homework-content.test.mjs`. Сохранение реальных изменений:
`diary/application/diff.test.mjs`, `sync/publication-audit.test.mjs`,
`packages/telegram-notifications/adapters/source-mesh.test.mjs`.
Совместимость конфигурации и текст dispatch:
`packages/telegram-notifications/adapters/config.test.mjs`,
`packages/telegram-notifications/application/education-sync-dispatcher.test.mjs`.
Обязательны полный npm run check и граф спецификаций.

## Согласование

Прямая инструкция родителя в текущем чате21.11; отдельное подтверждение макета
не нужно, новое представление карточек не вводится. Основная спецификация —
[глобальный цикл](../modules/synchronization/global-sync.md#global-sync).
