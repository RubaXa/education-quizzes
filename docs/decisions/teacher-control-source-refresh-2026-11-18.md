---
id: decision.teacher-control-source-refresh-2026-11-18
status: accepted
implementation: implemented
created: 2026-11-18
updated: 2026-11-18
parent: module.assessments.assessment-decision-graph
uses:
  - module.assessments.quizzes
  - module.synchronization.subject-decision-graph
consumers:
  - preparation author
  - Education operator
code:
  - assessment/followup-contract.mjs
  - scripts/quiz.mjs
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
---
# Перестроение подготовки по полученному файлу учителя

## Основание

Пользователь18.11 требует заменить общую подготовку реальными заданиями учителя,
сохранив историю ребёнка. Прежний control-diagnostic ещё не начат, но revise-open
разрешал полную авторскую коррекцию только ordinary. Создание дублирующего теста
теряло бы преемственность ссылки и назначения.

## Было → стало

Явная authorScopeCorrection.kind=teacher-material-arrived допускает обновление
не начатой control-diagnostic по проверенному материалу учителя. Новый план требует
teacher-material, проверенные sourceIds/researchSourceIds и ту же learningContext
homework. Старый режим, предметный адаптер, владелец, slug, token/testId неизменны.
Начало, обновлённая попытка, отправка или любой ответ запрещают замену. Авторская
ordinary-коррекция сохраняет прежние ограничения; targeted-followup не расширяется.

## Действия и роли

assessment/followup-contract.mjs проверяет предметную границу и прежние гарантии.
scripts/quiz.mjs использует существующие transaction, private scopeHistory и
адресный readback обеих ролевых проекций. Новых Firestore reads не добавляется.
Это ребро preparation:teacher существующего графа, не новый вид карточки.

## Проверки

RED: source refresh отклонялся только из-за control-diagnostic. GREEN: обновление
без смены testId; отказ начатой/отправленной работе, чужому ребёнку/ДЗ, course основе
или непроверенным источникам. Полный check, formatPlan и независимая сверка ключей.
Материал учителя не подтверждает выполнение ребёнком или полный будущий вариант.

## Согласование

Прямая просьба18.11 перестроить подготовку по появившимся реальным заданиям вместо
наших общих аналогов. Обновление затрагивает только не начатое назначение, со старой
версией в закрытой истории; локальные проверки и прямой push main без PR.
