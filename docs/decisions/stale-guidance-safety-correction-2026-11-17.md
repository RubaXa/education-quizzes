---
id: decision.stale-guidance-safety-correction-2026-11-17
status: accepted
implementation: implemented
created: 2026-11-17
updated: 2026-11-17
parent: product.ui-change-control
uses:
  - module.reviews.subject-aware-guidance
  - shared.design.student-review-step
consumers:
  - student
  - parent
  - Education operator
code:
  - scripts/day.mjs
  - storage/guidance-correction.mjs
sections:
  - reason
  - change
  - roles
  - verification
  - authorization
---
# Коррекция устаревшего публичного раскрытия

## Основание {#reason}

Production readback обнаружил ранее отправленный полный этап, раскрывающий ответ
на текущий ученический вопрос. Простое сворачивание или исправление последнего
текста не закрывает старое раскрытие и предыдущую помощь. Текущий запрет ответа
имеет приоритет; полноценный родительский путь остаётся закрытым и сохранённым.

## Было → стало {#change}

`scripts/day.mjs` получает адресные guidance-export/guidance-correct, а
`storage/guidance-correction.mjs` проверяет одну задачу, текущий review и явные
события одного этапа. Существующие события становятся безопасными hint с теми же
ID/автором/временем; все полные прежние документы доступны только в закрытом
архиве guidanceCorrections. Учебные попытки, помощь в прошлом, баллы и сам guide
не переименовываются в новые или самостоятельные результаты.

## Действия и роли {#roles}

Оператор сначала экспортирует ограниченный task, сверяет смысл вопроса и отсутствие
ключа, затем готовит закрытый0600пакет с причиной и expected hashes. Без --apply
команда ничего не пишет. Транзакция проверяет владельца и все снимки, затем set без
merge убирает старые публичные поля. Родитель сохраняет полный путь и приватную
историю коррекции. Ученик читает существующий hint, включая безопасную предыдущую
помощь. Новых UI-блоков, попыток, оценок, уведомлений и очередей нет.

## Проверки {#verification}

`storage/guidance-correction.test.mjs` показывает исходную утечку в настоящем
TaskGuidance, затем проверяет отсутствие ответа после коррекции обоих исторических
reveal. Проверяются bounded query, dry run, metadata владельца, stale review/guide,
полный закрытый архив, provenance, неизменность заданий и обычная повторная
guidePublication с сохранением guidanceCorrections. Семантическую безопасность
не заменяют хэш и тесты. Root выполняет native export/apply/readback и повторную
публикацию отдельно после общего check и установки CLI.

## Согласование {#authorization}

Прямой запрос родителя о запрете ответа на текущий шаг и текущая production сверка;
17.11 поручено исправить уже опубликованный материал штатным адресным CLI, сохранить
оригиналы и историю, не менять учебный вердикт или полный родительский путь.
