---
id: decision.olympiad-history-2026-10-31
status: accepted
implementation: partial
created: 2026-10-31
updated: 2026-10-31
parent: module.olympiad-history
uses:
  - shared.design.ui-kit
  - shared.access-and-privacy
consumers:
  - Education developer
  - release operator
code: []
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---

# История олимпиад в общей семейной инфраструктуре

## Основание

Прямой запрос пользователя31.10.2026: реализовать историю по сезонам и этапам, результаты и личные работы в карточках олимпиад; общий Education, UI Kit, проверки и публикация без дополнительных согласований. [Контракт](../modules/assessments/olympiad-history.md).

## Было → стало

Архив истёкшей подготовки не хранил личную историю. Добавлены семейный индекс и ролевые проекции сезонов/этапов, таблица номеров и общая галерея исходных файлов. Сведения о текущем календаре/регистрации/подготовке сохранены. Оригиналы на семейном Диске выдаются по адресу после проверки членства в действующем upload broker; отдельного сервера нет.

## Действия и роли

Родитель и ребёнок читают разрешённую историю, родитель дополнительно видит заметки и закрытые источники. Родитель не отвечает за ребёнка. Учебная и историческая оценки не заменяют друг друга, прежние попытки/фото/помощь не меняются. Загрузка в архив не создаёт новое обязательное ДЗ.

Живой запрос31.10 показал задержку общей очереди около61с. Клиент ожидает до120с; срок запроса и повторная авторизация worker сохранены. Прямой bundle после полного build мог убрать service worker при прежнем отпечатке: build восстанавливает его перед использованием кеша.

Архивная галерея не выводит подсказку о ещё не переданном локальном файле для уже сохранённого оригинала.

## Проверки

Модель и dry-run/replay/хэш, изоляция проекций, Rules реальных SDK и worker с чужим ребёнком/устройством/закрытым файлом/отзывом прав, открытие истории при выключенной подготовке, UI Kit и геометрия320/390/540px. Полные check/build и отдельные live readback требуются до объявления выпуска.

## Согласование

Прямая инструкция пользователя достаточна для реализации и выпуска этой итерации. Параллельные изменения календаря/галереи включены в main; публикация согласуется с владельцем общего выпуска. Подготовленный код не объявляется опубликованной функцией.

Затронутые файлы:

- `packages/education-events/envelope.mjs`
- `packages/education-runtime/event-queue.mjs`
- `packages/education-runtime/upload-broker.mjs`
- `packages/telegram-notifications/application/education-event-routing.mjs`
- `scripts/olympiad-history.mjs`
- `src/UiKit.tsx`
- `src/components/ArtifactAvatar.tsx`
- `src/components/OlympiadCatalog.tsx`
- `src/components/OlympiadHistory.css`
- `src/components/OlympiadHistory.tsx`
- `src/components/OlympiadHistoryShowcase.tsx`
- `src/components/OlympiadHome.tsx`
- `src/components/OlympiadPage.tsx`
- `src/components/WorkPhotoGallery.tsx`
- `src/lib/olympiad/client.ts`
- `src/lib/olympiad/historyStore.ts`
- `src/lib/olympiad/historyTypes.ts`
- `storage/learning-file-access.mjs`
- `storage/yandex-disk.mjs`

- `scripts/build-site.mjs`
