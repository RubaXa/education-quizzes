---
id: operations.education-sync
status: accepted
implementation: partial
parent: operations
uses:
  - service.operator-cli
  - module.synchronization.global-sync
  - module.synchronization.education-pipeline
sections: []
---

# Ручной запуск EducationSync

Общий CLI запускается через `npm run education -- catalog`, описывает операцию через `describe` и исполняет только фиксированный реестр. Полный цикл охватывает все подключённые семьи и детей; точный граф стадий и отчёт определены в [глобальной синхронизации](../modules/synchronization/global-sync.md) и [сквозном протоколе](../modules/synchronization/education-pipeline.md).

Порядок: обнаружить семейные источники/очереди, получить полный проверенный снимок, сверить назначение/материалы и пользовательские результаты, подготовить проверяемый пакет, опубликовать через профильную операцию, выполнить адресный readback. Пустая очередь и неполный снимок — разные состояния. Педагогическое решение остаётся за агентом по доказательствам; CLI не выводит его из кода выхода процесса.

Рецепты `discover`, `finalize` и отдельный `status`, входные поля, закрытые квитанции и идемпотентность определены в [Operator CLI](../services/operator-cli/README.md). Личные ссылки/вывод сохраняются в закрытых receipts, наружу идут разрешённые агрегаты. Публикация данных не вызывает `publish:pages`.

Конкретный учебный запуск PETR использует внешний приватный навык `petr-private:skills/education-sync/SKILL.md`; общие сервисные инварианты остаются в локальных контрактах Education. Автономный педагогический наблюдатель и атомарная аренда разбора ещё не реализованы.
