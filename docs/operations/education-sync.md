---
id: operations.education-sync
status: accepted
implementation: partial
parent: operations
uses:
  - service.operator-cli
  - module.synchronization.global-sync
  - module.synchronization.execution-artifact
  - module.synchronization.education-pipeline
  - service.telegram-bot.education-sync-dispatch
sections: []
created: 2026-10-16
updated: 2026-10-19
consumers:
  - "Education sync operator"
  - "sync-project CLI"
  - "family data publishers"
code:
  - "scripts/sync-project.mjs"
---

# Общий цикл EducationSync

Общий CLI запускается через `npm run education -- catalog`, описывает операцию через `describe` и исполняет только фиксированный реестр. Полный цикл охватывает все подключённые семьи и детей; точный граф стадий и отчёт определены в [глобальной синхронизации](../modules/synchronization/global-sync.md), [контракте execution artifact](../modules/synchronization/execution-artifact.md) и [сквозном протоколе](../modules/synchronization/education-pipeline.md).

Порядок: обнаружить семейные источники/очереди, получить полный проверенный снимок, сверить назначение/материалы и пользовательские результаты, подготовить проверяемый пакет, опубликовать через профильную операцию, выполнить адресный readback. Пустая очередь и неполный снимок — разные состояния. Педагогическое решение остаётся за агентом по доказательствам; CLI не выводит его из кода выхода процесса.

Каникулы входят в штатный `sync:project collect` через общий child adapter. Адресная операция `npm run sync:project -- calendar --publish` обновляет только подтверждённый персональный календарь без обхода учебников и всех уроков; без `--publish` сохраняет закрытый источник. Успех требует `calendar[].state: complete` и `publication.verified: true`; `captured` означает лишь локальное получение, `blocked` требует конкретной диагностики. Неизменный повтор должен иметь `writes:0`. Пустое расписание и неизвестный ответ МЭШ не позволяют придумывать каникулы. [Контракт и интерпретация](../modules/school-diary/school-calendar.md).

Рецепты `discover`, `finalize` и отдельный `status`, входные поля, закрытые квитанции и идемпотентность определены в [Operator CLI](../services/operator-cli/README.md). Личные ссылки/вывод сохраняются в закрытых receipts, наружу идут разрешённые агрегаты. Публикация данных не вызывает `publish:pages`.

Конкретный учебный запуск PETR использует внешний приватный навык `petr-private:skills/education-sync/SKILL.md`; общие сервисные инварианты остаются в локальных контрактах Education. Автономный педагогический наблюдатель и атомарная аренда разбора ещё не реализованы.


Ручной запрос и [автоматический Mesh-trigger](../services/telegram-bot/education-sync-dispatch.md) исполняют этот же workflow, без второго сборщика или отдельных педагогических правил. Целевой вход описан в [execution artifact](../modules/synchronization/execution-artifact.md): проверенный готовый план с конкретными задачами. Диспетчер адресует существующий чат и требует durable claim/heartbeat/complete; Telegram уведомления доставляются независимо от выполнения агента.

Прямое постоянное решение пользователя19.10: стандартное получение подтверждённых материалов МЭШ и их размещение в настроенном Education-каталоге его Яндекс.Диска, включая ссылку для отображения учебного оригинала, входят в автоматическую синхронизацию. Повторное ручное подтверждение каждого очередного вложения не является стадией продукта. Применяются текущие owner/access/hash/privacy проверки и существующие credential/session механизмы; это не передача полномочий для произвольных источников или назначений. При отказе внешней системы контроля фиксируется точная фактическая причина, используется уже данная авторизация, а не выдумывается новое продуктовое ограничение.
