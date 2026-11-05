---
id: decision.moving-preparation-window-2026-11-05
status: accepted
implementation: implemented
created: 2026-11-05
updated: 2026-11-05
parent: module.synchronization.global-sync
uses:
  - module.synchronization.global-sync
code:
  - sync/preparation-window.mjs
  - sync/help-request-resolution.mjs
  - scripts/sync-inbox.mjs
  - scripts/sync-queue.mjs
  - scripts/submissions.mjs
consumers:
  - Education sync operator
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---

# Движущееся окно подготовки и закрытие ожидания ответа

## Основание

Родитель05.11 попросил разобрать14задач/4блокировки, выполнить доступное и запросить недостающее в приложении. Отдельным ответом выбрал начало окна с понедельника текущей недели.

## Было → стало

Исчезнувшие старые legacy-задачи подготовки оставались blocked бессрочно. Теперь sync/preparation-window.mjs выделяет только подготовку с известной датой до понедельника. scripts/sync-queue.mjs завершает её в done/inactive с доказательством даты и границы. Проверки, фото, помощь, адресные продолжения и event-action сохраняют собственный жизненный цикл.

sync/help-request-resolution.mjs раньше учитывал только verified/accept. Теперь scripts/sync-inbox.mjs и scripts/sync-queue.mjs читают реальные опубликованные dayGuidance/help-response: та же задача, автор оператора, ссылки на событие и артефакт и время после запроса обязательны. Новый запрос и последующее reopen не закрываются старым ответом. scripts/submissions.mjs help показывает ответы для операторской сверки.

## Действия и роли

История, работы, баллы и запросы сохраняются. Закрытие ожидания ответа не означает зачёт или освоение. Истёкшая подготовка не открывается повторно при сканировании; недостающий источник запрашивается штатной materialRequest.

## Проверки

sync/preparation-window.test.mjs проверяет границы недели, неизвестную дату и сохранение попыток, помощи и артефактов. sync/help-request-resolution.test.mjs проверяет поздний адресный ответ, чужую задачу, старый ответ, отсутствие артефакта, новый запрос и reopen. Нужны свежий inbox, повторный scan и обе ролевые публикации.

## Согласование

Прямой запрос родителя05.11.2026 и уточнение «С понедельника текущей недели».
