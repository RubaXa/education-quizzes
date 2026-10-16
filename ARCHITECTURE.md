---
id: architecture.education
status: accepted
implementation: partial
parent: product.education
uses:
  - service.web-app
  - service.operator-cli
  - service.upload-worker
  - service.telegram-bot
  - shared.data
  - shared.design
  - shared.access-and-privacy
  - shared.specification-system
sections:
  - приложения-и-процессы
  - предметные-модули
  - правила-зависимостей-и-расширения
  - источники-истины-и-выпуск
---

# Карта архитектуры Education

Education соединяет семейный доступ, данные школьного дневника, задания, материалы, проверки и самопроверки. [Корневая продуктовая спецификация](docs/product/README.md) задаёт пользовательские возможности; [навигатор](docs/README.md) ведёт к конкретным контрактам. Этот файл показывает границы системы и разрешённые зависимости.

## Приложения и процессы

| Сервис | Код | Реальное состояние |
|---|---|---|
| [Web app](docs/services/web-app/README.md) | `src/`, `pwa/` | React/PWA читает Firestore и отправляет файлы на Диск; конфигурация экранов и часть local-first архитектуры остаются целевыми |
| [Operator CLI](docs/services/operator-cli/README.md) | `operator/`, `scripts/education.mjs`, предметные CLI | Повторяемые операции и ручной запуск EducationSync; агент выполняет предметные решения по данным |
| [Upload worker](docs/services/upload-worker/README.md) | `scripts/direct-upload-worker.mjs`, `storage/` | Локальный процесс выдаёт адреса и подтверждает передачу файлов; не проверяет учебное содержание |
| [Telegram bot](docs/services/telegram-bot/README.md) | Runtime пока отсутствует | Есть целевые контракты и зависимости, работающий наблюдатель и доставка ещё не реализованы |

```mermaid
flowchart LR
  Family[Родитель и ребёнок] --> Web[Web app]
  Operator[Оператор и агент] --> CLI[Operator CLI]
  Mesh[МЭШ] --> Diary[School diary adapter]
  Diary --> CLI
  CLI --> DB[Firestore]
  DB --> Web
  Web --> Disk[Яндекс.Диск]
  Worker[Upload worker] --> DB
  Worker --> Disk
  CLI --> Disk
  Telegram[Telegram bot: planned] -.-> DB
  Telegram -.-> Diary
  Telegram -.-> BotAPI[Telegram Bot API]
```

Приватный PETR-контекст (`learner`, `events`, `work`, Skills) находится вне checkout Education. Он задаёт конкретную учебную цель и доказательства. Общие контракты сервиса должны читаться из самостоятельного checkout; provenance внешнего материала обозначается `petr-private:` и не делает его публичным источником.

## Предметные модули

| Модуль | Владелец смысла |
|---|---|
| [Families](docs/modules/families/README.md) | Семья, ребёнок, роли и проверенная принадлежность источника |
| [School diary](docs/modules/school-diary/README.md) | Нормализованный дневник и порт МЭШ; dashboard и день |
| [Synchronization](docs/modules/synchronization/README.md) | Полнота снимка, сверка, публикация и восстановление |
| [Assignments](docs/modules/assignments/README.md) | Идентичность назначенного задания, связи и статус выполнения |
| [Assessments](docs/modules/assessments/README.md) | Проверяемый тест, попытка и продолжение |
| [Reviews](docs/modules/reviews/README.md) | Критерий, исходник, видимое на работе и учебный вердикт |
| [Materials](docs/modules/materials/README.md) | Общие оригиналы, издания, страницы и семейное право |
| [Notifications](docs/modules/notifications/README.md) | Семантика событий и встроенный inbox; будущая внешняя доставка |

## Правила зависимостей и расширения

1. Продуктовый сценарий ссылается на сервисы и модули, которые его реализуют. Изменение технической структуры не меняет смысл принятого сценария.
2. Сервис связывает модули и адаптеры. Порт дневника должен переиспользоваться существующим CLI и будущим наблюдателем; расписание процесса и авторизация остаются его отдельной ответственностью.
3. Общий контракт данных и приватности один: модуль определяет предметное поле, [Firestore](docs/shared/data/firestore.md) — связи/совместимость, правила доступа — допустимую запись/чтение.
4. Доменный слой будущего Telegram worker зависит от портов; внешние SDK остаются в адаптерах. Это целевая граница, а не утверждение, что весь существующий код уже разделён по ней.
5. Новый модуль выделяется при самостоятельной ответственности или повторном использовании. Не переносить Telegram outbox в общий слой до появления второго реального потребителя.
6. Шаблоны, источники, код и проверки связаны через [систему спецификаций](docs/shared/specification-system.md); [производный граф](docs/generated/graph.mmd) показывает всю структуру.

## Источники истины и выпуск

Firestore хранит опубликованные учебные данные и пользовательские результаты, Диск — оригиналы, закрытое локальное рабочее пространство — исходники операторского запуска и credentials. Конкретные владельцы и ограничения определены в [карте данных](docs/shared/data/README.md). Публикация данных не требует выпуска PWA. Изменение клиентского кода проходит отдельную сборку/публикацию; наличие файла в репозитории не доказывает deployment.
