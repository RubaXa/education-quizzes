---
id: decisions.project-publication-audit-2026-10-21
status: accepted
implementation: implemented
created: 2026-10-21
updated: 2026-10-21
consumers:
  - "Education sync operator"
  - "operator CLI"
  - "sync developer"
code:
  - "scripts/sync-project.mjs"
  - "sync/project-audit.mjs"
  - "sync/publication-audit.mjs"
  - "operator/run-operation.mjs"
parent: module.synchronization.global-sync
uses:
  - service.operator-cli
  - module.synchronization.firestore-read-paths
sections:
  - основание
  - было--стало
  - действия-и-роли
  - проверки
  - согласование
  - файлы
---
# Read-only аудит публикации сохранённого окна

## Основание

После сбора МЭШ и изменения публикации оператору нужно повторно проверить сохранённый run, не пересобирать источники и не продвигать workflow. Пустой `pendingPublicationDates` допустим только после валидации именно того запуска, полного source window и адресной ролевой проекции.

## Было → стало

Раньше отдельной read-only команды для сохранённого run не было: повторная проверка проходила через полный `sync:project` или фазу завершения, которая может закрывать jobs и менять sync status. Теперь `sync:project audit --run RUNID` сверяет manifest, точное окно из 42 дат, полные локальные snapshots и адресную публикацию, затем пишет отдельный private audit receipt. Она не запускает inventory, inbox, Mesh adapter, сбор, phase completion или queue mutation. Операторский `project.audit` вызывает ту же команду.

`publication-verified` относится только к публикации проверенного окна; он не означает полного EducationSync, не снимает source/manual blocker и не закрывает `reconcile-day`. `pending` и `blocked` не считаются успехом. Пустое `expectedByDate` допустимо для пустого горизонта при наличии всех 42 полных snapshots; команда не создаёт недостающие synthetic dates. Так как dashboard helper может вернуть исторические записи за пределами запуска, production adapter ограничивает `expectedByDate` замороженным окном перед строгой валидацией runner; сравнение pending остаётся на всех 42 датах, поэтому пустые дни не фабрикуются и долги внутри окна не пропускаются.

## Действия и роли

Владельцы берутся только из manifest jobs; их IDs должны быть валидными и уникальными. Источник допускает canonical `.local/project-sync/sources/{familyId}/{childId}/diary` с realpath и exact `context.json`, либо legacy `.local/diary` с точным `legacyDayOwner`. `syncStatus.runId` проверяется до audit и повторно перед receipt, dashboard и grade pages — по точным role/family/child. Receipt хранит только opaque owner IDs, окно, publication statuses, pending dates и safe reason codes; файл создаётся с правами `0600` отдельно от manifest.

Ни ученическая, ни родительская роль не изменяют состояние. Firestore читается адресно; статус, очередь, manifest и snapshots остаются без записи. Допустима только локальная запись private receipt.

## Проверки

- `sync/project-audit.test.mjs`: frozen 42-date window, pending/blocked, sparse calendar, validation ошибки, private receipt, legacy/canonical ownership, symlink/context escape и concurrent status replacement.
- `sync/publication-audit.test.mjs`: точное соответствие family/child/role для dashboard и проекция полного dashboard index на frozen audit window с сохранением in-window gap.
- `operator/run-operation.test.mjs`: успех и partial требуют `receiptReadOnly:true` и `project-sync/audit-receipts/RUNID-UUID.json`, совпадающий с запрошенным run; отсутствующий/чужой путь отвергается.
- `npm run check:spec` и `npm run check:reads`.

## Согласование

Критерий успешного аудита — полный validated source window, принадлежащие владельцу dashboard обоих ролей, `publication-verified`, пустые pending, неизменённая workflow-фаза и private receipt. Отсутствие подтверждения остаётся блокировкой, а не выводом об отсутствии source work.

## Файлы

- `scripts/sync-project.mjs`
- `sync/project-audit.mjs`
- `sync/project-audit.test.mjs`
- `sync/publication-audit.mjs`
- `sync/publication-audit.test.mjs`
- `operator/operation-contract.mjs`
- `operator/operation-contract.test.mjs`
- `operator/run-operation.mjs`
- `operator/run-operation.test.mjs`
- `docs/modules/synchronization/global-sync.md`
- `docs/modules/synchronization/firestore-read-paths.md`
- `docs/services/operator-cli/README.md`
- `docs/shared/data/firestore-read-sites.json`
- `docs/file-map.md`
