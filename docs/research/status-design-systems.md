---
id: research.status-design-systems
status: reference
implementation: not-applicable
created: 2026-10-14
updated: 2026-10-16
consumers:
  - "product implementer"
  - "service implementer"
  - "Education operator"
code:
  []
parent: product.education
uses: []
sections: []
---
# Обозначения статусов в Education: основания

Дата сверки: 14.10.2026. Это исследовательское основание для [матрицы статусов](../shared/design/statuses.md), а не инструкция копировать оформление сторонней системы.

| Первичный источник | Что подтверждает | Решение для Education |
|---|---|---|
| [Apple HIG: Color](https://developer.apple.com/design/human-interface-guidelines/color) | Один цвет не должен менять смысл между экранами; цвет следует применять умеренно и не делать его единственным носителем информации. | Фиолетовый оставлен для бренда и главного действия, семантические цвета закреплены за результатом, ожиданием, вниманием и ошибкой. |
| [Apple HIG: Progress indicators](https://developer.apple.com/design/human-interface-guidelines/progress-indicators) | Индикатор активности уместен только во время операции; постоянное место индикатора помогает распознавать статус. | Вращающийся знак только при действующей загрузке/проверке. Ожидание и остановка получают статичные разные знаки. |
| [Apple HIG: Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons) | Знакомым действиям подходят знакомые значки; если короткий текст понятнее, он предпочтительнее неясного знака. | Стрелка раскрытия не смешивается со значком статуса. «Критерий неясен» и другое редкое состояние сохраняют короткий текст. |
| [Material 3: Color roles](https://m3.material.io/styles/color/the-color-system) | Цвета задаются ролями `primary`, `surface`, `on surface`, `error`, а не копированием hex из компонента. | Токены Education делятся на первичное действие, поверхности, основной/вторичный текст и семантические пары фона и текста. |
| [Carbon: Color](https://www.carbondesignsystem.com/building-blocks/foundations/color/overview) и [Status indicators](https://www.carbondesignsystem.com/building-blocks/core/patterns/status-indicators) | Ролевые токены позволяют менять тему централизованно; форма и текст усиливают цветовой статус. | Одна матрица значков и тонов используется всеми маршрутами; описание остаётся в раскрытии и доступном имени. |
| [USWDS: Icon](https://designsystem.digital.gov/components/icon/) | Один значок должен иметь один смысл во всём сервисе; иконки наследуют цвет текста. | Общий `StatusIcon` на Lucide с `currentColor`; локальные `✓`, `◷`, `?` не используются как альтернативный алфавит. |
| [W3C WCAG 2.2: Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html) и [Accessible Name](https://www.w3.org/WAI/ARIA/apg/practices/names-and-descriptions/) | Цвет недостаточен для передачи статуса; интерактивному элементу нужно доступное имя. | На плотной строке допустима пиктограмма со счётчиком, но её полное значение есть в доступном имени и раскрытом тексте. |
| [Lucide React](https://lucide.dev/guide/react/) | Иконки представлены согласованными SVG, размер и толщина настраиваются, в сборку попадают только импортированные элементы. | Используем установленный `lucide-react`, без смешивания с SF Symbols и без новых растровых пиктограмм. |

Вывод для продукта: три независимые оси — **выполнение**, **проверка качества**, **свежесть источника**. Число `2 из 5` — объём, а не четвёртое состояние; средняя оценка `4,75` — значение, а не значок «успех». Значок обозначает только подтверждённый смысл своей оси. Это наша продуктовая интерпретация перечисленных рекомендаций.
