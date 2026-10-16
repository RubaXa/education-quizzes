---
id: shared.access-and-privacy
status: accepted
implementation: partial
parent: product.education
uses:
  - module.families
  - shared.data.firestore
  - module.materials.storage-privacy
sections: []
---

# Доступ и приватность: общие границы

Этот контракт связывает существующие правила; детальные права принадлежат [семейной модели](../modules/families/README.md), [Firestore](data/firestore.md), [хранению](../modules/materials/storage-privacy.md) и `firestore.rules`.

| Граница | Обязательное правило |
|---|---|
| Семья/ребёнок | Проверенные `familyId`, `childId`, роль и source account; имя и текст источника не подтверждают право |
| Ссылки | Личные токены не коммитятся и не попадают в публичные логи; родительский и ученический доступ различаются |
| Закрытый разбор | Ключи, ответы и педагогические пояснения не копируются в открытые документы или командные уведомления |
| Медиа | Общий оригинал не даёт семье автоматического права; семейное основание и проекция проверяются отдельно |
| Серверный процесс | Admin/server Firestore SDK использует IAM и обходит клиентские Security Rules; credentials остаются закрытыми |
| Публичный Git | Код и обезличенные контракты; личные работы, learner-профиль, секреты и `.local` остаются вне него |

Код: `firestore.rules`, `src/lib/personalAccess.ts`, `scripts/lib/admin-firebase.mjs`, `day/material-access.mjs`. Клиентские роли и доступ реализованы частично в соответствии с переходной семейной моделью; будущий Telegram registry и его IAM ещё проектируются. Новый путь доступа требует своей проверки владельца и допустимого раскрытия.
